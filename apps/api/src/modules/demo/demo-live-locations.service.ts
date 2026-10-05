import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { demoStep } from './demo-path';

export const DEMO_TICK_MS = 60_000;
export const DEMO_LOCK_KEY = 'demo:live-locations:lock';
/** Seeded accounts someone signed in as within this window are left alone (their position is the visitor's). */
export const DEMO_SKIP_ACTIVE_MINUTES = 15;

/**
 * DEMO_LIVE_LOCATIONS: every minute, seeded users with a location move one step along a small deterministic
 * loop and get a fresh `updated_at`, so the demo map is never empty. Only `users.is_seed` rows are touched.
 * With several API instances a Redis lock (expiring before the next tick) elects one runner per tick.
 */
@Injectable()
export class DemoLiveLocationsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DemoLiveLocationsService.name);
  private readonly instanceId = randomUUID();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.DEMO_LIVE_LOCATIONS) return;
    const run = () => void this.runIfLeader().catch((err: unknown) => this.logger.warn({ err }, 'Demo live locations tick failed'));
    this.timer = setInterval(run, DEMO_TICK_MS);
    this.timer.unref();
    run(); // refresh right away: after a cold start every seeded position is stale
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Runs a tick only if this instance wins this minute's lock. Returns moved users, or null if skipped. */
  async runIfLeader(now = Date.now()): Promise<number | null> {
    const won = await this.redis.set(DEMO_LOCK_KEY, this.instanceId, 'PX', DEMO_TICK_MS - 5_000, 'NX');
    return won === 'OK' ? this.tick(now) : null;
  }

  /** Moves every eligible seeded user one step; one read and one batched write. */
  async tick(now = Date.now()): Promise<number> {
    const tick = Math.floor(now / DEMO_TICK_MS);
    const rows = await this.prisma.$queryRaw<{ userId: string; lat: number; lng: number }[]>`
      SELECT ul.user_id AS "userId", ST_Y(ul.location::geometry) AS lat, ST_X(ul.location::geometry) AS lng
      FROM user_locations ul
      JOIN users u ON u.id = ul.user_id
      WHERE u.is_seed AND u.status = 'active'
        AND (u.last_active_at IS NULL OR u.last_active_at < now() - make_interval(mins => ${DEMO_SKIP_ACTIVE_MINUTES}::int))`;
    if (!rows.length) return 0;
    const next = rows.map((r) => demoStep(r.userId, r.lat, r.lng, tick));
    await this.prisma.$executeRaw`
      UPDATE user_locations ul
      SET location = ST_SetSRID(ST_MakePoint(d.lng, d.lat), 4326)::geography, updated_at = now()
      FROM unnest(${rows.map((r) => r.userId)}::uuid[], ${next.map((p) => p.lat)}::float8[], ${next.map((p) => p.lng)}::float8[])
        AS d(user_id, lat, lng)
      WHERE ul.user_id = d.user_id`;
    return rows.length;
  }
}
