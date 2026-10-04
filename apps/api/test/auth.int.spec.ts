import { LIMITS } from '@autoc/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApp, createUser, loginWithOtp, nextIp, nextPhone, readCookies, type TestApp } from './support/app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const otpRequest = (phone: string, ip = nextIp()) =>
  request(t.http).post('/api/v1/auth/otp/request').set('X-Forwarded-For', ip).send({ phone });
const otpVerify = (phone: string, code: string, ip = nextIp()) =>
  request(t.http).post('/api/v1/auth/otp/verify').set('X-Forwarded-For', ip).send({ phone, code });
const refresh = (refreshToken: string, csrf: string | null) => {
  const r = request(t.http)
    .post('/api/v1/auth/refresh')
    .set('Cookie', [`ac_rt=${refreshToken}`, `ac_csrf=${csrf ?? 'x'}`]);
  return csrf ? r.set('X-CSRF-Token', csrf) : r;
};
/** Lets the next code be requested immediately (the 60 s resend cooldown is covered by its own test). */
const skipCooldown = (phone: string) => t.redis.del(`rl:otp:phone:cooldown:${phone}`);
const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

describe('GET /auth/providers', () => {
  it('reports disabled OAuth providers and dev OTP', async () => {
    const res = await request(t.http).get('/api/v1/auth/providers').expect(200);
    expect(res.body).toEqual({ google: null, apple: null, devOtp: true });
  });

  it('rejects Google/Apple sign-in when not configured', async () => {
    const res = await request(t.http).post('/api/v1/auth/google').send({ idToken: 'x'.repeat(20) }).expect(404);
    expect(res.body.error.code).toBe('PROVIDER_DISABLED');
    await request(t.http).post('/api/v1/auth/apple').send({ idToken: 'x'.repeat(20) }).expect(404);
  });
});

describe('OTP login', () => {
  it('creates a new user on first verify and logs in the same user later', async () => {
    const phone = nextPhone();
    const reqRes = await otpRequest(phone.replace('+7', '8')).expect(200);
    expect(reqRes.body.retryAfterSec).toBe(LIMITS.otpResendSec);
    expect(reqRes.body.devCode).toMatch(/^\d{6}$/);

    const res = await otpVerify(phone, reqRes.body.devCode).expect(200);
    expect(res.body.isNew).toBe(true);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({
      phone,
      phoneVerified: true,
      nickname: null,
      onboardingCompleted: false,
      rating: 50,
      privacyMode: 'community',
      receiveSos: true,
      role: 'user',
      relation: 'self',
    });

    const cookies = res.headers['set-cookie'] as unknown as string[];
    const rt = cookies.find((c) => c.startsWith('ac_rt='))!;
    expect(rt).toMatch(/HttpOnly/);
    expect(rt).toMatch(/Path=\/api\/v1\/auth/);
    expect(rt).toMatch(/SameSite=Strict/);
    const csrf = cookies.find((c) => c.startsWith('ac_csrf='))!;
    expect(csrf).not.toMatch(/HttpOnly/);

    const stored = await t.prisma.otpCode.findFirst({ where: { phone } });
    expect(stored!.codeHash).not.toContain(reqRes.body.devCode);

    await skipCooldown(phone);
    const again = await otpRequest(phone).expect(200);
    const second = await otpVerify(phone, again.body.devCode).expect(200);
    expect(second.body.isNew).toBe(false);
    expect(second.body.user.id).toBe(res.body.user.id);
  });

  it('a code cannot be used twice', async () => {
    const phone = nextPhone();
    const { body } = await otpRequest(phone).expect(200);
    await otpVerify(phone, body.devCode).expect(200);
    const res = await otpVerify(phone, body.devCode).expect(400);
    expect(res.body.error.code).toBe('OTP_EXPIRED');
  });

  it('a newer code invalidates the previous one', async () => {
    const phone = nextPhone();
    const first = await otpRequest(phone).expect(200);
    await skipCooldown(phone);
    const second = await otpRequest(phone).expect(200);
    if (first.body.devCode !== second.body.devCode) {
      expect((await otpVerify(phone, first.body.devCode)).body.error.code).toBe('OTP_INVALID');
    }
    await otpVerify(phone, second.body.devCode).expect(200);
  });

  it('burns a code after 5 wrong attempts', async () => {
    const phone = nextPhone();
    const { body } = await otpRequest(phone).expect(200);
    const bad = wrongCode(body.devCode);
    for (let i = 1; i <= LIMITS.otpMaxAttempts; i++) {
      const res = await otpVerify(phone, bad).expect(400);
      expect(res.body.error).toMatchObject({ code: 'OTP_INVALID', details: { attemptsLeft: LIMITS.otpMaxAttempts - i } });
    }
    const res = await otpVerify(phone, body.devCode).expect(400);
    expect(res.body.error.code).toBe('OTP_EXPIRED');
  });

  it('locks out a phone+IP after 10 failures in an hour without locking out the owner elsewhere', async () => {
    const phone = nextPhone();
    const attackerIp = nextIp();
    let code = (await otpRequest(phone).expect(200)).body.devCode as string;
    for (let i = 0; i < 10; i++) {
      if (i === 5) {
        await skipCooldown(phone);
        code = (await otpRequest(phone).expect(200)).body.devCode;
      }
      await otpVerify(phone, wrongCode(code), attackerIp).expect(400);
    }
    const locked = await otpVerify(phone, code, attackerIp).expect(429);
    expect(locked.body.error.code).toBe('RATE_LIMITED');
    expect(locked.body.error.details.retryAfterSec).toBeGreaterThan(0);
    expect(locked.headers['retry-after']).toBeDefined();
    await skipCooldown(phone);
    await otpRequest(phone, attackerIp).expect(429);

    // The real owner on another IP is unaffected (third parties can't lock them out).
    const ownerIp = nextIp();
    await skipCooldown(phone);
    const fresh = (await otpRequest(phone, ownerIp).expect(200)).body.devCode as string;
    await otpVerify(phone, fresh, ownerIp).expect(200);
  });

  it('caps failures per phone across all IPs at 30 per hour', async () => {
    const phone = nextPhone();
    for (let round = 0; round < 6; round++) {
      await skipCooldown(phone);
      await t.redis.del(`rl:otp:phone:hour:${phone}`);
      const code = (await otpRequest(phone).expect(200)).body.devCode as string;
      for (let i = 0; i < 5; i++) await otpVerify(phone, wrongCode(code)).expect(400);
    }
    await skipCooldown(phone);
    await t.redis.del(`rl:otp:phone:hour:${phone}`);
    expect((await otpRequest(phone).expect(429)).body.error.code).toBe('RATE_LIMITED');
    expect((await otpVerify(phone, '000000').expect(429)).body.error.code).toBe('RATE_LIMITED');
  });

  it('parallel guesses from one IP never exceed the 10-failure lockout', async () => {
    const phone = nextPhone();
    const ip = nextIp();
    const codes: string[] = [];
    // Two live codes in turn give 10 possible wrong attempts; fire 25 guesses at once against each.
    for (let round = 0; round < 2; round++) {
      await skipCooldown(phone);
      codes.push((await otpRequest(phone).expect(200)).body.devCode);
      await Promise.all(Array.from({ length: 25 }, () => otpVerify(phone, wrongCode(codes[round]!), ip)));
    }
    const failures = await t.redis.zcard(`rl:otp:fail:${phone}:${ip}`);
    expect(failures).toBeLessThanOrEqual(10);
    await otpVerify(phone, codes[1]!, ip).expect(429);
  });

  it('returns the post-increment attemptsLeft', async () => {
    const phone = nextPhone();
    const { body } = await otpRequest(phone).expect(200);
    const res = await otpVerify(phone, wrongCode(body.devCode)).expect(400);
    expect(res.body.error.details.attemptsLeft).toBe(LIMITS.otpMaxAttempts - 1);
  });

  it('refuses SMS to countries outside OTP_ALLOWED_PREFIXES', async () => {
    const res = await otpRequest('+44 20 7946 0958').expect(400);
    expect(res.body.error.code).toBe('PHONE_NOT_SUPPORTED');
  });

  it('enforces the resend cooldown with retryAfterSec', async () => {
    const phone = nextPhone();
    await otpRequest(phone).expect(200);
    const res = await otpRequest(phone).expect(429);
    expect(res.body.error).toMatchObject({ code: 'RATE_LIMITED' });
    expect(res.body.error.details.retryAfterSec).toBeGreaterThan(50);
    expect(res.body.error.details.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it('limits a phone to 5 codes per hour', async () => {
    const phone = nextPhone();
    for (let i = 0; i < 5; i++) {
      await skipCooldown(phone);
      await otpRequest(phone).expect(200);
    }
    await skipCooldown(phone);
    const res = await otpRequest(phone).expect(429);
    expect(res.body.error.details.retryAfterSec).toBeGreaterThan(3000);
  });

  it('limits an IP to 20 requests per hour', async () => {
    const ip = nextIp();
    for (let i = 0; i < 20; i++) await otpRequest(nextPhone(), ip).expect(200);
    await otpRequest(nextPhone(), ip).expect(429);
  });

  it('ignores X-Forwarded-For with the default TRUST_PROXY=false', async () => {
    const strict = await createTestApp({ TRUST_PROXY: 'false' });
    try {
      for (let i = 0; i < 20; i++) {
        await request(strict.http).post('/api/v1/auth/otp/request').set('X-Forwarded-For', nextIp()).send({ phone: nextPhone() }).expect(200);
      }
      // Spoofed per-request IPs don't help: every request counts against the real peer address.
      const res = await request(strict.http).post('/api/v1/auth/otp/request').set('X-Forwarded-For', nextIp()).send({ phone: nextPhone() });
      expect(res.status).toBe(429);
    } finally {
      await strict.close();
    }
  });

  it('validates the phone and code format', async () => {
    const res = await otpRequest('12345').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toEqual(['phone']);
    await otpVerify(nextPhone(), '12ab56').expect(400);
  });
});

describe('sessions', () => {
  it('rotates the refresh token on every refresh', async () => {
    const s = await loginWithOtp(t);
    const res = await refresh(s.refreshToken, s.csrfToken).expect(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    const rotated = readCookies(res).ac_rt!;
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(s.refreshToken);

    await request(t.http).get('/api/v1/me').set(bearer(res.body.accessToken)).expect(200);
    await refresh(rotated, s.csrfToken).expect(200);
  });

  it('reusing a rotated refresh token revokes the whole family', async () => {
    const s = await loginWithOtp(t);
    const first = await refresh(s.refreshToken, s.csrfToken).expect(200);
    const current = readCookies(first).ac_rt!;

    const reuse = await refresh(s.refreshToken, s.csrfToken).expect(401);
    expect(reuse.body.error.code).toBe('SESSION_EXPIRED');
    // Access tokens issued before the reuse (possibly to the thief) die too.
    await request(t.http).get('/api/v1/me').set(bearer(first.body.accessToken)).expect(401);
    // The legitimate latest token is dead too.
    await refresh(current, s.csrfToken).expect(401);
    const live = await t.prisma.refreshToken.count({ where: { userId: s.user.id, revokedAt: null } });
    expect(live).toBe(0);
  });

  it('refresh requires the CSRF header to match the cookie', async () => {
    const s = await loginWithOtp(t);
    const missing = await refresh(s.refreshToken, null).expect(403);
    expect(missing.body.error.code).toBe('CSRF_FAILED');
    await request(t.http)
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`ac_rt=${s.refreshToken}`, `ac_csrf=${s.csrfToken}`])
      .set('X-CSRF-Token', 'not-the-cookie')
      .expect(403);
    // The token was not consumed by the rejected attempts.
    await refresh(s.refreshToken, s.csrfToken).expect(200);
  });

  it('refresh without a cookie is 401', async () => {
    const res = await request(t.http)
      .post('/api/v1/auth/refresh')
      .set('Cookie', ['ac_csrf=abc'])
      .set('X-CSRF-Token', 'abc')
      .expect(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('logout without a valid CSRF header only clears cookies; with it, revokes the session', async () => {
    const s = await loginWithOtp(t);
    const noCsrf = await request(t.http).post('/api/v1/auth/logout').set('Cookie', [`ac_rt=${s.refreshToken}`]).expect(204);
    expect(readCookies(noCsrf)).toMatchObject({ ac_rt: '', ac_csrf: '' });
    // Not revoked server-side: a forged cross-site logout can't kill the session.
    const still = await refresh(s.refreshToken, s.csrfToken).expect(200);
    s.refreshToken = readCookies(still).ac_rt!;
    const res = await request(t.http)
      .post('/api/v1/auth/logout')
      .set('Cookie', [`ac_rt=${s.refreshToken}`, `ac_csrf=${s.csrfToken}`])
      .set('X-CSRF-Token', s.csrfToken)
      .expect(204);
    expect(readCookies(res)).toMatchObject({ ac_rt: '', ac_csrf: '' });
    await refresh(s.refreshToken, s.csrfToken).expect(401);
  });

  it('logout-all revokes every session and outstanding access tokens', async () => {
    const phone = nextPhone();
    const a = await loginWithOtp(t, phone);
    await t.redis.del(`rl:otp:phone:cooldown:${phone}`);
    const b = await loginWithOtp(t, phone);
    await request(t.http).post('/api/v1/auth/logout-all').expect(401);
    await request(t.http).post('/api/v1/auth/logout-all').set(bearer(a.accessToken)).expect(204);
    await refresh(a.refreshToken, a.csrfToken).expect(401);
    await refresh(b.refreshToken, b.csrfToken).expect(401);
    await request(t.http).get('/api/v1/me').set(bearer(b.accessToken)).expect(401);

    await t.redis.del(`rl:otp:phone:cooldown:${phone}`);
    const c = await loginWithOtp(t, phone);
    await request(t.http).get('/api/v1/me').set(bearer(c.accessToken)).expect(200);
  });
});

describe('authentication guard', () => {
  it('rejects missing and invalid tokens with 401', async () => {
    const none = await request(t.http).get('/api/v1/me').expect(401);
    expect(none.body).toEqual({ error: { code: 'UNAUTHORIZED', message: expect.any(String) } });
    await request(t.http).get('/api/v1/me').set(bearer('garbage')).expect(401);
  });

  it('accepts the Bearer scheme case-insensitively', async () => {
    const u = await createUser(t);
    await request(t.http).get('/api/v1/me').set('Authorization', `bearer ${u.token}`).expect(200);
    await request(t.http).get('/api/v1/me').set('Authorization', `BEARER  ${u.token}`).expect(200);
  });

  it('blocked users get 403 ACCOUNT_BLOCKED on every request and cannot refresh', async () => {
    const s = await loginWithOtp(t);
    await request(t.http).get('/api/v1/me').set(bearer(s.accessToken)).expect(200);

    await t.prisma.user.update({ where: { id: s.user.id }, data: { status: 'blocked' } });
    await t.redis.del(`user:state:${s.user.id}`);

    const res = await request(t.http).get('/api/v1/me').set(bearer(s.accessToken)).expect(403);
    expect(res.body.error.code).toBe('ACCOUNT_BLOCKED');
    await request(t.http).get('/api/v1/me/vehicles').set(bearer(s.accessToken)).expect(403);
    const r = await refresh(s.refreshToken, s.csrfToken).expect(403);
    expect(r.body.error.code).toBe('ACCOUNT_BLOCKED');

    // Signing in again is refused as well.
    await t.redis.del(`rl:otp:phone:cooldown:${s.phone}`);
    const code = (await otpRequest(s.phone).expect(200)).body.devCode;
    expect((await otpVerify(s.phone, code).expect(403)).body.error.code).toBe('ACCOUNT_BLOCKED');
  });

  it('a temporary block expires', async () => {
    const u = await createUser(t);
    await t.prisma.user.update({ where: { id: u.id }, data: { status: 'blocked', blockedUntil: new Date(Date.now() - 1000) } });
    await request(t.http).get('/api/v1/me').set(bearer(u.token)).expect(200);
  });

  it('updates lastActiveAt on authenticated requests', async () => {
    const u = await createUser(t);
    await request(t.http).get('/api/v1/me').set(bearer(u.token)).expect(200);
    await expect
      .poll(async () => (await t.prisma.user.findUnique({ where: { id: u.id } }))!.lastActiveAt)
      .not.toBeNull();
  });

  it('unknown routes use the error shape', async () => {
    const res = await request(t.http).get('/api/v1/does-not-exist').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
