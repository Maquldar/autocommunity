import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type Upload, type Violation, type ViolationStatus } from '@prisma/client';
import {
  VIOLATION_LIMITS,
  type AdminViolationDto,
  type CreateViolationInput,
  type Paginated,
  type UploadDto,
  type UserMini,
  type ViolationDto,
  type ViolationReportedPayload,
  type ViolationStatusPayload,
} from '@autoc/shared';
import { ApiException, Errors } from '../../common/errors/api-exception';
import { newId } from '../../common/ids';
import { decodeCursor, splitPage, type CursorKey } from '../../common/pagination/cursor';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { Storage } from '../../infra/storage/storage';
import { AntifraudService } from '../antifraud/antifraud.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RatingService } from '../rating/rating.service';
import { toUploadDto } from '../uploads/upload.mapper';
import { UserViewService, userViewInclude } from '../users/user-view.service';

const DAY_MS = 24 * 3600 * 1000;
type Tx = Prisma.TransactionClient;

/** What the owner sees besides approved ones. */
const OWNER_STATUSES: ViolationStatus[] = ['approved', 'pending', 'disputed'];

const invalidState = () => Errors.conflict('VIOLATION_INVALID_STATE', 'This violation is not in a state that allows this');

/** Keyset on (occurredAt desc, id desc). */
const occurredKey = (v: Violation): CursorKey => ({ createdAt: v.occurredAt, id: v.id });
const occurredAfter = (c: CursorKey | null): Prisma.ViolationWhereInput =>
  c ? { OR: [{ occurredAt: { lt: c.createdAt } }, { occurredAt: c.createdAt, id: { lt: c.id } }] } : {};
const occurredOrder = [{ occurredAt: 'desc' as const }, { id: 'desc' as const }];

export type AdminDecision = 'approve' | 'reject' | 'uphold' | 'remove';

/** Vehicle violations (API.md §9.4). The submitter never leaves this service except in admin DTOs. */
@Injectable()
export class ViolationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: Storage,
    private readonly notifications: NotificationsService,
    private readonly rating: RatingService,
    private readonly antifraud: AntifraudService,
    private readonly userView: UserViewService,
  ) {}

  /* ------------------------------------------------------------------ user routes */

  async submit(userId: string, vehicleId: string, input: CreateViolationInput, now = new Date()): Promise<ViolationDto> {
    const vehicle = await this.requireVehicle(vehicleId, userId);
    const isOwner = vehicle.userId === userId;
    if (!isOwner) {
      const me = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { createdAt: true, rating: true } });
      const minAgeMs = VIOLATION_LIMITS.submitterMinAccountAgeDays * DAY_MS;
      const ageMs = now.getTime() - me.createdAt.getTime();
      if (ageMs < minAgeMs) {
        throw new ApiException(HttpStatus.FORBIDDEN, 'ACCOUNT_TOO_NEW', 'Your account is too new to report violations', {
          minDays: VIOLATION_LIMITS.submitterMinAccountAgeDays,
          retryAfterSec: Math.ceil((minAgeMs - ageMs) / 1000),
        });
      }
      if (me.rating < VIOLATION_LIMITS.submitterMinRating) {
        throw new ApiException(HttpStatus.FORBIDDEN, 'RATING_TOO_LOW', `Your rating must be at least ${VIOLATION_LIMITS.submitterMinRating}`, {
          min: VIOLATION_LIMITS.submitterMinRating,
        });
      }
    }
    const photoIds = input.photoUploadIds;
    const own = await this.prisma.upload.count({ where: { id: { in: photoIds }, ownerId: userId, purpose: 'violation' } });
    if (own !== photoIds.length) throw Errors.badRequest('INVALID_UPLOAD', 'Photos must be your own uploads with purpose "violation"');

    const id = newId();
    await this.prisma.$transaction(async (tx) => {
      // One submitter at a time: the daily limit and photo reuse are checked and written atomically.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`violation:${userId}`}))`;
      const today = await tx.violation.findMany({
        where: { submitterId: userId, createdAt: { gt: new Date(now.getTime() - DAY_MS) } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
        take: VIOLATION_LIMITS.perDay,
      });
      if (today.length >= VIOLATION_LIMITS.perDay) throw Errors.rateLimited(Math.max(1, Math.ceil((today[0]!.createdAt.getTime() + DAY_MS - now.getTime()) / 1000)));
      const [used] = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM violations WHERE photo_upload_ids && ${photoIds}::uuid[]`;
      if (used && used.n > 0) throw Errors.badRequest('INVALID_UPLOAD', 'This upload is already used elsewhere');
      await tx.violation.create({
        data: {
          id,
          vehicleId,
          ownerId: vehicle.userId,
          submitterId: userId,
          vehicleBrand: vehicle.brand,
          vehicleModel: vehicle.model,
          vehicleYear: vehicle.year,
          category: input.category,
          codeType: input.codeType,
          article: input.article ?? null,
          occurredAt: input.occurredAt,
          description: input.description,
          photoUploadIds: photoIds,
          createdAt: now,
        },
      });
    });
    if (!isOwner) {
      const payload: ViolationReportedPayload = { violationId: id, vehicleId, category: input.category, vehicle: `${vehicle.brand} ${vehicle.model}` };
      await this.notifications.create(vehicle.userId, 'violation_reported', payload);
    }
    const row = await this.prisma.violation.findUniqueOrThrow({ where: { id } });
    return (await this.render([row], userId))[0]!;
  }

  async listForVehicle(viewerId: string, vehicleId: string, q: { cursor?: string; limit: number }): Promise<Paginated<ViolationDto>> {
    const vehicle = await this.requireVehicle(vehicleId, viewerId);
    const statuses = vehicle.userId === viewerId ? OWNER_STATUSES : (['approved'] as ViolationStatus[]);
    return this.page(viewerId, { vehicleId, status: { in: statuses } }, q);
  }

  async listForUser(viewerId: string, userId: string, q: { cursor?: string; limit: number }): Promise<Paginated<ViolationDto>> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true, onboardedAt: true } });
    if (!u || (userId !== viewerId && (u.status === 'deleted' || !u.onboardedAt))) throw Errors.notFound('User not found');
    const statuses = userId === viewerId ? OWNER_STATUSES : (['approved'] as ViolationStatus[]);
    return this.page(viewerId, { ownerId: userId, vehicleId: { not: null }, status: { in: statuses } }, q);
  }

  async listSubmitted(viewerId: string, q: { cursor?: string; limit: number }): Promise<Paginated<ViolationDto>> {
    return this.page(viewerId, { submitterId: viewerId }, q);
  }

  async dispute(userId: string, id: string, text: string, now = new Date()): Promise<ViolationDto> {
    const v = await this.prisma.violation.findUnique({ where: { id } });
    const visible = v && v.vehicleId && (v.status === 'approved' || v.ownerId === userId || v.submitterId === userId);
    if (!v || !visible) throw Errors.notFound('Violation not found');
    if (v.ownerId !== userId) throw Errors.forbidden('Only the vehicle owner can dispute');
    if (v.disputeText !== null) throw Errors.conflict('ALREADY_DISPUTED', 'This violation was already disputed');
    if (v.status !== 'pending' && v.status !== 'approved') throw invalidState();
    const { count } = await this.prisma.violation.updateMany({
      where: { id, status: v.status, disputeText: null },
      data: { status: 'disputed', disputeText: text, disputedAt: now },
    });
    if (!count) throw Errors.conflict('ALREADY_DISPUTED', 'This violation was already disputed');
    return (await this.render([await this.prisma.violation.findUniqueOrThrow({ where: { id } })], userId))[0]!;
  }

  /* ------------------------------------------------------------------ admin */

  async adminList(q: { cursor?: string; limit: number; status?: ViolationStatus }): Promise<Paginated<AdminViolationDto>> {
    const queue = q.status === 'pending' || q.status === 'disputed';
    const c = decodeCursor(q.cursor);
    const after: Prisma.ViolationWhereInput = !c
      ? {}
      : queue
        ? { OR: [{ createdAt: { gt: c.createdAt } }, { createdAt: c.createdAt, id: { gt: c.id } }] }
        : { OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }] };
    const rows = await this.prisma.violation.findMany({
      where: { ...(q.status ? { status: q.status } : {}), ...after },
      orderBy: queue ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const page = splitPage(rows, q.limit);
    return { items: await this.adminDtos(page.rows), nextCursor: page.nextCursor };
  }

  /**
   * Applies an admin decision in one transaction (row lock): status, penalty or its reversal, and the audit
   * row via `audit`. Notifications go out after commit.
   */
  async decide(adminId: string, id: string, decision: AdminDecision, note: string, audit: (tx: Tx, v: Violation) => Promise<void>, now = new Date()): Promise<AdminViolationDto> {
    const v = await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM violations WHERE id = ${id}::uuid FOR UPDATE`;
      if (!row) throw Errors.notFound('Violation not found');
      const v = await tx.violation.findUniqueOrThrow({ where: { id } });
      const owner = await tx.user.findUnique({ where: { id: v.ownerId }, select: { id: true, role: true } });
      if (owner && (owner.id === adminId || owner.role === 'admin')) throw Errors.forbidden("Admins can't act on themselves or on other admins", 'INVALID_TARGET');
      if (v.submitterId === adminId) throw Errors.forbidden("You can't moderate your own submission", 'INVALID_TARGET');
      const from: ViolationStatus = decision === 'approve' || decision === 'reject' ? 'pending' : 'disputed';
      if (v.status !== from) throw invalidState();
      const to: ViolationStatus = decision === 'reject' ? 'rejected' : decision === 'remove' ? 'removed' : 'approved';
      const updated = await tx.violation.update({ where: { id }, data: { status: to, decidedAt: now, decidedById: adminId, decisionNote: note } });
      if (to === 'approved' && !(await this.penaltyAppliedTx(tx, v))) await this.rating.applyPenaltyTx(tx, v.ownerId, 'violation', v.id, now);
      if (to === 'removed') await this.rating.reversePenaltyTx(tx, v.ownerId, 'violation', v.id, now);
      await audit(tx, updated);
      return updated;
    });

    const base = { violationId: v.id, vehicleId: v.vehicleId ?? '', category: v.category };
    const notes: { userId: string; payload: ViolationStatusPayload }[] = [];
    if (v.status === 'approved' || v.status === 'removed') notes.push({ userId: v.ownerId, payload: { ...base, status: v.status, role: 'owner' } });
    if (v.submitterId !== v.ownerId && decision !== 'uphold' && decision !== 'remove' && (v.status === 'approved' || v.status === 'rejected')) {
      notes.push({ userId: v.submitterId, payload: { ...base, status: v.status, role: 'submitter' } });
    }
    for (const n of notes) await this.notifications.create(n.userId, 'violation_status', n.payload);
    if (v.status === 'rejected') this.antifraud.violationRejected(v.submitterId);
    return (await this.adminDtos([v]))[0]!;
  }

  async adminDtos(rows: Violation[]): Promise<AdminViolationDto[]> {
    if (!rows.length) return [];
    const userIds = [...new Set(rows.flatMap((r) => [r.ownerId, r.submitterId]))];
    const [users, photos, rejected, penalties] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: userIds } }, include: userViewInclude }),
      this.photos(rows),
      this.prisma.violation.groupBy({ by: ['submitterId'], where: { submitterId: { in: rows.map((r) => r.submitterId) }, status: 'rejected' }, _count: { _all: true } }),
      this.prisma.$queryRaw<{ refId: string }[]>`
        SELECT p.ref_id::text AS "refId" FROM rating_events p
        WHERE p.reason = 'penalty' AND p.penalty_kind = 'violation' AND p.ref_id = ANY(${rows.map((r) => r.id)}::uuid[])
          AND NOT EXISTS (SELECT 1 FROM rating_events r WHERE r.reason = 'penalty_reversed' AND r.penalty_kind = 'violation' AND r.ref_id = p.ref_id)`,
    ]);
    const minis = new Map(users.map((u) => [u.id, this.userView.toMini(u)]));
    const rejectedBy = new Map(rejected.map((r) => [r.submitterId, r._count._all]));
    const penalized = new Set(penalties.map((p) => p.refId));
    const mini = (id: string): UserMini => minis.get(id) ?? { id, nickname: '', name: 'Deleted user', avatarUrl: null, rating: 0, isPremium: false };
    return rows.map((r) => ({
      ...this.base(r, photos(r)),
      owner: mini(r.ownerId),
      submitter: mini(r.submitterId),
      dispute: r.disputeText ? { text: r.disputeText, createdAt: (r.disputedAt ?? r.updatedAt).toISOString() } : null,
      submitterRejectedCount: rejectedBy.get(r.submitterId) ?? 0,
      penaltyApplied: penalized.has(r.id),
      decisionNote: r.decisionNote,
    }));
  }

  /* ------------------------------------------------------------------ helpers */

  private async penaltyAppliedTx(tx: Tx, v: Violation): Promise<boolean> {
    const n = await tx.ratingEvent.count({ where: { userId: v.ownerId, reason: 'penalty', penaltyKind: 'violation', refId: v.id } });
    return n > 0;
  }

  /** The vehicle, if its owner is visible to the viewer (deleted / un-onboarded owners → 404, self excepted). */
  async requireVehicle(vehicleId: string, viewerId: string) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId }, include: { user: { select: { status: true, onboardedAt: true } } } });
    if (!vehicle || (vehicle.userId !== viewerId && (vehicle.user.status === 'deleted' || !vehicle.user.onboardedAt))) throw Errors.notFound('Vehicle not found');
    return vehicle;
  }

  private async page(viewerId: string, where: Prisma.ViolationWhereInput, q: { cursor?: string; limit: number }): Promise<Paginated<ViolationDto>> {
    const rows = await this.prisma.violation.findMany({ where: { ...where, ...occurredAfter(decodeCursor(q.cursor)) }, orderBy: occurredOrder, take: q.limit + 1 });
    const page = splitPage(rows, q.limit, occurredKey);
    return { items: await this.render(page.rows, viewerId), nextCursor: page.nextCursor };
  }

  /** Viewer-specific DTOs: the dispute only for the owner; never the submitter. */
  async render(rows: Violation[], viewerId: string): Promise<ViolationDto[]> {
    const photos = await this.photos(rows);
    return rows.map((r) => {
      const isOwner = r.ownerId === viewerId;
      return {
        ...this.base(r, photos(r)),
        dispute: isOwner && r.disputeText ? { text: r.disputeText, createdAt: (r.disputedAt ?? r.updatedAt).toISOString() } : null,
        submittedByMe: r.submitterId === viewerId,
        canDispute: isOwner && !!r.vehicleId && r.disputeText === null && (r.status === 'pending' || r.status === 'approved'),
      };
    });
  }

  private base(r: Violation, photos: UploadDto[]) {
    return {
      id: r.id,
      vehicle: { id: r.vehicleId ?? '', brand: r.vehicleBrand, model: r.vehicleModel, year: r.vehicleYear },
      category: r.category,
      codeType: r.codeType,
      article: r.article,
      occurredAt: r.occurredAt.toISOString(),
      description: r.description,
      photos,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
    };
  }

  private async photos(rows: Violation[]): Promise<(v: Violation) => UploadDto[]> {
    const ids = [...new Set(rows.flatMap((r) => r.photoUploadIds))];
    const uploads: Upload[] = ids.length ? await this.prisma.upload.findMany({ where: { id: { in: ids } } }) : [];
    const byId = new Map(uploads.map((u) => [u.id, u]));
    return (v) => v.photoUploadIds.flatMap((id) => (byId.has(id) ? [toUploadDto(byId.get(id)!, this.storage)] : []));
  }
}
