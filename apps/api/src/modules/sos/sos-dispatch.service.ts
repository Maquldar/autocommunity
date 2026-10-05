import { Injectable, Logger } from '@nestjs/common';
import { RATING, SOS_LIMITS, type SosType } from '@autoc/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ChatsService } from '../chats/chats.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UserViewService, userViewInclude } from '../users/user-view.service';
import { SosBroadcastService } from './sos-broadcast.service';
import { sosTransition } from './sos-state';

type Candidate = { id: string; distanceM: number };

/** Dispatch (notify nearby helpers, expanding the radius) and expiry; run by the `sos` BullMQ queue. */
@Injectable()
export class SosDispatchService {
  private readonly logger = new Logger(SosDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly userView: UserViewService,
    private readonly broadcast: SosBroadcastService,
    private readonly chats: ChatsService,
  ) {}

  /**
   * Step 0/1/2 = radius 5/10/20 km. Runs only while the SOS is still `created` (expansion stops once someone
   * is accepted). Picks the 20 nearest eligible users not dispatched before; hidden-mode users are included
   * (their position is used here, never returned).
   */
  async dispatch(sosId: string, step: number): Promise<string[]> {
    const radius = SOS_LIMITS.radiiM[Math.min(step, SOS_LIMITS.radiiM.length - 1)]!;
    const result = await this.prisma.$transaction(async (tx) => {
      const sos = await tx.$queryRaw<{ status: string; userId: string; type: SosType }[]>`
        SELECT status, user_id AS "userId", type FROM sos_requests WHERE id = ${sosId}::uuid FOR UPDATE`;
      if (sos[0]?.status !== 'created') return null;
      await tx.$executeRaw`
        UPDATE sos_requests SET radius_m = GREATEST(radius_m, ${radius}::int), updated_at = now() WHERE id = ${sosId}::uuid`;
      const candidates = await tx.$queryRaw<Candidate[]>`
        SELECT u.id, round(ST_Distance(ul.location, s.location))::int AS "distanceM"
        FROM sos_requests s
        JOIN user_locations ul ON ST_DWithin(ul.location, s.location, ${radius}::float8)
        JOIN users u ON u.id = ul.user_id
        WHERE s.id = ${sosId}::uuid
          AND u.id <> s.user_id
          AND (u.status = 'active' OR (u.status = 'blocked' AND u.blocked_until <= now()))
          AND u.onboarded_at IS NOT NULL
          AND u.receive_sos
          AND u.rating >= ${RATING.sosHelpMin}::int
          AND ul.updated_at > now() - make_interval(mins => ${SOS_LIMITS.freshLocationMin}::int)
          AND (ul.untrusted_until IS NULL OR ul.untrusted_until <= now())
          AND NOT EXISTS (SELECT 1 FROM sos_dispatches d WHERE d.sos_id = s.id AND d.user_id = u.id)
        ORDER BY ST_Distance(ul.location, s.location), u.id
        LIMIT ${SOS_LIMITS.dispatchMaxPerStep}::int`;
      if (candidates.length) {
        // ON CONFLICT: a concurrent run of the same step can't create a second row for anyone.
        await tx.$executeRaw`
          INSERT INTO sos_dispatches (sos_id, user_id, distance_m, created_at)
          SELECT ${sosId}::uuid, c.id, c.d, now()
          FROM unnest(${candidates.map((c) => c.id)}::uuid[], ${candidates.map((c) => c.distanceM)}::int[]) AS c(id, d)
          ON CONFLICT DO NOTHING`;
      }
      return sos[0];
    });
    if (!result) return [];
    return this.notifyPending(sosId, result.userId, result.type);
  }

  /**
   * Notifies every dispatch row of the SOS not notified yet (this step's, or an earlier attempt's that failed),
   * in one batch. Claiming the rows (FOR UPDATE SKIP LOCKED), inserting the notifications and setting
   * `notified_at` happen in one transaction: a crash rolls all of it back for the retry, and concurrent runs
   * never notify anyone twice. Socket/push delivery follows the commit (best effort, like every delivery).
   */
  private async notifyPending(sosId: string, requesterId: string, type: SosType): Promise<string[]> {
    const requester = await this.prisma.user.findUniqueOrThrow({ where: { id: requesterId }, include: userViewInclude });
    const mini = this.userView.toMini(requester);
    const batch = await this.prisma.$transaction(async (tx) => {
      const pending = await tx.$queryRaw<{ userId: string; distanceM: number }[]>`
        SELECT user_id::text AS "userId", distance_m AS "distanceM" FROM sos_dispatches
        WHERE sos_id = ${sosId}::uuid AND notified_at IS NULL
        FOR UPDATE SKIP LOCKED`;
      if (!pending.length) return [];
      const inserted = await this.notifications.insertMany(
        tx,
        'sos_nearby',
        pending.map((p) => ({ userId: p.userId, payload: { sosId, type, distanceM: p.distanceM, requester: mini } })),
      );
      await tx.$executeRaw`
        UPDATE sos_dispatches SET notified_at = now()
        WHERE sos_id = ${sosId}::uuid AND user_id = ANY(${pending.map((p) => p.userId)}::uuid[])`;
      return inserted;
    });
    if (!batch.length) return [];
    this.notifications.deliverLater(batch);
    const ids = batch.map((b) => b.userId);
    await this.broadcast.send(sosId, 'sos:new', ids);
    return ids;
  }

  /** `created` → `expired` (no-op otherwise). */
  async expire(sosId: string): Promise<boolean> {
    const done = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ status: 'created'; userId: string; expiresAt: Date }[]>`
        SELECT status, user_id AS "userId", expires_at AS "expiresAt" FROM sos_requests WHERE id = ${sosId}::uuid FOR UPDATE`;
      const sos = rows[0];
      if (!sos || sos.expiresAt.getTime() > Date.now() + 1000) return null;
      if (!sosTransition({ sos: sos.status, response: null, activeHelpers: 0 }, 'expire').ok) return null;
      await tx.$executeRaw`UPDATE sos_requests SET status = 'expired', closed_at = now(), updated_at = now() WHERE id = ${sosId}::uuid`;
      return sos;
    });
    if (!done) return false;
    await this.notifications.create(done.userId, 'sos_status', { sosId, status: 'expired' });
    this.broadcast.update(sosId);
    return true;
  }

  /**
   * An accepted / in-progress SOS nobody closed within 24 h of acceptance ends as `expired` (no help is
   * confirmed). The requester and every live responder are told; the SOS chat gets `sos.timed_out`.
   */
  async timeout(sosId: string): Promise<boolean> {
    const done = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ status: 'accepted'; userId: string; acceptedAt: Date | null }[]>`
        SELECT status, user_id AS "userId", accepted_at AS "acceptedAt" FROM sos_requests WHERE id = ${sosId}::uuid FOR UPDATE`;
      const sos = rows[0];
      if (!sos?.acceptedAt || sos.acceptedAt.getTime() > Date.now() - SOS_LIMITS.maxActiveHours * 3600_000) return null;
      if (!sosTransition({ sos: sos.status, response: null, activeHelpers: 0 }, 'timeout').ok) return null;
      await tx.$executeRaw`UPDATE sos_requests SET status = 'expired', closed_at = now(), updated_at = now() WHERE id = ${sosId}::uuid`;
      const helpers = await tx.sosResponse.findMany({ where: { sosId, status: { in: ['offered', 'accepted', 'arrived'] } }, select: { helperId: true } });
      return { requesterId: sos.userId, helperIds: helpers.map((h) => h.helperId) };
    });
    if (!done) return false;
    const chat = await this.prisma.chat.findUnique({ where: { refId: sosId }, select: { id: true } });
    if (chat) await this.chats.postSystemMessage(chat.id, done.requesterId, 'sos.timed_out');
    for (const userId of [done.requesterId, ...done.helperIds]) {
      await this.notifications.create(userId, 'sos_status', { sosId, status: 'expired', event: 'timeout' });
    }
    this.broadcast.update(sosId);
    return true;
  }

  /** Safety net for lost delayed jobs (e.g. Redis flushed): expires every overdue `created` SOS. */
  async sweepExpired(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM sos_requests WHERE status = 'created' AND expires_at <= now() ORDER BY expires_at LIMIT 200`;
    let n = 0;
    for (const r of rows) if (await this.expire(r.id).catch((err: unknown) => (this.logger.warn({ err }, 'Expire failed'), false))) n++;
    const stale = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM sos_requests
      WHERE status IN ('accepted', 'in_progress') AND accepted_at <= now() - make_interval(hours => ${SOS_LIMITS.maxActiveHours}::int)
      ORDER BY accepted_at LIMIT 200`;
    for (const r of stale) if (await this.timeout(r.id).catch((err: unknown) => (this.logger.warn({ err }, 'Timeout failed'), false))) n++;
    return n;
  }
}
