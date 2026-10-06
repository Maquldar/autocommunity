import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ANTIFRAUD, maskPhone, type FraudFlagKind } from '@autoc/shared';
import { createHash } from 'node:crypto';
import { newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { BackgroundTasks } from '../../infra/tasks/background-tasks';
import { SanctionsService, SYSTEM_CANCEL_PREFIX, type SosCanceller } from './sanctions.service';

const HOUR_MS = 3_600_000;

/**
 * Antifraud v1 (API.md §6). Each trigger is called by the service where its event happens and writes a
 * `fraud_flags` row; some also apply an automatic sanction. Hooks run in the background (`run*` methods),
 * so a failing check never fails the user's request; the `check*` methods are the awaited bodies.
 */
@Injectable()
export class AntifraudService {
  private readonly logger = new Logger(AntifraudService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tasks: BackgroundTasks,
    private readonly sanctions: SanctionsService,
  ) {}

  /** SosService registers how the platform cancels an SOS (it can't be injected here: SosService depends on us). */
  registerSosCanceller(fn: SosCanceller): void {
    this.sanctions.registerSosCanceller(fn);
  }

  /* ------------------------------------------------------------------ hooks (fire and forget) */

  /** After an SOS was created: new_account_sos, duplicate_sos_photo. */
  sosCreated(userId: string, sosId: string, photoIds: string[]): void {
    this.tasks.run('antifraud sosCreated', async () => {
      await this.checkNewAccountSos(userId, sosId);
      if (photoIds.length) await this.checkDuplicateSosPhotos(userId, sosId, photoIds);
    });
  }

  /** After the requester cancelled their SOS: sos_cancel_streak. */
  sosCancelled(userId: string, sosId: string): void {
    this.tasks.run('antifraud sosCancelled', () => this.checkCancelStreak(userId, sosId));
  }

  /** After an SOS was closed with confirmed helpers: reciprocal_sos. */
  sosClosed(requesterId: string, sosId: string, helperIds: string[]): void {
    if (helperIds.length) {
      this.tasks.run('antifraud sosClosed', async () => {
        for (const helperId of helperIds) await this.checkReciprocalSos(requesterId, helperId, sosId);
      });
    }
  }

  /** After a report was filed: report_burst on the reported user. */
  reportCreated(targetUserId: string | null): void {
    if (targetUserId) this.tasks.run('antifraud reportCreated', () => this.checkReportBurst(targetUserId));
  }

  /** After a location update implied an impossible speed: location_teleport. */
  locationJump(userId: string): void {
    this.tasks.run('antifraud locationJump', () => this.recordLocationJump(userId));
  }

  /**
   * After a wrong OTP code locked the phone out (for `ip`): otp_abuse. Concurrent guesses that all see the
   * same lockout count once (dedup key lives as long as the lockout).
   */
  otpLockout(phone: string, ip: string, lockoutSec: number): void {
    this.tasks.run('antifraud otpLockout', async () => {
      const key = `af:otp-locked:${createHash('sha256').update(`${phone}|${ip}`).digest('hex').slice(0, 32)}`;
      if ((await this.redis.set(key, '1', 'EX', Math.max(1, lockoutSec), 'NX')) === 'OK') await this.recordOtpLockout(phone);
    });
  }

  /** Phase 9: after coins were transferred into `recipientId`: wallet_funnel. */
  walletTransfer(recipientId: string): void {
    this.tasks.run('antifraud walletTransfer', () => this.checkWalletFunnel(recipientId));
  }

  /** Phase 9: after a downvote on `targetId`: vote_burst. */
  voteDown(targetId: string): void {
    this.tasks.run('antifraud voteDown', () => this.checkVoteBurst(targetId));
  }

  /** Phase 9: after an admin rejected a violation submitted by `submitterId`: violation_rejections. */
  violationRejected(submitterId: string): void {
    this.tasks.run('antifraud violationRejected', () => this.checkViolationRejections(submitterId));
  }

  /* ------------------------------------------------------------------ triggers */

  /**
   * ≥ 3 distinct senders with accounts younger than 7 days transferred into one account within 24 h → a
   * flag on the recipient, at most once per 24 h (Redis SET NX). Flag only.
   */
  async checkWalletFunnel(recipientId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ senderId: string; total: bigint }[]>`
      SELECT t.counterparty_user_id::text AS "senderId", sum(t.amount) AS total
      FROM wallet_transactions t JOIN users u ON u.id = t.counterparty_user_id
      WHERE t.user_id = ${recipientId}::uuid AND t.kind = 'transfer_in'
        AND t.created_at > now() - make_interval(hours => ${ANTIFRAUD.walletFunnelHours}::int)
        AND u.created_at > now() - make_interval(days => ${ANTIFRAUD.walletFunnelSenderMaxAgeDays}::int)
      GROUP BY t.counterparty_user_id`;
    if (rows.length < ANTIFRAUD.walletFunnelSenders) return false;
    const fresh = await this.redis.set(`af:funnel:${recipientId}`, '1', 'EX', ANTIFRAUD.walletFunnelHours * 3600, 'NX');
    if (fresh !== 'OK') return false;
    await this.flag('wallet_funnel', recipientId, {
      senderIds: rows.map((r) => r.senderId),
      total: rows.reduce((s, r) => s + Number(r.total), 0),
      windowHours: ANTIFRAUD.walletFunnelHours,
    });
    return true;
  }

  /**
   * ≥ 5 downvotes on one user within 24 h from voters whose account is < 30 days old or whose rating is
   * < 50 → a flag on the target, at most once per 24 h. Flag only.
   */
  async checkVoteBurst(targetId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ voterId: string }[]>`
      SELECT v.voter_id::text AS "voterId"
      FROM user_votes v JOIN users u ON u.id = v.voter_id
      WHERE v.target_id = ${targetId}::uuid AND v.value = -1
        AND v.created_at > now() - make_interval(hours => ${ANTIFRAUD.voteBurstHours}::int)
        AND (u.created_at > now() - make_interval(days => ${ANTIFRAUD.voteBurstNewAccountDays}::int) OR u.rating < ${ANTIFRAUD.voteBurstLowRating})`;
    if (rows.length < ANTIFRAUD.voteBurstDownvotes) return false;
    const fresh = await this.redis.set(`af:vote-burst:${targetId}`, '1', 'EX', ANTIFRAUD.voteBurstHours * 3600, 'NX');
    if (fresh !== 'OK') return false;
    await this.flag('vote_burst', targetId, { voterIds: rows.map((r) => r.voterId), count: rows.length, windowHours: ANTIFRAUD.voteBurstHours });
    return true;
  }

  /** A submitter's rejected violations reach 3 within 90 days → flag, at most once per 30 days. */
  async checkViolationRejections(submitterId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM violations
      WHERE submitter_id = ${submitterId}::uuid AND status = 'rejected'
        AND decided_at > now() - make_interval(days => ${ANTIFRAUD.violationRejectionsDays}::int)
      ORDER BY decided_at`;
    if (rows.length < ANTIFRAUD.violationRejectionsMin) return false;
    const fresh = await this.redis.set(`af:violation-rejections:${submitterId}`, '1', 'EX', 30 * 24 * 3600, 'NX');
    if (fresh !== 'OK') return false;
    await this.flag('violation_rejections', submitterId, { count: rows.length, violationIds: rows.map((r) => r.id), windowDays: ANTIFRAUD.violationRejectionsDays });
    return true;
  }

  async flag(kind: FraudFlagKind, userId: string | null, details: Record<string, unknown>): Promise<string> {
    const id = newId();
    await this.prisma.fraudFlag.create({ data: { id, kind, userId, details: details as Prisma.InputJsonObject } });
    this.logger.log({ kind, userId, details }, 'Fraud flag');
    return id;
  }

  /**
   * More than 2 SOS in 7 days that were cancelled by the user within 30 min of creation, or marked fake →
   * flag + automatic SOS ban for 72 h (skipped while a ban is already in force).
   */
  async checkCancelStreak(userId: string, sosId: string | null): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ n: number; ids: string[] }[]>`
      SELECT count(*)::int AS n, coalesce(array_agg(id::text ORDER BY created_at), '{}') AS ids
      FROM sos_requests
      WHERE user_id = ${userId}::uuid
        AND created_at > now() - make_interval(days => ${ANTIFRAUD.cancelStreakDays}::int)
        AND (
          is_fake
          OR (status = 'cancelled'
              AND closed_at <= created_at + make_interval(mins => ${ANTIFRAUD.cancelWindowMin}::int)
              AND coalesce(cancel_reason, '') NOT LIKE ${`${SYSTEM_CANCEL_PREFIX}%`})
        )`;
    const { n, ids } = rows[0] ?? { n: 0, ids: [] };
    if (n < ANTIFRAUD.cancelStreakMin) return false;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { sosBannedUntil: true, role: true, status: true } });
    if (!user || user.status === 'deleted' || user.role === 'admin') return false;
    if (user.sosBannedUntil && user.sosBannedUntil.getTime() > Date.now()) return false;
    const until = new Date(Date.now() + ANTIFRAUD.cancelStreakBanHours * HOUR_MS);
    await this.flag('sos_cancel_streak', userId, { count: n, sosIds: ids, triggerSosId: sosId, bannedUntil: until.toISOString() });
    await this.sanctions.sosBan(userId, until, null, true);
    return true;
  }

  /**
   * Two users who helped each other (closed, non-fake SOS with the helper `arrived`, in both directions)
   * at least ANTIFRAUD.reciprocalSosMin times within ANTIFRAUD.reciprocalSosDays → a flag on each of them
   * (once per pair per window; Redis SET NX). Flag only: an admin decides.
   */
  async checkReciprocalSos(a: string, b: string, sosId: string | null): Promise<boolean> {
    if (a === b) return false;
    const rows = await this.prisma.$queryRaw<{ requester: string; helper: string; sosId: string }[]>`
      SELECT s.user_id AS requester, r.helper_id AS helper, s.id::text AS "sosId"
      FROM sos_requests s
      JOIN sos_responses r ON r.sos_id = s.id AND r.status = 'arrived'
      WHERE s.status = 'closed' AND NOT s.is_fake
        AND s.closed_at > now() - make_interval(days => ${ANTIFRAUD.reciprocalSosDays}::int)
        AND ((s.user_id = ${a}::uuid AND r.helper_id = ${b}::uuid) OR (s.user_id = ${b}::uuid AND r.helper_id = ${a}::uuid))`;
    const aHelpedB = rows.filter((r) => r.helper === a).length;
    const bHelpedA = rows.filter((r) => r.helper === b).length;
    if (!aHelpedB || !bHelpedA || rows.length < ANTIFRAUD.reciprocalSosMin) return false;
    const pair = a < b ? `${a}:${b}` : `${b}:${a}`;
    const fresh = await this.redis.set(`af:reciprocal:${pair}`, '1', 'EX', ANTIFRAUD.reciprocalSosDays * 24 * 3600, 'NX');
    if (fresh !== 'OK') return false;
    const sosIds = rows.map((r) => r.sosId);
    await this.flag('reciprocal_sos', a, { otherUserId: b, helps: rows.length, sosIds, triggerSosId: sosId, windowDays: ANTIFRAUD.reciprocalSosDays });
    await this.flag('reciprocal_sos', b, { otherUserId: a, helps: rows.length, sosIds, triggerSosId: sosId, windowDays: ANTIFRAUD.reciprocalSosDays });
    return true;
  }

  /** An account younger than 24 h created an SOS → flag only. */
  async checkNewAccountSos(userId: string, sosId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
    if (!user) return false;
    const ageMs = Date.now() - user.createdAt.getTime();
    if (ageMs >= ANTIFRAUD.newAccountHours * HOUR_MS) return false;
    await this.flag('new_account_sos', userId, { sosId, accountAgeMin: Math.floor(ageMs / 60_000) });
    return true;
  }

  /** An SOS photo whose content hash matches a photo of another user's SOS from the last 30 days → flag only. */
  async checkDuplicateSosPhotos(userId: string, sosId: string, photoIds: string[]): Promise<boolean> {
    const matches = await this.prisma.$queryRaw<{ uploadId: string; otherSosId: string; otherUserId: string }[]>`
      SELECT DISTINCT ON (u1.id) u1.id AS "uploadId", s2.id AS "otherSosId", s2.user_id AS "otherUserId"
      FROM uploads u1
      JOIN uploads u2 ON u2.content_hash = u1.content_hash AND u2.id <> u1.id
      JOIN sos_requests s2 ON s2.photo_upload_ids @> ARRAY[u2.id]
      WHERE u1.id = ANY(${photoIds}::uuid[]) AND u1.content_hash IS NOT NULL
        AND s2.user_id <> ${userId}::uuid
        AND s2.created_at > now() - make_interval(days => ${ANTIFRAUD.duplicatePhotoDays}::int)
      ORDER BY u1.id, s2.created_at DESC`;
    if (!matches.length) return false;
    await this.flag('duplicate_sos_photo', userId, { sosId, matches });
    return true;
  }

  /**
   * ≥ 3 distinct credible reporters (account ≥ 7 days old, rating ≥ 40, none of their reports ever
   * dismissed) with open reports against the user within 24 h → flag (once per 24 h), plus a temporary
   * 24 h block when the user's rating is below 30. Concurrent reports run this concurrently: a Redis
   * SET NX on `af:burst:{userId}` (24 h) lets exactly one of them flag / block.
   */
  async checkReportBurst(targetUserId: string): Promise<boolean> {
    const since = new Date(Date.now() - ANTIFRAUD.reportBurstHours * HOUR_MS);
    const minCreated = new Date(Date.now() - ANTIFRAUD.reportBurstReporterMinAgeDays * 24 * HOUR_MS);
    const reporters = await this.prisma.$queryRaw<{ reporterId: string }[]>`
      SELECT DISTINCT r.reporter_id AS "reporterId"
      FROM reports r
      JOIN users u ON u.id = r.reporter_id
      WHERE r.target_user_id = ${targetUserId}::uuid AND r.status = 'open' AND r.created_at > ${since}
        AND u.created_at <= ${minCreated} AND u.rating >= ${ANTIFRAUD.reportBurstReporterMinRating}::int
        AND NOT EXISTS (SELECT 1 FROM reports d WHERE d.reporter_id = r.reporter_id AND d.status = 'dismissed')`;
    if (reporters.length < ANTIFRAUD.reportBurstReporters) return false;
    const recent = await this.prisma.fraudFlag.count({ where: { userId: targetUserId, kind: 'report_burst', createdAt: { gt: since } } });
    if (recent) return false;
    const fresh = await this.redis.set(`af:burst:${targetUserId}`, '1', 'EX', ANTIFRAUD.reportBurstHours * 3600, 'NX');
    if (fresh !== 'OK') return false;
    const user = await this.prisma.user.findUnique({ where: { id: targetUserId }, select: { rating: true, role: true, status: true, blockedUntil: true } });
    if (!user || user.status === 'deleted') return false;
    const alreadyBlocked = user.status === 'blocked' && (!user.blockedUntil || user.blockedUntil.getTime() > Date.now());
    const block = user.rating < ANTIFRAUD.reportBurstBlockBelowRating && user.role !== 'admin' && !alreadyBlocked;
    const until = block ? new Date(Date.now() + ANTIFRAUD.reportBurstBlockHours * HOUR_MS) : null;
    await this.flag('report_burst', targetUserId, {
      reporters: reporters.length,
      rating: user.rating,
      blockedUntil: until?.toISOString() ?? null,
    });
    if (until) await this.sanctions.block(targetUserId, { until, note: null, automatic: true });
    return true;
  }

  /** Counts implausible jumps (Redis, sliding 1 h); the 3rd within an hour → flag (at most one per hour). */
  async recordLocationJump(userId: string): Promise<boolean> {
    const key = `af:teleport:${userId}`;
    const now = Date.now();
    const windowMs = ANTIFRAUD.teleportWindowMin * 60_000;
    const [, , [, count]] = (await this.redis
      .multi()
      .zadd(key, now, `${now}-${Math.random()}`)
      .zremrangebyscore(key, '-inf', now - windowMs)
      .zcard(key)
      .pexpire(key, windowMs)
      .exec()) as [unknown, unknown, [unknown, number], unknown];
    if (count < ANTIFRAUD.teleportJumps) return false;
    const fresh = await this.redis.set(`af:teleport:flagged:${userId}`, '1', 'PX', windowMs, 'NX');
    if (fresh !== 'OK') return false;
    await this.flag('location_teleport', userId, { jumps: count, windowMin: ANTIFRAUD.teleportWindowMin });
    return true;
  }

  /** Counts lockouts per phone (Redis, sliding 24 h); more than 3 → flag (at most one per 24 h). */
  async recordOtpLockout(phone: string): Promise<boolean> {
    const digest = createHash('sha256').update(phone).digest('hex').slice(0, 32);
    const key = `af:otp-lockouts:${digest}`;
    const now = Date.now();
    const windowMs = ANTIFRAUD.otpWindowHours * HOUR_MS;
    const [, , [, count]] = (await this.redis
      .multi()
      .zadd(key, now, `${now}-${Math.random()}`)
      .zremrangebyscore(key, '-inf', now - windowMs)
      .zcard(key)
      .pexpire(key, windowMs)
      .exec()) as [unknown, unknown, [unknown, number], unknown];
    if (count < ANTIFRAUD.otpLockoutsMin) return false;
    const fresh = await this.redis.set(`af:otp-lockouts:flagged:${digest}`, '1', 'PX', windowMs, 'NX');
    if (fresh !== 'OK') return false;
    const user = await this.prisma.user.findUnique({ where: { phone }, select: { id: true } });
    await this.flag('otp_abuse', user?.id ?? null, { phoneMasked: maskPhone(phone), lockouts: count, windowHours: ANTIFRAUD.otpWindowHours });
    return true;
  }
}
