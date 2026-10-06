import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma, type PayItem, type PayOrder } from '@prisma/client';
import {
  isValidQty,
  lineTotal,
  PAY_LIMITS,
  payTagUrl,
  type CreatePayOrderInput,
  type Paginated,
  type PayItemDto,
  type PayLineDto,
  type PayPointDto,
  type PayPointManageDto,
  type PayReceiptDto,
  type PurchasePaidPayload,
  type PutPayItemsInput,
  type ServiceCategory,
  type AdminPayPartnerInput,
} from '@autoc/shared';
import { randomBytes } from 'node:crypto';
import type { AuthUser } from '../../common/auth/decorators';
import { isUserBlocked } from '../../common/auth/user-state.service';
import { ApiException, Errors } from '../../common/errors/api-exception';
import { newId } from '../../common/ids';
import { decodeCursor, encodeCursor, keysetOrderBy, keysetWhere } from '../../common/pagination/cursor';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RateLimiterService } from '../../infra/rate-limit/rate-limiter.service';
import { Storage } from '../../infra/storage/storage';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentProvider } from '../wallet/payment-provider';
import { insufficientFunds, isUniqueViolation, lockWallets, post, walletFrozen } from '../wallet/wallet-ledger';

type Tx = Prisma.TransactionClient;

/** The service columns a point needs. */
type PointRow = {
  id: string;
  name: string;
  category: ServiceCategory;
  address: string;
  status: string;
  acceptsPayments: boolean;
  payTag: string | null;
  ownerId: string | null;
  photoUploadIds: string[];
};

const POINT_SELECT = {
  id: true,
  name: true,
  category: true,
  address: true,
  status: true,
  acceptsPayments: true,
  payTag: true,
  ownerId: true,
  photoUploadIds: true,
} as const;

/** 128 random bits, base64url (22 characters). Opaque: it never encodes the service id. */
export const newPayTag = () => randomBytes(16).toString('base64url');

const pointNotFound = () => Errors.notFound('Payment point not found');
const pointUnavailable = () => Errors.conflict('POINT_UNAVAILABLE', "This point can't take payments right now");
const declined = () => new ApiException(HttpStatus.PAYMENT_REQUIRED, 'PAYMENT_DECLINED', 'Google Pay declined the payment');

class ReplayRace extends Error {}

/** An order outcome plus whether it replays an earlier request (→ 200 instead of 201). */
export type OrderOutcome = { receipt: PayReceiptDto; replay: boolean };

/** Phase 10 — "Оплата на точке" (API.md §10): partner points, price lists, orders, payTags. */
@Injectable()
export class PayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: Storage,
    private readonly rateLimiter: RateLimiterService,
    private readonly notifications: NotificationsService,
    private readonly provider: PaymentProvider,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /* ------------------------------------------------------------------ public point info */

  /** A verified partner point by service id; anything else is 404 (never reveals non-partners). */
  async point(serviceId: string): Promise<PayPointDto> {
    const row = await this.prisma.serviceCenter.findUnique({ where: { id: serviceId }, select: POINT_SELECT });
    if (!row || !isOpenPoint(row)) throw pointNotFound();
    return this.pointDto(row, await this.items(row.id));
  }

  /** NFC sticker / QR: `/pay/t/<payTag>` → the point. Rate limited so tags can't be probed in bulk. */
  async pointByTag(viewerId: string, tag: string): Promise<PayPointDto> {
    await this.rateLimiter.consumeOrThrow([{ key: `pay-tag:${viewerId}`, limit: PAY_LIMITS.tagLookupsPerMinute, windowSec: 60 }]);
    const row = await this.prisma.serviceCenter.findUnique({ where: { payTag: tag }, select: POINT_SELECT });
    if (!row || !isOpenPoint(row)) throw pointNotFound();
    return this.pointDto(row, await this.items(row.id));
  }

  private items(serviceId: string, db: Tx | PrismaService = this.prisma): Promise<PayItem[]> {
    return db.payItem.findMany({ where: { serviceId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  }

  private async pointDto(row: PointRow, items: PayItem[]): Promise<PayPointDto> {
    const logoId = row.photoUploadIds[0];
    const logo = logoId ? await this.prisma.upload.findUnique({ where: { id: logoId }, select: { key: true, thumbKey: true } }) : null;
    return {
      serviceId: row.id,
      name: row.name,
      category: row.category,
      address: row.address,
      logoUrl: logo ? this.storage.publicUrl(logo.thumbKey ?? logo.key) : null,
      items: items.map(toItemDto),
    };
  }

  /* ------------------------------------------------------------------ management (admin or owner) */

  private async requireManageable(viewer: AuthUser, serviceId: string, db: Tx | PrismaService = this.prisma): Promise<PointRow> {
    const row = await db.serviceCenter.findUnique({ where: { id: serviceId }, select: POINT_SELECT });
    if (!row) throw Errors.notFound('Service not found');
    if (viewer.role !== 'admin' && row.ownerId !== viewer.id) throw Errors.forbidden('Only the owner or an admin can manage this point');
    return row;
  }

  async manage(viewer: AuthUser, serviceId: string): Promise<PayPointManageDto> {
    const row = await this.requireManageable(viewer, serviceId);
    return this.manageDto(viewer, row);
  }

  private async manageDto(viewer: AuthUser, row: PointRow): Promise<PayPointManageDto> {
    const base = await this.pointDto(row, await this.items(row.id));
    const owner = row.ownerId ? await this.prisma.user.findUnique({ where: { id: row.ownerId }, select: { nickname: true } }) : null;
    return {
      ...base,
      acceptsPayments: row.acceptsPayments,
      ownerId: row.ownerId,
      ownerNickname: owner?.nickname ?? null,
      payTag: row.payTag,
      payUrl: row.payTag ? payTagUrl(this.env.WEB_ORIGIN[0]!, row.payTag) : null,
      canRotate: viewer.role === 'admin',
    };
  }

  /**
   * Replaces the price list. Items keep their ids when given (receipts snapshot names and prices anyway).
   * An admin editing a point they don't own must give a note, which is audited (`pay.items`).
   */
  async putItems(viewer: AuthUser, serviceId: string, input: PutPayItemsInput): Promise<PayPointManageDto> {
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM service_centers WHERE id = ${serviceId}::uuid FOR UPDATE`;
      const point = await this.requireManageable(viewer, serviceId, tx);
      const audited = viewer.role === 'admin' && point.ownerId !== viewer.id;
      if (audited && !input.note) throw Errors.validation('A note is required', [{ path: ['note'], message: 'Required for admins' }]);
      const existing = new Set((await tx.payItem.findMany({ where: { serviceId }, select: { id: true } })).map((i) => i.id));
      for (const item of input.items) {
        if (item.id && !existing.has(item.id)) throw Errors.badRequest('INVALID_ITEM', 'This item is not on this point');
      }
      const keep = input.items.filter((i) => i.id).map((i) => i.id!);
      await tx.payItem.deleteMany({ where: { serviceId, id: { notIn: keep } } });
      for (const [index, item] of input.items.entries()) {
        const data = { name: item.name, priceCoins: item.priceCoins, unit: item.unit, sortOrder: index };
        if (item.id) await tx.payItem.update({ where: { id: item.id }, data });
        else await tx.payItem.create({ data: { id: newId(), serviceId, ...data } });
      }
      if (audited) await audit(tx, viewer.id, 'pay.items', serviceId, point.ownerId, input.note!);
      return point;
    });
    return this.manageDto(viewer, row);
  }

  /** Admin: partner on/off and the owner whose wallet gets `sale` rows. The first enable issues a payTag. */
  async setPartner(admin: AuthUser, serviceId: string, input: AdminPayPartnerInput): Promise<PayPointManageDto> {
    const row = await this.prisma.$transaction(async (tx) => {
      const point = await tx.serviceCenter.findUnique({ where: { id: serviceId }, select: POINT_SELECT });
      if (!point) throw Errors.notFound('Service not found');
      if (input.acceptsPayments && point.status !== 'verified') throw Errors.conflict('SERVICE_NOT_VERIFIED', 'Only verified services can take payments');
      const ownerId = input.ownerId === undefined ? point.ownerId : input.ownerId;
      if (ownerId && ownerId !== point.ownerId) {
        const owner = await tx.user.findUnique({ where: { id: ownerId }, select: { status: true, onboardedAt: true } });
        if (!owner || owner.status === 'deleted' || !owner.onboardedAt) throw Errors.notFound('User not found');
      }
      const updated = await tx.serviceCenter.update({
        where: { id: serviceId },
        data: { acceptsPayments: input.acceptsPayments, ownerId, payTag: point.payTag ?? (input.acceptsPayments ? newPayTag() : null) },
        select: POINT_SELECT,
      });
      await audit(tx, admin.id, 'pay.partner', serviceId, ownerId, input.note);
      return updated;
    });
    return this.manageDto(admin, row);
  }

  /** Admin: a new payTag; stickers and QR codes with the old one stop working at once. */
  async rotateTag(admin: AuthUser, serviceId: string, note: string): Promise<PayPointManageDto> {
    const row = await this.prisma.$transaction(async (tx) => {
      const point = await tx.serviceCenter.findUnique({ where: { id: serviceId }, select: { id: true, ownerId: true } });
      if (!point) throw Errors.notFound('Service not found');
      const updated = await tx.serviceCenter.update({ where: { id: serviceId }, data: { payTag: newPayTag() }, select: POINT_SELECT });
      await audit(tx, admin.id, 'pay.tag_rotate', serviceId, point.ownerId, note);
      return updated;
    });
    return this.manageDto(admin, row);
  }

  /* ------------------------------------------------------------------ orders */

  async createOrder(buyerId: string, input: CreatePayOrderInput): Promise<OrderOutcome> {
    // A replay of the same request returns the original receipt, whatever the limits or prices say now.
    const replay = await this.findReplay(buyerId, input);
    if (replay) return { receipt: replay, replay: true };

    const point = await this.prisma.serviceCenter.findUnique({ where: { id: input.serviceId }, select: POINT_SELECT });
    if (!point || !isOpenPoint(point)) throw pointNotFound();
    if (point.ownerId === buyerId) throw Errors.badRequest('INVALID_TARGET', "You can't pay your own point");
    const lines = await this.price(point.id, input);
    const total = lines.reduce((sum, l) => sum + l.totalCoins, 0);
    if (total < PAY_LIMITS.orderMin) throw Errors.badRequest('INVALID_QTY', 'The order total is below 1 coin');
    if (total > PAY_LIMITS.orderMax) throw Errors.badRequest('ORDER_LIMIT', `One order can be at most ${PAY_LIMITS.orderMax} coins`, { max: PAY_LIMITS.orderMax });

    // Same wallet gates as transfers (blocked accounts never get here: ACCOUNT_BLOCKED).
    const wallet = await this.prisma.wallet.findUnique({ where: { userId: buyerId }, select: { frozen: true } });
    if (wallet?.frozen) throw walletFrozen();
    await this.rateLimiter.consumeOrThrow([{ key: `pay-order:${buyerId}`, limit: PAY_LIMITS.ordersPerMinute, windowSec: 60 }]);

    const payeeId = point.ownerId ? await this.availablePayee(point.ownerId) : null;
    const orderId = newId();

    let card: { network: string | null; last4: string | null } | null = null;
    let providerRef: string | null = null;
    if (input.method === 'google_pay') {
      // Demo provider: a Google Pay TEST token succeeds; no real money moves.
      const charge = await this.provider.chargeGooglePay({ orderId, userId: buyerId, amount: total, token: input.googlePay!.token });
      if (charge.status !== 'succeeded') throw declined();
      providerRef = charge.providerRef;
      card = { network: input.googlePay!.cardNetwork ?? null, last4: input.googlePay!.cardDetails ?? null };
    }

    let order: PayOrder;
    try {
      order = await this.prisma.$transaction(async (tx) => {
        const wallets = await lockWallets(tx, payeeId ? [buyerId, payeeId] : [buyerId]);
        const from = wallets.get(buyerId)!;
        // Same key committed while we waited for the lock (orders of one buyer serialize on their wallet row).
        const raced = await tx.payOrder.findUnique({ where: { userId_idempotencyKey: { userId: buyerId, idempotencyKey: input.idempotencyKey } }, select: { id: true } });
        if (raced) throw new ReplayRace();
        if (from.frozen) throw walletFrozen();
        if (payeeId && wallets.get(payeeId)!.frozen) throw pointUnavailable();
        const purchaseId = newId();
        const coins = input.method === 'coins';
        const topupId = coins ? null : newId();
        if (coins && from.balance < BigInt(total)) throw insufficientFunds(from.balance, { total });

        // The order row first: a concurrent request with the same key fails here (unique) and replays.
        const created = await tx.payOrder.create({
          data: {
            id: orderId,
            userId: buyerId,
            serviceId: point.id,
            method: input.method,
            total,
            lines: lines as unknown as Prisma.InputJsonValue,
            idempotencyKey: input.idempotencyKey,
            walletTxId: purchaseId,
            topupId,
            payeeUserId: payeeId,
            cardNetwork: card?.network ?? null,
            cardLast4: card?.last4 ?? null,
            balanceAfter: coins ? from.balance - BigInt(total) : null,
          },
        });

        if (topupId) {
          // Google Pay = a demo top-up that is spent on this purchase at once: the coin balance doesn't move.
          const now = new Date();
          await tx.topup.create({
            data: { id: topupId, userId: buyerId, amount: total, provider: this.provider.name, providerRef, status: 'succeeded', cardLast4: card?.last4 ?? null, expiresAt: now, completedAt: now },
          });
          await post(tx, { userId: buyerId, kind: 'topup', amount: total, ref: topupId, note: 'Google Pay (TEST)' });
        }
        await post(tx, { id: purchaseId, userId: buyerId, kind: 'purchase', amount: -total, ref: orderId, note: point.name });
        if (payeeId) {
          await post(tx, { userId: payeeId, kind: 'sale', amount: total, counterpartyId: buyerId, ref: orderId, note: point.name });
        } else {
          await tx.merchantSettlement.create({ data: { id: newId(), serviceId: point.id, orderId, amount: total } });
        }
        return created;
      });
    } catch (err) {
      // The same key raced in from a concurrent request: answer like a replay.
      if (err instanceof ReplayRace || isUniqueViolation(err)) {
        const again = await this.findReplay(buyerId, input);
        if (again) return { receipt: again, replay: true };
      }
      throw err;
    }

    const payload: PurchasePaidPayload = { orderId: order.id, serviceId: point.id, pointName: point.name, total, method: input.method };
    await this.notifications.create(buyerId, 'purchase_paid', payload);
    return { receipt: receiptDto(order, point), replay: false };
  }

  /** The owner's wallet can receive `sale` rows only while the owner account is usable. */
  private async availablePayee(ownerId: string): Promise<string> {
    const owner = await this.prisma.user.findUnique({ where: { id: ownerId }, select: { status: true, blockedUntil: true } });
    if (!owner || isUserBlocked({ status: owner.status, blockedUntil: owner.blockedUntil?.toISOString() ?? null })) throw pointUnavailable();
    return ownerId;
  }

  /** Server-side pricing: prices and names come from the point's list, never from the client. */
  private async price(serviceId: string, input: CreatePayOrderInput): Promise<PayLineDto[]> {
    if (input.amount !== undefined) return [{ itemId: null, name: null, unit: null, qty: 1, priceCoins: input.amount, totalCoins: input.amount }];
    const wanted = input.items!;
    const items = await this.prisma.payItem.findMany({ where: { serviceId, id: { in: wanted.map((l) => l.itemId) } } });
    const byId = new Map(items.map((i) => [i.id, i]));
    return wanted.map((l) => {
      const item = byId.get(l.itemId);
      if (!item) throw Errors.badRequest('INVALID_ITEM', 'This item is not on this point');
      if (!isValidQty(item.unit, l.qty)) {
        throw Errors.badRequest('INVALID_QTY', item.unit === 'l' ? 'Liters: 0.1 to 200, in steps of 0.1' : `Quantity: 1 to ${PAY_LIMITS.countMax}`, { unit: item.unit });
      }
      return { itemId: item.id, name: item.name, unit: item.unit, qty: l.qty, priceCoins: item.priceCoins, totalCoins: lineTotal(item.priceCoins, l.qty) };
    });
  }

  /** The buyer's earlier order with this key; a different point, method or basket → 409. */
  private async findReplay(buyerId: string, input: CreatePayOrderInput): Promise<PayReceiptDto | null> {
    const prior = await this.prisma.payOrder.findUnique({ where: { userId_idempotencyKey: { userId: buyerId, idempotencyKey: input.idempotencyKey } } });
    if (!prior) return null;
    const lines = prior.lines as unknown as PayLineDto[];
    const sameBasket =
      input.amount !== undefined
        ? lines.length === 1 && lines[0]!.itemId === null && prior.total === input.amount
        : lines.length === input.items!.length && input.items!.every((w) => lines.some((l) => l.itemId === w.itemId && l.qty === w.qty));
    if (prior.serviceId !== input.serviceId || prior.method !== input.method || !sameBasket) {
      throw Errors.conflict('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used for a different order');
    }
    const point = await this.prisma.serviceCenter.findUniqueOrThrow({ where: { id: prior.serviceId }, select: POINT_SELECT });
    return receiptDto(prior, point);
  }

  async orders(userId: string, q: { cursor?: string; limit: number }): Promise<Paginated<PayReceiptDto>> {
    const rows = await this.prisma.payOrder.findMany({
      where: { userId, ...keysetWhere(decodeCursor(q.cursor)) },
      orderBy: keysetOrderBy,
      take: q.limit + 1,
      include: { service: { select: POINT_SELECT } },
    });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => receiptDto(r, r.service)),
      nextCursor: rows.length > q.limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
    };
  }

  async order(userId: string, id: string): Promise<PayReceiptDto> {
    const row = await this.prisma.payOrder.findFirst({ where: { id, userId }, include: { service: { select: POINT_SELECT } } });
    if (!row) throw Errors.notFound('Order not found');
    return receiptDto(row, row.service);
  }
}

/* ------------------------------------------------------------------ helpers */

const isOpenPoint = (p: Pick<PointRow, 'status' | 'acceptsPayments'>) => p.status === 'verified' && p.acceptsPayments;

const toItemDto = (i: PayItem): PayItemDto => ({ id: i.id, name: i.name, priceCoins: i.priceCoins, unit: i.unit });

function receiptDto(o: PayOrder, p: Pick<PointRow, 'id' | 'name' | 'category' | 'address'>): PayReceiptDto {
  return {
    orderId: o.id,
    point: { serviceId: p.id, name: p.name, category: p.category, address: p.address },
    items: o.lines as unknown as PayLineDto[],
    total: o.total,
    method: o.method,
    paidAt: o.createdAt.toISOString(),
    balanceAfter: o.balanceAfter === null ? null : Number(o.balanceAfter),
    card: o.method === 'google_pay' ? { network: o.cardNetwork, last4: o.cardLast4 } : null,
    demo: true,
  };
}

/** Admin audit row (`admin_actions`), in the caller's transaction. */
async function audit(tx: Tx, adminId: string, action: 'pay.partner' | 'pay.items' | 'pay.tag_rotate', serviceId: string, targetUserId: string | null, note: string) {
  await tx.adminAction.create({ data: { id: newId(), adminId, action, targetType: 'service', targetId: serviceId, targetUserId, note } });
}
