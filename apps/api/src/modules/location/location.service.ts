import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { AntifraudService } from '../antifraud/antifraud.service';

/** Updates closer together than this are acknowledged but not written. */
export const LOCATION_MIN_INTERVAL_MS = 10_000;

const throttleKey = (userId: string) => `loc:throttle:${userId}`;

/** Faster than this between two updates is implausible for a car (300 km/h). */
export const MAX_PLAUSIBLE_SPEED_MPS = 300 / 3.6;
/** How long an implausible position stays untrusted. */
export const UNTRUSTED_MINUTES = 10;

/**
 * SQL for a position that is fresh (< 15 min) and trusted, for SOS visibility, nearby, map/sos and dispatch.
 * `alias` is the user_locations alias.
 */
export const trustedFreshLocation = (alias: string) =>
  `${alias}.updated_at > now() - interval '15 minutes' AND (${alias}.untrusted_until IS NULL OR ${alias}.untrusted_until <= now())`;

@Injectable()
export class LocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly antifraud: AntifraudService,
  ) {}

  /**
   * Upserts the user's single last position (no history is kept). Stored in every privacy mode — `hidden`
   * only affects who can read it. Returns false when throttled.
   */
  async update(userId: string, input: { lat: number; lng: number; accuracyM?: number }): Promise<boolean> {
    const fresh = await this.redis.set(throttleKey(userId), '1', 'PX', LOCATION_MIN_INTERVAL_MS, 'NX');
    if (fresh !== 'OK') return false;
    await this.write(userId, input.lat, input.lng, input.accuracyM ?? null);
    return true;
  }

  /** Writes the position now, bypassing the throttle (e.g. the requester's position when creating an SOS). */
  async storeNow(userId: string, input: { lat: number; lng: number }): Promise<void> {
    await this.redis.set(throttleKey(userId), '1', 'PX', LOCATION_MIN_INTERVAL_MS);
    await this.write(userId, input.lat, input.lng, null);
  }

  /**
   * Upsert of the single last position (source client). If reaching it from the previous position implies
   * more than 300 km/h, it is stored but marked untrusted for 10 minutes (an earlier untrusted mark is kept
   * until it runs out). Decided in the same statement, so concurrent updates can't skip the check.
   */
  private async write(userId: string, lat: number, lng: number, accuracyM: number | null): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ jumped: boolean }[]>`
      INSERT INTO user_locations (user_id, location, accuracy_m, source, updated_at)
      VALUES (
        ${userId}::uuid,
        ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326)::geography,
        ${accuracyM}::float8,
        'client',
        now()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        untrusted_until = CASE
          WHEN ST_Distance(user_locations.location, EXCLUDED.location)
               / GREATEST(EXTRACT(EPOCH FROM (now() - user_locations.updated_at)), 1) > ${MAX_PLAUSIBLE_SPEED_MPS}::float8
            THEN now() + make_interval(mins => ${UNTRUSTED_MINUTES}::int)
          ELSE user_locations.untrusted_until
        END,
        location = EXCLUDED.location,
        accuracy_m = EXCLUDED.accuracy_m,
        source = 'client',
        updated_at = EXCLUDED.updated_at
      -- now() is fixed per statement: equal only when this update set the mark (an implausible jump).
      RETURNING untrusted_until IS NOT DISTINCT FROM (now() + make_interval(mins => ${UNTRUSTED_MINUTES}::int))::timestamp(3) AS jumped`;
    if (rows[0]?.jumped) this.antifraud.locationJump(userId);
  }

  async remove(userId: string): Promise<void> {
    await this.prisma.userLocation.deleteMany({ where: { userId } });
    // The next PUT (e.g. sharing turned back on) is written immediately.
    await this.redis.del(throttleKey(userId));
  }
}
