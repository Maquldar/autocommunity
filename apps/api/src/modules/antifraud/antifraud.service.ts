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

  /* ------------------------------------------------------------------ triggers */

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
   * ≥ 3 distinct reporters with open reports against the user within 24 h → flag (once per 24 h), plus a
   * temporary 24 h block when the user's rating is below 30.
   */
  async checkReportBurst(targetUserId: string): Promise<boolean> {
    const since = new Date(Date.now() - ANTIFRAUD.reportBurstHours * HOUR_MS);
    const reporters = await this.prisma.report.findMany({
      where: { targetUserId, status: 'open', createdAt: { gt: since } },
      distinct: ['reporterId'],
      select: { reporterId: true },
    });
    if (reporters.length < ANTIFRAUD.reportBurstReporters) return false;
    const recent = await this.prisma.fraudFlag.count({ where: { userId: targetUserId, kind: 'report_burst', createdAt: { gt: since } } });
    if (recent) return false;
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
