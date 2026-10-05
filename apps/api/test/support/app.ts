import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { AuthResult, PrivacyMode, UserRole } from '@autoc/shared';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { APP_OPTIONS, configureApp } from '../../src/bootstrap';
import { AccessTokenService } from '../../src/common/auth/access-token.service';
import { newId } from '../../src/common/ids';
import { ENV, parseEnvOrThrow } from '../../src/config/env';
import { PrismaService } from '../../src/infra/prisma/prisma.service';
import { RedisService } from '../../src/infra/redis/redis.service';
import { friendPairKey } from '../../src/modules/users/relation.service';

export type TestApp = {
  app: INestApplication;
  http: App;
  prisma: PrismaService;
  redis: RedisService;
  api: () => ReturnType<typeof request.agent>;
  close: () => Promise<void>;
};

export type ProviderOverride = { provide: unknown; useValue: unknown };

/**
 * Boots the real app; `envOverrides` replace variables from the test environment (vitest.config.ts) and
 * `overrides` replace providers at the boundary (e.g. the Web Push sender).
 */
export async function createTestApp(envOverrides: Record<string, string> = {}, overrides: ProviderOverride[] = []): Promise<TestApp> {
  const env = parseEnvOrThrow({ ...process.env, ...envOverrides });
  let builder = Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ENV).useValue(env);
  for (const o of overrides) builder = builder.overrideProvider(o.provide).useValue(o.useValue);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ ...APP_OPTIONS, logger: false });
  configureApp(app, env);
  await app.init();
  const http = app.getHttpServer() as App;
  return {
    app,
    http,
    prisma: app.get(PrismaService),
    redis: app.get(RedisService),
    api: () => request.agent(http),
    close: () => app.close(),
  };
}

let ipSeq = 0;
/**
 * A fresh client IP per call, sent as X-Forwarded-For. The test env sets TRUST_PROXY=loopback explicitly
 * (the production default is false), so supertest's loopback connection is treated as a trusted proxy.
 */
export const nextIp = () => `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`;

let phoneSeq = 1_000_000;
export const nextPhone = () => `+7701${String(phoneSeq++).padStart(7, '0')}`;

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Parses Set-Cookie headers into name → value (empty value for cleared cookies). */
export function readCookies(res: { headers: Record<string, unknown> }): Record<string, string> {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
  const out: Record<string, string> = {};
  for (const c of list) {
    const [pair] = c.split(';');
    const idx = pair!.indexOf('=');
    out[pair!.slice(0, idx)] = decodeURIComponent(pair!.slice(idx + 1));
  }
  return out;
}

export type LoggedIn = AuthResult & { refreshToken: string; csrfToken: string; phone: string };

/** Full OTP login through the public API using the dev code. */
export async function loginWithOtp(t: TestApp, phone = nextPhone()): Promise<LoggedIn> {
  const req = await request(t.http).post('/api/v1/auth/otp/request').set('X-Forwarded-For', nextIp()).send({ phone });
  if (req.status !== 200) throw new Error(`otp/request failed: ${req.status} ${JSON.stringify(req.body)}`);
  const res = await request(t.http)
    .post('/api/v1/auth/otp/verify')
    .set('X-Forwarded-For', nextIp())
    .send({ phone, code: req.body.devCode });
  if (res.status !== 200) throw new Error(`otp/verify failed: ${res.status} ${JSON.stringify(res.body)}`);
  const cookies = readCookies(res);
  return { ...(res.body as AuthResult), refreshToken: cookies.ac_rt!, csrfToken: cookies.ac_csrf!, phone };
}

export type CreateUserData = {
  nickname?: string | null;
  name?: string;
  role?: UserRole;
  onboarded?: boolean;
  phone?: string;
  privacyMode?: PrivacyMode;
  status?: 'active' | 'blocked' | 'deleted';
  blockedUntil?: Date | null;
  isSeed?: boolean;
  locale?: 'ru' | 'en';
  lastActiveAt?: Date | null;
};

/** Creates an onboarded user directly in the DB and returns a valid access token for it. */
export async function createUser(t: TestApp, data: CreateUserData = {}): Promise<{ id: string; token: string }> {
  const id = newId();
  const nickname = data.nickname === undefined ? `user_${id.slice(-8)}` : data.nickname;
  await t.prisma.user.create({
    data: {
      id,
      name: data.name ?? 'Test User',
      nickname,
      role: data.role ?? 'user',
      phone: data.phone ?? nextPhone(),
      phoneVerifiedAt: new Date(),
      onboardedAt: data.onboarded === false ? null : new Date(),
      privacyMode: data.privacyMode,
      status: data.status,
      blockedUntil: data.blockedUntil,
      isSeed: data.isSeed,
      locale: data.locale,
      lastActiveAt: data.lastActiveAt,
    },
  });
  const token = await t.app.get(AccessTokenService).sign(id, data.role ?? 'user');
  return { id, token };
}

export async function makeFriends(t: TestApp, a: string, b: string, status: 'pending' | 'accepted' = 'accepted') {
  await t.prisma.friendship.create({
    data: { id: newId(), requesterId: a, addresseeId: b, pairKey: friendPairKey(a, b), status, acceptedAt: status === 'accepted' ? new Date() : null },
  });
}

/** Stores a position directly (bypassing the 10 s throttle), `minutesAgo` old. */
export async function setLocation(
  t: TestApp,
  userId: string,
  lat: number,
  lng: number,
  minutesAgo = 0,
  source: 'seed' | 'client' = 'client',
): Promise<void> {
  await t.prisma.$executeRaw`
    INSERT INTO user_locations (user_id, location, source, updated_at)
    VALUES (${userId}::uuid, ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326)::geography,
            ${source}::"LocationSource", now() - make_interval(secs => ${minutesAgo * 60}::float8))
    ON CONFLICT (user_id) DO UPDATE SET location = EXCLUDED.location, source = EXCLUDED.source, updated_at = EXCLUDED.updated_at`;
}

export async function getLocation(t: TestApp, userId: string): Promise<{ lat: number; lng: number; updatedAt: Date } | null> {
  const rows = await t.prisma.$queryRaw<{ lat: number; lng: number; updatedAt: Date }[]>`
    SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, updated_at AS "updatedAt"
    FROM user_locations WHERE user_id = ${userId}::uuid`;
  return rows[0] ?? null;
}

/** A community owned by `ownerId` with the given members (status active unless stated), its chat and a consistent memberCount. */
export async function createCommunity(
  t: TestApp,
  ownerId: string,
  members: { userId: string; status?: 'active' | 'pending'; role?: 'member' | 'moderator' }[] = [],
  opts: { deleted?: boolean; isPrivate?: boolean; name?: string } = {},
): Promise<string> {
  const id = newId();
  const active = members.filter((m) => (m.status ?? 'active') === 'active');
  await t.prisma.community.create({
    data: {
      id,
      name: opts.name ?? `Community ${id.slice(-12)}`,
      ownerId,
      isPrivate: opts.isPrivate ?? false,
      memberCount: 1 + active.length,
      deletedAt: opts.deleted ? new Date() : null,
    },
  });
  await t.prisma.communityMember.createMany({
    data: [
      { communityId: id, userId: ownerId, role: 'owner', status: 'active', joinedAt: new Date() },
      ...members.map((m) => ({
        communityId: id,
        userId: m.userId,
        role: m.role ?? ('member' as const),
        status: m.status ?? ('active' as const),
        joinedAt: (m.status ?? 'active') === 'active' ? new Date() : null,
      })),
    ],
  });
  await t.prisma.chat.create({
    data: {
      id: newId(),
      type: 'community',
      refId: id,
      members: { create: opts.deleted ? [] : [{ userId: ownerId }, ...active.map((m) => ({ userId: m.userId }))] },
    },
  });
  return id;
}

/** Polls until `check` returns a truthy value (or throws after `timeoutMs`). */
export async function waitFor<T>(check: () => Promise<T> | T, timeoutMs = 5_000, intervalMs = 25): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value as NonNullable<T>;
    if (Date.now() > deadline) throw new Error('waitFor: condition not met in time');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
