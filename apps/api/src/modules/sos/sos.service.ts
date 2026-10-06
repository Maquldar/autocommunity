import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma, type SosResponseStatus } from '@prisma/client';
import {
  RATING,
  SOS_LIMITS,
  type Bbox,
  type CreateSosInput,
  type Paginated,
  type PublicSosDto,
  type SosDto,
  type SosMapItem,
  type SosStatus,
  type SosType,
  type UserMini,
} from '@autoc/shared';
import { createHash, randomBytes } from 'node:crypto';
import { Errors } from '../../common/errors/api-exception';
import { newId } from '../../common/ids';
import { decodeCursor, splitPage } from '../../common/pagination/cursor';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RateLimiterService } from '../../infra/rate-limit/rate-limiter.service';
import { AccountDeletionHooks } from '../../infra/tasks/account-deletion-hooks';
import { AntifraudService } from '../antifraud/antifraud.service';
import { SYSTEM_CANCEL_PREFIX } from '../antifraud/sanctions.service';
import { ChatsService } from '../chats/chats.service';
import { LocationService, trustedFreshLocation } from '../location/location.service';
import { MAP_MAX_BBOX_DEG, MAP_MAX_USERS } from '../map/map.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UserViewService, userViewInclude } from '../users/user-view.service';
import { RatingService } from '../rating/rating.service';
import { SosBroadcastService } from './sos-broadcast.service';
import { SosDispatchService } from './sos-dispatch.service';
import { SosErrors } from './sos-errors';
import { sosTransition, type SosAction } from './sos-state';
import { SosViewService } from './sos-view.service';
import { SosQueue } from './sos.queue';

type Tx = Prisma.TransactionClient;
type LockedSos = { id: string; userId: string; status: SosStatus; expiresAt: Date; acceptedAt: Date | null };
type ResponseRow = { id: string; helperId: string; status: SosResponseStatus };

const OPEN = Prisma.sql`('created', 'accepted', 'in_progress')`;
const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';
/** `/sos/nearby` hints farther than this from the stored location are ignored. */
const SOS_HINT_MAX_M = 1000;
/** GET /sos/nearby and GET /map/sos, each, per user per minute. */
export const SOS_GEO_PER_MINUTE = 60;
/** Fresh (< 15 min) and trusted position of alias `ul` (no user input in this fragment). */
const TRUSTED_UL = Prisma.raw(trustedFreshLocation('ul'));

@Injectable()
export class SosService implements OnModuleInit {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly view: SosViewService,
    private readonly queue: SosQueue,
    private readonly broadcast: SosBroadcastService,
    private readonly chats: ChatsService,
    private readonly notifications: NotificationsService,
    private readonly userView: UserViewService,
    private readonly location: LocationService,
    private readonly rateLimiter: RateLimiterService,
    private readonly rating: RatingService,
    private readonly dispatch: SosDispatchService,
    private readonly deletionHooks: AccountDeletionHooks,
    private readonly antifraud: AntifraudService,
  ) {}

  onModuleInit(): void {
    this.deletionHooks.register('sos', (userId) => this.onAccountDeleted(userId));
    this.antifraud.registerSosCanceller((userId, sosId, reason) => this.cancel(userId, sosId, reason, { system: true }));
  }

  /**
   * Before an account is deleted: its open SOS is cancelled and its live offers/accepted helps are withdrawn,
   * through the normal transitions (notifications, chat messages, sos:update). Arrived helps stay (they
   * happened).
   */
  private async onAccountDeleted(userId: string): Promise<void> {
    const open = await this.prisma.sosRequest.findMany({ where: { userId, status: { in: ['created', 'accepted', 'in_progress'] } }, select: { id: true } });
    for (const s of open) await this.cancel(userId, s.id, 'account_deleted');
    const live = await this.prisma.sosResponse.findMany({
      where: { helperId: userId, status: { in: ['offered', 'accepted'] }, sos: { status: { in: ['created', 'accepted', 'in_progress'] } } },
      select: { sosId: true },
    });
    for (const r of live) await this.withdraw(userId, r.sosId);
  }

  /* ------------------------------------------------------------------ create */

  async create(userId: string, input: CreateSosInput): Promise<SosDto> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { phoneVerifiedAt: true, rating: true, sosBannedUntil: true },
    });
    if (!user.phoneVerifiedAt) throw SosErrors.phoneNotVerified();
    if (user.rating < RATING.sosCreateMin) throw SosErrors.ratingTooLow();
    if (user.sosBannedUntil && user.sosBannedUntil.getTime() > Date.now()) throw SosErrors.banned(user.sosBannedUntil);
    const photoIds = [...new Set(input.photoUploadIds)];
    if (photoIds.length) {
      const own = await this.prisma.upload.count({ where: { id: { in: photoIds }, ownerId: userId, purpose: 'sos' } });
      if (own !== photoIds.length) throw Errors.badRequest('INVALID_UPLOAD', 'Photos must be your own uploads with purpose "sos"');
    }

    const id = newId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.env.SOS_TTL_SEC * 1000);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR NO KEY UPDATE`;
        await this.assertCanCreate(tx, userId);
        if (photoIds.length) {
          // SOS photos (an array column) can't carry a unique index: lock the uploads, then check.
          await tx.$queryRaw`SELECT id FROM uploads WHERE id = ANY(${photoIds}::uuid[]) FOR UPDATE`;
          const used = await tx.$queryRaw<{ n: number }[]>`
            SELECT count(*)::int AS n FROM sos_requests WHERE photo_upload_ids && ${photoIds}::uuid[]`;
          if (used[0]!.n) throw Errors.badRequest('INVALID_UPLOAD', 'This upload is already used elsewhere');
        }
        await tx.$executeRaw`
          INSERT INTO sos_requests (id, user_id, type, description, photo_upload_ids, location, status, share_phone,
                                    radius_m, created_at, expires_at, updated_at)
          VALUES (${id}::uuid, ${userId}::uuid, ${input.type}::"SosType", ${input.description}, ${photoIds}::uuid[],
                  ST_SetSRID(ST_MakePoint(${input.lng}::float8, ${input.lat}::float8), 4326)::geography, 'created',
                  ${input.sharePhone}, ${SOS_LIMITS.radiiM[0]}::int, ${now}, ${expiresAt}, ${now})`;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw SosErrors.alreadyOpen();
      throw err;
    }
    await this.location.storeNow(userId, input);
    await this.queue.scheduleNew(id, expiresAt);
    this.antifraud.sosCreated(userId, id, photoIds);
    this.broadcast.update(id); // the requester's other devices; joins their sockets to sos:{id}
    return this.view.toDto(userId, id);
  }

  /** Gate order: 24 h rate, then "already open". */
  private async assertCanCreate(tx: Tx, userId: string): Promise<void> {
    const recent = await tx.sosRequest.findMany({
      where: { userId, createdAt: { gt: new Date(Date.now() - 24 * 3600_000) } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    if (recent.length >= SOS_LIMITS.perDay) {
      const oldest = recent[recent.length - SOS_LIMITS.perDay]!.createdAt.getTime();
      throw SosErrors.rateLimit(Math.max(1, Math.ceil((oldest + 24 * 3600_000 - Date.now()) / 1000)));
    }
    const open = await tx.sosRequest.count({ where: { userId, status: { in: ['created', 'accepted', 'in_progress'] } } });
    if (open) throw SosErrors.alreadyOpen();
  }

  /* ------------------------------------------------------------------ queries */

  async get(viewerId: string, id: string): Promise<SosDto> {
    if (!(await this.canView(viewerId, id))) throw SosErrors.notFound();
    return this.view.toDto(viewerId, id);
  }

  /** My open SOS and open SOS where I have a live response. */
  async active(userId: string): Promise<SosDto[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT s.id FROM sos_requests s
      WHERE s.status IN ${OPEN}
        AND (s.user_id = ${userId}::uuid OR EXISTS (
          SELECT 1 FROM sos_responses r WHERE r.sos_id = s.id AND r.helper_id = ${userId}::uuid AND r.status IN ('offered', 'accepted', 'arrived')))
      ORDER BY s.created_at DESC`;
    return this.view.toDtos(userId, rows.map((r) => r.id));
  }

  /**
   * Open SOS of others within 20 km of the viewer's stored location (< 15 min old), nearest first (max 50).
   * `lat`/`lng` are only hints: used as the origin when within 1 km of the stored location.
   */
  async nearby(userId: string, hintLat?: number, hintLng?: number): Promise<SosDto[]> {
    await this.rateLimiter.consumeOrThrow([{ key: `sos-nearby:${userId}`, limit: SOS_GEO_PER_MINUTE, windowSec: 60 }]);
    const loc = await this.prisma.$queryRaw<{ lat: number; lng: number; hintOk: boolean | null }[]>`
      SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
             ${hintLat !== undefined && hintLng !== undefined
               ? Prisma.sql`ST_DWithin(location, ST_SetSRID(ST_MakePoint(${hintLng}::float8, ${hintLat}::float8), 4326)::geography, ${SOS_HINT_MAX_M}::float8)`
               : Prisma.sql`NULL::boolean`} AS "hintOk"
      FROM user_locations ul
      WHERE ul.user_id = ${userId}::uuid AND ${TRUSTED_UL}`;
    if (!loc[0]) throw Errors.conflict('LOCATION_REQUIRED', 'Share your current location to see SOS nearby');
    const origin = loc[0].hintOk ? { lat: hintLat!, lng: hintLng! } : { lat: loc[0].lat, lng: loc[0].lng };
    const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${origin.lng}::float8, ${origin.lat}::float8), 4326)::geography`;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT s.id FROM sos_requests s
      WHERE s.status IN ${OPEN} AND s.user_id <> ${userId}::uuid
        AND ST_DWithin(s.location, ${point}, ${SOS_LIMITS.visibleRadiusM}::float8)
      ORDER BY ST_Distance(s.location, ${point})
      LIMIT 50`;
    return this.view.toDtos(userId, rows.map((r) => r.id), origin);
  }

  async map(userId: string, bbox: Bbox): Promise<{ items: SosMapItem[] }> {
    await this.rateLimiter.consumeOrThrow([{ key: `sos-map:${userId}`, limit: SOS_GEO_PER_MINUTE, windowSec: 60 }]);
    if (bbox.maxLng - bbox.minLng > MAP_MAX_BBOX_DEG || bbox.maxLat - bbox.minLat > MAP_MAX_BBOX_DEG) {
      throw Errors.badRequest('BBOX_TOO_LARGE', `The map area may cover at most ${MAP_MAX_BBOX_DEG}° × ${MAP_MAX_BBOX_DEG}°`);
    }
    const rows = await this.prisma.$queryRaw<{ id: string; type: SosType; lat: number; lng: number; status: SosStatus; createdAt: Date }[]>`
      SELECT id, type, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, status, created_at AS "createdAt"
      FROM sos_requests
      WHERE status IN ${OPEN} AND user_id <> ${userId}::uuid
        -- Only SOS within 20 km of the viewer's stored location (no location → nothing): positions can't be
        -- harvested city-wide by moving the bbox.
        AND EXISTS (SELECT 1 FROM user_locations ul WHERE ul.user_id = ${userId}::uuid AND ${TRUSTED_UL}
                      AND ST_DWithin(ul.location, sos_requests.location, ${SOS_LIMITS.visibleRadiusM}::float8))
        AND location && ST_MakeEnvelope(${bbox.minLng}::float8, ${bbox.minLat}::float8, ${bbox.maxLng}::float8, ${bbox.maxLat}::float8, 4326)::geography
        AND ST_Y(location::geometry) BETWEEN ${bbox.minLat}::float8 AND ${bbox.maxLat}::float8
        AND ST_X(location::geometry) BETWEEN ${bbox.minLng}::float8 AND ${bbox.maxLng}::float8
      ORDER BY created_at DESC
      LIMIT ${MAP_MAX_USERS}::int`;
    return { items: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
  }

  /** As requester or helper (any response), newest first. */
  async history(userId: string, cursor: string | undefined, limit: number): Promise<Paginated<SosDto>> {
    const after = decodeCursor(cursor);
    const keyset = after ? Prisma.sql`AND (s.created_at, s.id) < (${after.createdAt}, ${after.id}::uuid)` : Prisma.empty;
    // Two index-backed branches (sos_requests(user_id, created_at) and sos_responses(helper_id)), each
    // limited, merged: no scan over every SOS testing an OR.
    const rows = await this.prisma.$queryRaw<{ id: string; createdAt: Date }[]>`
      SELECT id, "createdAt" FROM (
        (SELECT s.id, s.created_at AS "createdAt" FROM sos_requests s
          WHERE s.user_id = ${userId}::uuid ${keyset}
          ORDER BY s.created_at DESC, s.id DESC LIMIT ${limit + 1}::int)
        UNION
        (SELECT s.id, s.created_at FROM sos_responses r JOIN sos_requests s ON s.id = r.sos_id
          WHERE r.helper_id = ${userId}::uuid ${keyset}
          ORDER BY s.created_at DESC, s.id DESC LIMIT ${limit + 1}::int)
      ) h
      ORDER BY "createdAt" DESC, id DESC
      LIMIT ${limit + 1}::int`;
    const page = splitPage(rows, limit);
    return { items: await this.view.toDtos(userId, page.rows.map((r) => r.id)), nextCursor: page.nextCursor };
  }

  /**
   * Participants (requester, responders, dispatched users) always; anyone else only while the SOS is open
   * and their fresh (< 15 min), trusted position is within 20 km.
   */
  async canView(viewerId: string, id: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ ok: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM sos_requests s
        WHERE s.id = ${id}::uuid AND (
          s.user_id = ${viewerId}::uuid
          OR EXISTS (SELECT 1 FROM sos_responses r WHERE r.sos_id = s.id AND r.helper_id = ${viewerId}::uuid)
          OR EXISTS (SELECT 1 FROM sos_dispatches d WHERE d.sos_id = s.id AND d.user_id = ${viewerId}::uuid)
          -- Non-participants: only an open SOS, and only near a fresh, trusted position.
          OR (s.status IN ${OPEN} AND EXISTS (
                SELECT 1 FROM user_locations ul WHERE ul.user_id = ${viewerId}::uuid AND ${TRUSTED_UL}
                  AND ST_DWithin(ul.location, s.location, ${SOS_LIMITS.visibleRadiusM}::float8)))
        )) AS ok`;
    return rows[0]?.ok ?? false;
  }

  /* ------------------------------------------------------------------ lifecycle */

  async respond(helperId: string, id: string): Promise<SosDto> {
    await this.expireIfOverdue(id);
    if (!(await this.canView(helperId, id))) throw SosErrors.notFound();
    const helper = await this.prisma.user.findUniqueOrThrow({ where: { id: helperId }, select: { rating: true, sosBannedUntil: true } });
    if (helper.sosBannedUntil && helper.sosBannedUntil.getTime() > Date.now()) throw SosErrors.banned(helper.sosBannedUntil);
    const res = await this.prisma.$transaction(async (tx) => {
      const sos = await this.lock(tx, id);
      if (sos.userId === helperId) throw Errors.badRequest('INVALID_TARGET', "You can't respond to your own SOS");
      if (helper.rating < RATING.sosHelpMin) throw SosErrors.ratingTooLow();
      const existing = await this.responseOf(tx, id, helperId);
      const next = this.check(sos, existing?.status ?? null, 0, 'respond');
      const live = await tx.sosResponse.count({ where: { sosId: id, status: { in: ['offered', 'accepted', 'arrived'] } } });
      if (live >= SOS_LIMITS.maxActiveOffers) throw SosErrors.offerLimit();
      const responseId = existing?.id ?? newId();
      if (existing) await tx.sosResponse.update({ where: { id: existing.id }, data: { status: next.response! } });
      else await tx.sosResponse.create({ data: { id: responseId, sosId: id, helperId, status: 'offered' } });
      await this.touch(tx, id);
      return { sos, responseId };
    });
    await this.notifications.create(res.sos.userId, 'sos_response', { sosId: id, responseId: res.responseId, helper: await this.mini(helperId) });
    this.broadcast.update(id);
    return this.view.toDto(helperId, id);
  }

  async withdraw(helperId: string, id: string): Promise<SosDto> {
    await this.expireIfOverdue(id);
    if (!(await this.canView(helperId, id))) throw SosErrors.notFound();
    const res = await this.prisma.$transaction(async (tx) => {
      const sos = await this.lock(tx, id);
      const mine = await this.responseOf(tx, id, helperId);
      if (!mine) throw SosErrors.invalidState('You have not offered help for this SOS');
      const next = this.check(sos, mine.status, await this.activeHelpers(tx, id), 'withdraw');
      await tx.sosResponse.update({ where: { id: mine.id }, data: { status: 'withdrawn' } });
      // Chat access ends in the same transaction as the help (no window where a withdrawn helper still writes).
      let chatId: string | null = null;
      if (mine.status === 'accepted') {
        chatId = (await tx.chat.findUnique({ where: { refId: id }, select: { id: true } }))?.id ?? null;
        if (chatId) await tx.chatMember.deleteMany({ where: { chatId, userId: helperId } });
      }
      let status = next.sos;
      // Back to `created` after the expiry time → it expires right away (the expiry job already ran).
      if (status === 'created' && sos.status !== 'created' && sos.expiresAt.getTime() <= Date.now()) status = 'expired';
      await this.setStatus(tx, id, status, sos.status);
      return { sos, chatId, status };
    });
    const helper = await this.mini(helperId);
    if (res.chatId) {
      this.chats.revoked(res.chatId, [helperId]);
      await this.chats.postSystemMessage(res.chatId, helperId, `sos.helper_withdrew:${helper.nickname}`);
    }
    await this.notifications.create(res.sos.userId, 'sos_status', { sosId: id, status: res.status, event: 'withdrawn', actor: helper });
    this.broadcast.update(id);
    return this.view.toDto(helperId, id);
  }

  async accept(requesterId: string, id: string, responseId: string): Promise<SosDto> {
    const res = await this.requesterTx(requesterId, id, async (tx, sos) => {
      const response = await this.responseById(tx, id, responseId);
      const next = this.check(sos, response.status, await this.activeHelpers(tx, id), 'accept');
      // One active help per helper across open SOS; the helper's row lock serializes concurrent accepts.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${response.helperId}::uuid FOR NO KEY UPDATE`;
      const busy = await tx.sosResponse.count({
        where: { helperId: response.helperId, status: { in: ['accepted', 'arrived'] }, sos: { status: { in: ['created', 'accepted', 'in_progress'] } } },
      });
      if (busy) throw SosErrors.helperBusy();
      await tx.sosResponse.update({ where: { id: response.id }, data: { status: 'accepted' } });
      await this.setStatus(tx, id, next.sos, sos.status, sos.acceptedAt ? undefined : new Date());
      return response;
    });
    const { chatId, created } = await this.chats.ensureGroupChat('sos', id, [requesterId, res.helperId]);
    if (created) await this.chats.postSystemMessage(chatId, requesterId, 'sos.chat_created');
    const helper = await this.mini(res.helperId);
    await this.chats.postSystemMessage(chatId, requesterId, `sos.helper_accepted:${helper.nickname}`);
    await this.notifications.create(res.helperId, 'sos_accepted', { sosId: id, requester: await this.mini(requesterId) });
    this.broadcast.update(id);
    return this.view.toDto(requesterId, id);
  }

  async decline(requesterId: string, id: string, responseId: string): Promise<SosDto> {
    const res = await this.requesterTx(requesterId, id, async (tx, sos) => {
      const response = await this.responseById(tx, id, responseId);
      this.check(sos, response.status, 0, 'decline');
      await tx.sosResponse.update({ where: { id: response.id }, data: { status: 'declined' } });
      await this.touch(tx, id);
      return { response, status: sos.status };
    });
    await this.notifications.create(res.response.helperId, 'sos_status', { sosId: id, status: res.status, event: 'declined' });
    this.broadcast.update(id);
    return this.view.toDto(requesterId, id);
  }

  /** Accepted helper: their response → arrived. Requester: every accepted response → arrived. SOS → in_progress. */
  async arrived(actorId: string, id: string): Promise<SosDto> {
    await this.expireIfOverdue(id);
    if (!(await this.canView(actorId, id))) throw SosErrors.notFound();
    const res = await this.prisma.$transaction(async (tx) => {
      const sos = await this.lock(tx, id);
      const isRequester = sos.userId === actorId;
      const targets = isRequester
        ? await tx.sosResponse.findMany({ where: { sosId: id, status: 'accepted' }, select: { id: true, helperId: true, status: true } })
        : [await this.responseOf(tx, id, actorId)].filter((r): r is ResponseRow => !!r);
      if (!targets.length) {
        if (!isRequester && !(await this.responseOf(tx, id, actorId))) throw Errors.forbidden('Only the requester or an accepted helper can do this');
        throw SosErrors.invalidState('There is no accepted helper to mark as arrived');
      }
      let status: SosStatus = sos.status;
      for (const r of targets) status = this.check({ ...sos, status }, r.status, 0, 'arrived').sos;
      await tx.sosResponse.updateMany({ where: { id: { in: targets.map((r) => r.id) } }, data: { status: 'arrived' } });
      await this.setStatus(tx, id, status, sos.status);
      return { sos, isRequester, helperIds: targets.map((r) => r.helperId), status };
    });
    const chat = await this.sosChat(id);
    for (const helperId of res.helperIds) {
      const helper = await this.mini(helperId);
      if (chat) await this.chats.postSystemMessage(chat, actorId, `sos.helper_arrived:${helper.nickname}`);
      if (!res.isRequester) await this.notifications.create(res.sos.userId, 'sos_status', { sosId: id, status: res.status, event: 'arrived', actor: helper });
    }
    if (res.isRequester) {
      for (const helperId of res.helperIds) await this.notifications.create(helperId, 'sos_status', { sosId: id, status: res.status, event: 'in_progress' });
    }
    this.broadcast.update(id);
    return this.view.toDto(actorId, id);
  }

  async close(requesterId: string, id: string): Promise<SosDto> {
    return this.finish(requesterId, id, 'close');
  }

  /** `system`: cancelled by the platform (block, fake, deletion), not counted as the user's own cancel. */
  async cancel(requesterId: string, id: string, reason?: string, opts: { system?: boolean } = {}): Promise<SosDto> {
    const stored = opts.system ? `${SYSTEM_CANCEL_PREFIX}${reason ?? ''}` : reason?.replace(/^system:/i, '');
    const dto = await this.finish(requesterId, id, 'cancel', stored);
    if (!opts.system) this.antifraud.sosCancelled(requesterId, id);
    return dto;
  }

  private async finish(requesterId: string, id: string, action: 'close' | 'cancel', reason?: string): Promise<SosDto> {
    const res = await this.requesterTx(requesterId, id, async (tx, sos) => {
      const next = this.check(sos, null, 0, action);
      await tx.$executeRaw`
        UPDATE sos_requests SET status = ${next.sos}::"SosStatus", closed_at = now(), updated_at = now(),
               cancel_reason = ${action === 'cancel' ? (reason ?? null) : null}
        WHERE id = ${id}::uuid`;
      const helpers = await tx.sosResponse.findMany({ where: { sosId: id, status: { in: ['offered', 'accepted', 'arrived'] } }, select: { helperId: true, status: true } });
      // A closed SOS confirms the help of everyone who arrived: their rating changes in this transaction.
      if (next.sos === 'closed') {
        for (const h of helpers.filter((x) => x.status === 'arrived')) await this.rating.recompute(tx, h.helperId, 'help_confirmed', id);
      }
      return {
        status: next.sos,
        helperIds: helpers.map((h) => h.helperId),
        confirmed: next.sos === 'closed' ? helpers.filter((x) => x.status === 'arrived').map((h) => h.helperId) : [],
      };
    });
    this.antifraud.sosClosed(requesterId, id, res.confirmed);
    const chat = await this.sosChat(id);
    if (chat) await this.chats.postSystemMessage(chat, requesterId, action === 'close' ? 'sos.closed' : 'sos.cancelled');
    for (const helperId of res.helperIds) await this.notifications.create(helperId, 'sos_status', { sosId: id, status: res.status });
    this.broadcast.update(id);
    return this.view.toDto(requesterId, id);
  }

  /* ------------------------------------------------------------------ share link */

  /** A new token each call (the previous link stops working). Only while the SOS is open. */
  async share(requesterId: string, id: string): Promise<{ url: string }> {
    const token = randomBytes(32).toString('base64url');
    await this.requesterTx(requesterId, id, async (tx, sos) => {
      if (!['created', 'accepted', 'in_progress'].includes(sos.status)) throw SosErrors.invalidState('Only an open SOS can be shared');
      await tx.sosRequest.update({ where: { id }, data: { shareToken: hashToken(token) } });
    });
    return { url: `${this.env.WEB_ORIGIN[0]}/s/${token}` };
  }

  async publicView(token: string, ip: string): Promise<PublicSosDto> {
    await this.rateLimiter.consumeOrThrow([{ key: `sos-public:${ip}`, limit: SOS_LIMITS.publicPerMinute, windowSec: 60 }]);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw SosErrors.notFound();
    const sos = await this.prisma.sosRequest.findUnique({
      where: { shareToken: hashToken(token) },
      select: {
        id: true,
        status: true,
        closedAt: true,
        user: { select: { name: true } },
        responses: { where: { status: { in: ['accepted', 'arrived'] } }, orderBy: { createdAt: 'asc' }, select: { helper: { select: { nickname: true } } } },
      },
    });
    const open = sos && ['created', 'accepted', 'in_progress'].includes(sos.status);
    const recentlyEnded = sos?.closedAt && sos.closedAt.getTime() > Date.now() - SOS_LIMITS.shareGraceSec * 1000;
    if (!sos || (!open && !recentlyEnded)) throw SosErrors.notFound();
    const [row] = await this.view.loadRows([sos.id]);
    const nicknames = sos.responses.map((r) => r.helper.nickname ?? '').filter(Boolean);
    return {
      type: row!.type,
      status: row!.status,
      lat: row!.lat,
      lng: row!.lng,
      requesterName: firstName(sos.user.name),
      helperNickname: nicknames[0] ?? null,
      helperNicknames: nicknames,
      updatedAt: row!.updatedAt.toISOString(),
    };
  }

  /* ------------------------------------------------------------------ helpers */

  private check(sos: Pick<LockedSos, 'status'>, response: SosResponseStatus | null, activeHelpers: number, action: SosAction) {
    const t = sosTransition({ sos: sos.status, response, activeHelpers }, action);
    if (!t.ok) throw t.code === 'SOS_HELPER_LIMIT' ? SosErrors.helperLimit() : SosErrors.invalidState();
    return t;
  }

  /**
   * A `created` SOS past `expiresAt` is expired (committed, with its notification) before any transition is
   * evaluated, so a late action gets 409 SOS_INVALID_STATE instead of acting on an SOS that should be over.
   */
  private async expireIfOverdue(id: string): Promise<void> {
    await this.dispatch.expire(id);
  }

  /** 404 if the caller can't see the SOS, 403 if they can but aren't the requester; runs `fn` with the row locked. */
  private async requesterTx<T>(requesterId: string, id: string, fn: (tx: Tx, sos: LockedSos) => Promise<T>): Promise<T> {
    if (!(await this.canView(requesterId, id))) throw SosErrors.notFound();
    await this.expireIfOverdue(id);
    return this.prisma.$transaction(async (tx) => {
      const sos = await this.lock(tx, id);
      if (sos.userId !== requesterId) throw SosErrors.requesterOnly();
      return fn(tx, sos);
    });
  }

  private async lock(tx: Tx, id: string): Promise<LockedSos> {
    const rows = await tx.$queryRaw<LockedSos[]>`
      SELECT id, user_id AS "userId", status, expires_at AS "expiresAt", accepted_at AS "acceptedAt"
      FROM sos_requests WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows[0]) throw SosErrors.notFound();
    return rows[0];
  }

  private responseOf(tx: Tx, sosId: string, helperId: string): Promise<ResponseRow | null> {
    return tx.sosResponse.findUnique({ where: { sosId_helperId: { sosId, helperId } }, select: { id: true, helperId: true, status: true } });
  }

  private async responseById(tx: Tx, sosId: string, responseId: string): Promise<ResponseRow> {
    const r = await tx.sosResponse.findFirst({ where: { id: responseId, sosId }, select: { id: true, helperId: true, status: true } });
    if (!r) throw Errors.notFound('Response not found');
    return r;
  }

  private activeHelpers(tx: Tx, sosId: string): Promise<number> {
    return tx.sosResponse.count({ where: { sosId, status: { in: ['accepted', 'arrived'] } } });
  }

  private async setStatus(tx: Tx, id: string, status: SosStatus, previous: SosStatus, acceptedAt?: Date): Promise<void> {
    if (status === previous && !acceptedAt) return this.touch(tx, id);
    await tx.$executeRaw`
      UPDATE sos_requests SET status = ${status}::"SosStatus", updated_at = now(),
             accepted_at = COALESCE(accepted_at, ${acceptedAt ?? null}),
             closed_at = CASE WHEN ${status}::text IN ('closed', 'cancelled', 'expired') THEN now() ELSE closed_at END
      WHERE id = ${id}::uuid`;
  }

  private async touch(tx: Tx, id: string): Promise<void> {
    await tx.$executeRaw`UPDATE sos_requests SET updated_at = now() WHERE id = ${id}::uuid`;
  }

  private async sosChat(sosId: string): Promise<string | null> {
    return (await this.prisma.chat.findUnique({ where: { refId: sosId }, select: { id: true } }))?.id ?? null;
  }

  private async mini(userId: string): Promise<UserMini> {
    return this.userView.toMini(await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: userViewInclude }));
  }
}
