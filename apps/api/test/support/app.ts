import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { AuthResult, UserRole } from '@autoc/shared';
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

/** Boots the real app; `envOverrides` replace variables from the test environment (vitest.config.ts). */
export async function createTestApp(envOverrides: Record<string, string> = {}): Promise<TestApp> {
  const env = parseEnvOrThrow({ ...process.env, ...envOverrides });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ENV).useValue(env).compile();
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

/** Creates an onboarded user directly in the DB and returns a valid access token for it. */
export async function createUser(
  t: TestApp,
  data: { nickname?: string | null; name?: string; role?: UserRole; onboarded?: boolean; phone?: string } = {},
): Promise<{ id: string; token: string }> {
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
