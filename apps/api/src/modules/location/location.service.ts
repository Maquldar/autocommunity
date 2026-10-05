import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';

/** Updates closer together than this are acknowledged but not written. */
export const LOCATION_MIN_INTERVAL_MS = 10_000;

const throttleKey = (userId: string) => `loc:throttle:${userId}`;

@Injectable()
export class LocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Upserts the user's single last position (no history is kept). Stored in every privacy mode — `hidden`
   * only affects who can read it. Returns false when throttled.
   */
  async update(userId: string, input: { lat: number; lng: number; accuracyM?: number }): Promise<boolean> {
    const fresh = await this.redis.set(throttleKey(userId), '1', 'PX', LOCATION_MIN_INTERVAL_MS, 'NX');
    if (fresh !== 'OK') return false;
    await this.prisma.$executeRaw`
      INSERT INTO user_locations (user_id, location, accuracy_m, source, updated_at)
      VALUES (
        ${userId}::uuid,
        ST_SetSRID(ST_MakePoint(${input.lng}::float8, ${input.lat}::float8), 4326)::geography,
        ${input.accuracyM ?? null}::float8,
        'client',
        now()
      )
      ON CONFLICT (user_id) DO UPDATE
        SET location = EXCLUDED.location, accuracy_m = EXCLUDED.accuracy_m, source = 'client', updated_at = EXCLUDED.updated_at`;
    return true;
  }

  async remove(userId: string): Promise<void> {
    await this.prisma.userLocation.deleteMany({ where: { userId } });
    // The next PUT (e.g. sharing turned back on) is written immediately.
    await this.redis.del(throttleKey(userId));
  }
}
