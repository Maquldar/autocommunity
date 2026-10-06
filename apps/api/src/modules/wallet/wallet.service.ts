import { HttpStatus, Injectable } from '@nestjs/common';
import type { Topup, WalletTransaction } from '@prisma/client';
import {
  WALLET_LIMITS,
  type CreateTopupResult,
  type CreateTransferInput,
  type DemoConfirmTopupInput,
  type Paginated,
  type TopupDto,
  type TransferResult,
  type WalletDto,
  type WalletReceivedPayload,
  type WalletTransactionDto,
  type WalletTxKind,
} from '@autoc/shared';
import { isUserBlocked } from '../../common/auth/user-state.service';
import { ApiException, Errors } from '../../common/errors/api-exception';
import { newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RateLimiterService } from '../../infra/rate-limit/rate-limiter.service';
import { AntifraudService } from '../antifraud/antifraud.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UserViewService, userViewInclude } from '../users/user-view.service';
import { DemoPaymentProvider, PaymentProvider, type PaymentOutcome } from './payment-provider';
import {
  insufficientFunds,
  isUniqueViolation,
  ledgerPage,
  lockWallets,
  post,
  premiumDto,
  readWallet,
  sentLast24h,
  toTxDto,
  transferDailyRemaining,
  walletFrozen,
} from './wallet-ledger';

const HOUR_MS = 3600 * 1000;

const toTopupDto = (t: Topup): TopupDto => ({
  id: t.id,
  amount: t.amount,
  status: t.status,
  provider: 'demo',
  cardLast4: t.cardLast4,
  createdAt: t.createdAt.toISOString(),
  expiresAt: t.expiresAt.toISOString(),
  completedAt: t.completedAt?.toISOString() ?? null,
});

/** A transfer result plus whether it was a replay of an earlier request (→ 200 instead of 201). */
export type TransferOutcome = TransferResult & { replay: boolean };

/** Coin wallet (API.md §9.1): reads, top-ups through the PaymentProvider adapter, transfers. */
@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimiter: RateLimiterService,
    private readonly notifications: NotificationsService,
    private readonly antifraud: AntifraudService,
    private readonly userView: UserViewService,
    private readonly provider: PaymentProvider,
  ) {}

  /* ------------------------------------------------------------------ reads */

  async get(userId: string, now = new Date()): Promise<WalletDto> {
    const [wallet, sub, sent] = await Promise.all([
      readWallet(this.prisma, userId),
      this.prisma.premiumSubscription.findFirst({ where: { userId, endedAt: null } }),
      sentLast24h(this.prisma, userId, now),
    ]);
    return {
      balance: Number(wallet.balance),
      frozen: wallet.frozen,
      premium: premiumDto(sub, now),
      transferDailyRemaining: transferDailyRemaining(sent, wallet.frozen),
    };
  }

  async transactions(userId: string, q: { cursor?: string; limit: number; kind?: WalletTxKind }): Promise<Paginated<WalletTransactionDto>> {
    const page = await ledgerPage(this.prisma, userId, q);
    return { items: await this.txDtos(page.rows), nextCursor: page.nextCursor };
  }

  /** DTOs with counterparty minis in one query. */
  async txDtos(rows: WalletTransaction[]): Promise<WalletTransactionDto[]> {
    const ids = [...new Set(rows.map((r) => r.counterpartyId).filter((id): id is string => !!id))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, include: userViewInclude }) : [];
    const minis = new Map(users.map((u) => [u.id, this.userView.toMini(u)]));
    return rows.map((r) => toTxDto(r, minis));
  }

  /* ------------------------------------------------------------------ top-ups */

  async createTopup(userId: string, amount: number, now = new Date()): Promise<CreateTopupResult> {
    const wallet = await readWallet(this.prisma, userId);
    if (wallet.frozen) throw walletFrozen();
    await this.rateLimiter.consumeOrThrow([{ key: `wallet-topup:${userId}`, limit: WALLET_LIMITS.topupsPerHour, windowSec: 3600 }]);
    const id = newId();
    const payment = await this.provider.createPayment({ topupId: id, userId, amount });
    const topup = await this.prisma.topup.create({
      data: {
        id,
        userId,
        amount,
        provider: this.provider.name,
        providerRef: payment.providerRef,
        expiresAt: new Date(now.getTime() + WALLET_LIMITS.topupTtlMin * 60_000),
      },
    });
    return { topup: toTopupDto(topup), checkoutUrl: payment.checkoutUrl };
  }

  async getTopup(userId: string, id: string): Promise<TopupDto> {
    const t = await this.prisma.topup.findFirst({ where: { id, userId } });
    if (!t) throw Errors.notFound('Top-up not found');
    return toTopupDto(t);
  }

  /** Demo checkout: the card decides; the outcome goes through the provider-independent `completeTopup`. */
  async demoConfirm(userId: string, id: string, input: DemoConfirmTopupInput): Promise<TopupDto> {
    if (!(this.provider instanceof DemoPaymentProvider)) throw Errors.notFound('The demo checkout is disabled', 'PROVIDER_DISABLED');
    const t = await this.prisma.topup.findFirst({ where: { id, userId }, select: { id: true } });
    if (!t) throw Errors.notFound('Top-up not found');
    return this.completeTopup(this.provider.outcome(id, input.cardNumber));
  }

  /**
   * Applies a provider outcome exactly once (top-up row lock): only a `pending`, unexpired top-up changes.
   * A repeated success returns the same top-up (credited once); a decline → 402 PAYMENT_DECLINED.
   */
  async completeTopup(outcome: PaymentOutcome, now = new Date()): Promise<TopupDto> {
    const result = await this.prisma.$transaction(async (tx) => {
      const [t] = await tx.$queryRaw<Topup[]>`
        SELECT id, user_id AS "userId", amount, status, expires_at AS "expiresAt" FROM topups WHERE id = ${outcome.topupId}::uuid FOR UPDATE`;
      if (!t) throw Errors.notFound('Top-up not found');
      if (t.status === 'succeeded') return { kind: 'done' as const };
      if (t.status === 'declined') throw Errors.conflict('TOPUP_NOT_PENDING', 'This top-up was declined; start a new one');
      if (t.status === 'expired' || t.expiresAt.getTime() <= now.getTime()) {
        await tx.topup.update({ where: { id: t.id }, data: { status: 'expired' } });
        return { kind: 'expired' as const };
      }
      if (outcome.status === 'declined') {
        await tx.topup.update({ where: { id: t.id }, data: { status: 'declined', cardLast4: outcome.cardLast4, completedAt: now } });
        return { kind: 'declined' as const };
      }
      const wallets = await lockWallets(tx, [t.userId]);
      if (wallets.get(t.userId)!.frozen) throw walletFrozen();
      await post(tx, { userId: t.userId, kind: 'topup', amount: t.amount, ref: t.id });
      await tx.topup.update({ where: { id: t.id }, data: { status: 'succeeded', cardLast4: outcome.cardLast4, completedAt: now } });
      return { kind: 'done' as const };
    });
    if (result.kind === 'expired') throw Errors.conflict('TOPUP_EXPIRED', 'This top-up has expired; start a new one');
    if (result.kind === 'declined') throw new ApiException(HttpStatus.PAYMENT_REQUIRED, 'PAYMENT_DECLINED', 'The card was declined');
    return toTopupDto(await this.prisma.topup.findUniqueOrThrow({ where: { id: outcome.topupId } }));
  }

  /* ------------------------------------------------------------------ transfers */

  async transfer(senderId: string, input: CreateTransferInput, now = new Date()): Promise<TransferOutcome> {
    // Exact match: `nickname` is citext (case-insensitive equality); a pattern match would let `_` / `%` hit others.
    const recipient = await this.prisma.user.findUnique({
      where: input.toUserId ? { id: input.toUserId } : { nickname: input.toNickname! },
      select: { id: true, status: true, blockedUntil: true, onboardedAt: true },
    });
    if (recipient?.id === senderId) throw Errors.badRequest('INVALID_TARGET', "You can't send coins to yourself");
    if (!recipient || recipient.status === 'deleted' || !recipient.onboardedAt) throw Errors.notFound('User not found');

    // A replay of the same request returns the original result, whatever the limits say now.
    const replay = await this.findReplay(senderId, input, recipient.id);
    if (replay) return replay;

    const sender = await this.prisma.user.findUniqueOrThrow({ where: { id: senderId }, select: { createdAt: true, rating: true } });
    const minAgeMs = WALLET_LIMITS.transferMinAccountAgeHours * HOUR_MS;
    const ageMs = now.getTime() - sender.createdAt.getTime();
    if (ageMs < minAgeMs) throw accountTooNew({ minHours: WALLET_LIMITS.transferMinAccountAgeHours, retryAfterSec: Math.ceil((minAgeMs - ageMs) / 1000) });
    if (sender.rating < WALLET_LIMITS.transferMinRating) throw ratingTooLow(WALLET_LIMITS.transferMinRating);
    const senderWallet = await readWallet(this.prisma, senderId);
    if (senderWallet.frozen) throw walletFrozen();
    if (isUserBlocked({ status: recipient.status, blockedUntil: recipient.blockedUntil?.toISOString() ?? null })) throw recipientUnavailable();
    await this.rateLimiter.consumeOrThrow([{ key: `wallet-transfer:${senderId}`, limit: WALLET_LIMITS.transfersPerMinute, windowSec: 60 }]);

    let outRow: WalletTransaction;
    let balance: bigint;
    try {
      ({ outRow, balance } = await this.prisma.$transaction(async (tx) => {
        const wallets = await lockWallets(tx, [senderId, recipient.id]);
        const from = wallets.get(senderId)!;
        const to = wallets.get(recipient.id)!;
        if (from.frozen) throw walletFrozen();
        if (to.frozen) throw recipientUnavailable();
        const sent = await sentLast24h(tx, senderId, now);
        if (sent + input.amount > WALLET_LIMITS.transferDailyCap) {
          throw Errors.conflict('TRANSFER_DAILY_CAP', 'Daily transfer limit reached', {
            cap: WALLET_LIMITS.transferDailyCap,
            remaining: Math.max(0, WALLET_LIMITS.transferDailyCap - sent),
          });
        }
        if (from.balance < BigInt(input.amount)) throw insufficientFunds(from.balance);
        const outId = newId();
        const inId = newId();
        const message = input.message ?? null;
        const outRow = await post(tx, {
          id: outId,
          userId: senderId,
          kind: 'transfer_out',
          amount: -input.amount,
          counterpartyId: recipient.id,
          ref: inId,
          note: message,
          idempotencyKey: input.idempotencyKey,
        });
        await post(tx, { id: inId, userId: recipient.id, kind: 'transfer_in', amount: input.amount, counterpartyId: senderId, ref: outId, note: message });
        return { outRow, balance: outRow.balanceAfter };
      }));
    } catch (err) {
      // The same key raced in from a concurrent request: answer like a replay.
      if (isUniqueViolation(err)) {
        const again = await this.findReplay(senderId, input, recipient.id);
        if (again) return again;
      }
      throw err;
    }

    const senderUser = await this.prisma.user.findUniqueOrThrow({ where: { id: senderId }, include: userViewInclude });
    const payload: WalletReceivedPayload = { transactionId: outRow.ref!, amount: input.amount, message: input.message ?? null, user: this.userView.toMini(senderUser) };
    await this.notifications.create(recipient.id, 'wallet_received', payload);
    this.antifraud.walletTransfer(recipient.id);
    const [dto] = await this.txDtos([outRow]);
    return { transaction: dto!, balance: Number(balance), replay: false };
  }

  /** The sender's earlier transfer with this idempotency key; a different recipient or amount → 409. */
  private async findReplay(senderId: string, input: CreateTransferInput, recipientId: string): Promise<TransferOutcome | null> {
    const prior = await this.prisma.walletTransaction.findUnique({ where: { userId_idempotencyKey: { userId: senderId, idempotencyKey: input.idempotencyKey } } });
    if (!prior) return null;
    if (prior.kind !== 'transfer_out' || prior.counterpartyId !== recipientId || Number(prior.amount) !== -input.amount) {
      throw Errors.conflict('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used for a different transfer');
    }
    const wallet = await this.prisma.wallet.findUniqueOrThrow({ where: { userId: senderId }, select: { balance: true } });
    const [dto] = await this.txDtos([prior]);
    return { transaction: dto!, balance: Number(wallet.balance), replay: true };
  }
}

export const ratingTooLow = (min: number) => new ApiException(HttpStatus.FORBIDDEN, 'RATING_TOO_LOW', `Your rating must be at least ${min}`, { min });
export const accountTooNew = (details: Record<string, number>) =>
  new ApiException(HttpStatus.FORBIDDEN, 'ACCOUNT_TOO_NEW', 'Your account is too new for this', details);
export const recipientUnavailable = () => Errors.conflict('RECIPIENT_UNAVAILABLE', "This user can't receive coins right now");
