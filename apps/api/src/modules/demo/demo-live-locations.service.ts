import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { BackgroundTasks } from '../../infra/tasks/background-tasks';
import { DEFAULT_MAP_CENTER, SOS_TYPES } from '@autoc/shared';
import { newId } from '../../common/ids';
import { demoStep } from './demo-path';

/** Demo accounts people sign in to; they never become the requester of the keep-alive SOS. */
const DEMO_LOGIN_PHONES = ['+77000000001', '+77000000002'];
const DEMO_SOS_TEXTS: Record<string, string> = {
  flat_tire: 'Пробил колесо, нужен баллонный ключ или компрессор.',
  battery: 'Сел аккумулятор, нужны провода для прикуривания.',
  fuel: 'Закончился бензин, нужна канистра.',
  stuck: 'Застрял во дворе в снегу, нужен трос и пара рук.',
  breakdown: 'Заглох и не заводится, нужна консультация.',
  accident: 'Мелкое ДТП без пострадавших, нужен свидетель.',
  tow: 'Нужен эвакуатор до сервиса.',
  other: 'Нужна помощь на дороге.',
};

export const DEMO_TICK_MS = 60_000;
export const DEMO_LOCK_KEY = 'demo:live-locations:lock';

/**
 * DEMO_LIVE_LOCATIONS: every minute, seeded users with a location move one step along a small deterministic
 * loop and get a fresh `updated_at`, so the demo map is never empty. Only positions written by the seed
 * (`user_locations.source = 'seed'`) of `users.is_seed` accounts are touched: once anyone — e.g. a visitor
 * signed in to the shared demo account — sends a real position (source `client`), it is never refreshed and
 * expires after 15 minutes like any other.
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
    private readonly tasks: BackgroundTasks,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.DEMO_LIVE_LOCATIONS) return;
    const run = () => this.tasks.run('Demo live locations tick', () => this.runIfLeader());
    this.timer = setInterval(run, DEMO_TICK_MS);
    this.timer.unref();
    this.tasks.registerProducer('demo live locations timer', () => this.stopTimer());
    run(); // refresh right away: after a cold start every seeded position is stale
  }

  onApplicationShutdown(): void {
    this.stopTimer();
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Runs a tick only if this instance wins this minute's lock. Returns moved users, or null if skipped. */
  async runIfLeader(now = Date.now()): Promise<number | null> {
    const won = await this.redis.set(DEMO_LOCK_KEY, this.instanceId, 'PX', DEMO_TICK_MS - 5_000, 'NX');
    if (won !== 'OK') return null;
    const moved = await this.tick(now);
    await this.ensureDemoSos(now).catch((err: unknown) => this.logger.warn({ err }, 'Demo SOS keep-alive failed'));
    return moved;
  }

  /**
   * Keeps one open SOS from a seed account near the centre: when none is open (the previous one expired,
   * closed or was cancelled) a new one is created directly (no dispatch). Returns the new SOS id, if any.
   */
  async ensureDemoSos(now = Date.now()): Promise<string | null> {
    const open = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM sos_requests s JOIN users u ON u.id = s.user_id
      WHERE u.is_seed AND s.status IN ('created', 'accepted', 'in_progress')`;
    if (open[0]!.n > 0) return null;
    const tick = Math.floor(now / DEMO_TICK_MS);
    const candidates = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT u.id FROM users u
      WHERE u.is_seed AND u.status = 'active' AND u.onboarded_at IS NOT NULL
        AND (u.phone IS NULL OR u.phone <> ALL(${DEMO_LOGIN_PHONES}::text[]))
      ORDER BY u.id`;
    if (!candidates.length) return null;
    const requester = candidates[tick % candidates.length]!.id;
    const type = SOS_TYPES[tick % SOS_TYPES.length]!;
    const angle = (tick % 12) * (Math.PI / 6);
    const lat = DEFAULT_MAP_CENTER.lat + 0.008 * Math.sin(angle);
    const lng = DEFAULT_MAP_CENTER.lng + 0.011 * Math.cos(angle);
    const id = newId();
    const created = new Date(now);
    const expires = new Date(now + this.env.SOS_TTL_SEC * 1000);
    try {
      await this.prisma.$executeRaw`
        INSERT INTO sos_requests (id, user_id, type, description, location, status, share_phone, radius_m, created_at, expires_at, updated_at)
        VALUES (${id}::uuid, ${requester}::uuid, ${type}::"SosType", ${DEMO_SOS_TEXTS[type] ?? ''},
                ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326)::geography, 'created', false, 5000,
                ${created}, ${expires}, ${created})`;
    } catch (err) {
      // That seed user already has an open SOS (unique index): next tick tries another one.
      this.logger.warn({ err }, 'Demo SOS creation skipped');
      return null;
    }
    return id;
  }

  /** Moves every eligible seeded user one step; one read and one batched write. */
  async tick(now = Date.now()): Promise<number> {
    const tick = Math.floor(now / DEMO_TICK_MS);
    const rows = await this.prisma.$queryRaw<{ userId: string; lat: number; lng: number }[]>`
      SELECT ul.user_id AS "userId", ST_Y(ul.location::geometry) AS lat, ST_X(ul.location::geometry) AS lng
      FROM user_locations ul
      JOIN users u ON u.id = ul.user_id
      WHERE ul.source = 'seed' AND u.is_seed AND u.status = 'active'`;
    if (!rows.length) return 0;
    const next = rows.map((r) => demoStep(r.userId, r.lat, r.lng, tick));
    await this.prisma.$executeRaw`
      UPDATE user_locations ul
      SET location = ST_SetSRID(ST_MakePoint(d.lng, d.lat), 4326)::geography, updated_at = now()
      FROM unnest(${rows.map((r) => r.userId)}::uuid[], ${next.map((p) => p.lat)}::float8[], ${next.map((p) => p.lng)}::float8[])
        AS d(user_id, lat, lng)
      WHERE ul.user_id = d.user_id AND ul.source = 'seed'`;
    return rows.length;
  }
}
