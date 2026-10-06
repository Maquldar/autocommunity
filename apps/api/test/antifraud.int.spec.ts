import { ANTIFRAUD, type SosDto } from '@autoc/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BackgroundTasks } from '../src/infra/tasks/background-tasks';
import { AntifraudService } from '../src/modules/antifraud/antifraud.service';
import { bearer, createTestApp, createUser, nextIp, nextPhone, setLocation, type TestApp } from './support/app';
import { pngImage } from './support/images';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ SOS_EXPAND_DELAY_MS: '3600000' });
});
afterAll(async () => {
  await t.close();
});

type U = { id: string; token: string };
const HOUR = 3_600_000;
const drain = () => t.app.get(BackgroundTasks).drain();
const antifraud = () => t.app.get(AntifraudService);
const flags = (userId: string | null, kind: string) => t.prisma.fraudFlag.findMany({ where: { userId, kind } });
const post = (u: U, path: string, body: object = {}) => request(t.http).post(`/api/v1${path}`).set(bearer(u.token)).send(body);

let areaSeq = 0;
const area = () => {
  const p = { lat: 10 + areaSeq, lng: 30 + areaSeq };
  areaSeq++;
  return p;
};

async function createSos(u: U, extra: object = {}): Promise<string> {
  const at = area();
  await setLocation(t, u.id, at.lat, at.lng, 1);
  const res = await post(u, '/sos', { type: 'stuck', description: '', lat: at.lat, lng: at.lng, sharePhone: false, ...extra }).expect(201);
  return (res.body as SosDto).id;
}

/** Creates and cancels an SOS, then moves it `daysAgo` back so the 3-per-24 h limit doesn't interfere. */
async function cancelledSos(u: U, opts: { daysAgo?: number; minutesOpen?: number } = {}): Promise<string> {
  const id = await createSos(u);
  await post(u, `/sos/${id}/cancel`, { reason: 'передумал' }).expect(200);
  await drain();
  const created = new Date(Date.now() - (opts.daysAgo ?? 1) * 24 * HOUR);
  await t.prisma.sosRequest.update({ where: { id }, data: { createdAt: created, closedAt: new Date(created.getTime() + (opts.minutesOpen ?? 5) * 60_000) } });
  return id;
}

const oldAccount = () => ({ createdAt: new Date(Date.now() - 30 * 24 * HOUR) });
async function user(data: { rating?: number; createdAt?: Date } = {}): Promise<U> {
  const u = await createUser(t);
  await t.prisma.user.update({ where: { id: u.id }, data: { createdAt: data.createdAt ?? oldAccount().createdAt, ...(data.rating !== undefined ? { rating: data.rating } : {}) } });
  return u;
}

describe('sos_cancel_streak', () => {
  it('2 quick cancels in 7 days → nothing; the 3rd → flag + 72 h SOS ban + notification', async () => {
    const u = await user();
    await cancelledSos(u, { daysAgo: 3 });
    await cancelledSos(u, { daysAgo: 2 });
    expect(await flags(u.id, 'sos_cancel_streak')).toHaveLength(0);
    expect((await t.prisma.user.findUniqueOrThrow({ where: { id: u.id } })).sosBannedUntil).toBeNull();

    const third = await createSos(u);
    await post(u, `/sos/${third}/cancel`).expect(200);
    await drain();
    const [flag] = await flags(u.id, 'sos_cancel_streak');
    expect(flag!.details).toMatchObject({ count: 3, triggerSosId: third });
    const banned = (await t.prisma.user.findUniqueOrThrow({ where: { id: u.id } })).sosBannedUntil!;
    expect(Math.abs(banned.getTime() - (Date.now() + ANTIFRAUD.cancelStreakBanHours * HOUR))).toBeLessThan(60_000);
    const [n] = await t.prisma.notification.findMany({ where: { userId: u.id, type: 'admin_warning' } });
    expect(n!.payload).toMatchObject({ kind: 'sos_ban', automatic: true, until: banned.toISOString() });
    // The ban works.
    const at = area();
    expect((await post(u, '/sos', { type: 'fuel', description: '', lat: at.lat, lng: at.lng, sharePhone: false }).expect(403)).body.error.code).toBe('SOS_BANNED');
  });

  it('does not count cancels after 30 min, older than 7 days, or by the system; counts fake SOS', async () => {
    const u = await user();
    await cancelledSos(u, { daysAgo: 1, minutesOpen: ANTIFRAUD.cancelWindowMin + 1 }); // too slow
    await cancelledSos(u, { daysAgo: ANTIFRAUD.cancelStreakDays + 0.5 }); // too old
    await cancelledSos(u, { daysAgo: 1, minutesOpen: ANTIFRAUD.cancelWindowMin - 1 }); // counts (1)
    const sys = await cancelledSos(u, { daysAgo: 1 });
    await t.prisma.sosRequest.update({ where: { id: sys }, data: { cancelReason: 'system:admin_blocked' } }); // not counted
    // A user can't fake a system reason through the API.
    const id = await createSos(u);
    await post(u, `/sos/${id}/cancel`, { reason: 'system:admin_blocked' }).expect(200);
    await drain();
    expect((await t.prisma.sosRequest.findUniqueOrThrow({ where: { id } })).cancelReason).toBe('admin_blocked');
    // 2 counted so far (one above, plus this one) → no ban yet.
    expect(await flags(u.id, 'sos_cancel_streak')).toHaveLength(0);

    // A closed SOS that was marked fake is the 3rd.
    const fake = await createSos(u);
    await t.prisma.sosRequest.update({ where: { id: fake }, data: { isFake: true, status: 'closed', closedAt: new Date() } });
    expect(await antifraud().checkCancelStreak(u.id, fake)).toBe(true);
    expect(await flags(u.id, 'sos_cancel_streak')).toHaveLength(1);
    // While banned, it isn't applied again.
    expect(await antifraud().checkCancelStreak(u.id, fake)).toBe(false);
  });
});

describe('new_account_sos', () => {
  it('flags an SOS from an account younger than 24 h (allowed), not from an older one', async () => {
    const young = await user({ createdAt: new Date(Date.now() - (ANTIFRAUD.newAccountHours * HOUR - 60_000)) });
    const sosId = await createSos(young);
    await drain();
    const [flag] = await flags(young.id, 'new_account_sos');
    expect(flag!.details).toMatchObject({ sosId });

    const old = await user({ createdAt: new Date(Date.now() - (ANTIFRAUD.newAccountHours * HOUR + 60_000)) });
    await createSos(old);
    await drain();
    expect(await flags(old.id, 'new_account_sos')).toHaveLength(0);
  });
});

describe('duplicate_sos_photo', () => {
  const upload = async (u: U, bytes: Buffer) =>
    (await request(t.http).post('/api/v1/uploads?purpose=sos').set(bearer(u.token)).attach('file', bytes, { filename: 'p.png', contentType: 'image/png' }).expect(201)).body
      .id as string;

  it("flags a photo matching another user's SOS photo from the last 30 days", async () => {
    const bytes = await pngImage(41);
    const a = await user();
    const b = await user();
    const aSos = await createSos(a, { photoUploadIds: [await upload(a, bytes)] });
    await drain();
    expect(await flags(a.id, 'duplicate_sos_photo')).toHaveLength(0);

    const bSos = await createSos(b, { photoUploadIds: [await upload(b, bytes), await upload(b, await pngImage(42))] });
    await drain();
    const [flag] = await flags(b.id, 'duplicate_sos_photo');
    expect(flag!.details).toMatchObject({ sosId: bSos, matches: [expect.objectContaining({ otherSosId: aSos, otherUserId: a.id })] });
  });

  it('ignores the same user re-using a photo and matches older than 30 days', async () => {
    const bytes = await pngImage(43);
    const a = await user();
    const first = await createSos(a, { photoUploadIds: [await upload(a, bytes)] });
    await post(a, `/sos/${first}/close`).expect(409); // still `created`: cancel it instead
    await post(a, `/sos/${first}/cancel`).expect(200);
    await createSos(a, { photoUploadIds: [await upload(a, bytes)] });
    await drain();
    expect(await flags(a.id, 'duplicate_sos_photo')).toHaveLength(0);

    const old = await user();
    const oldSos = await createSos(old, { photoUploadIds: [await upload(old, await pngImage(44))] });
    await t.prisma.sosRequest.update({ where: { id: oldSos }, data: { createdAt: new Date(Date.now() - (ANTIFRAUD.duplicatePhotoDays * 24 + 1) * HOUR) } });
    const c = await user();
    await createSos(c, { photoUploadIds: [await upload(c, await pngImage(44))] });
    await drain();
    expect(await flags(c.id, 'duplicate_sos_photo')).toHaveLength(0);
  });
});

describe('report_burst', () => {
  const reportUser = (reporter: U, targetId: string) => post(reporter, '/reports', { targetType: 'user', targetId, reason: 'harassment' }).expect(201);

  it('2 reporters → nothing; the 3rd distinct reporter → flag + 24 h block when rating < 30', async () => {
    const target = await user({ rating: ANTIFRAUD.reportBurstBlockBelowRating - 1 });
    const r1 = await user();
    const r2 = await user();
    await reportUser(r1, target.id);
    await reportUser(r2, target.id);
    // The same reporter on other content of the target doesn't count twice.
    await post(r2, '/reports', { targetType: 'user', targetId: target.id, reason: 'spam' }).expect(409);
    await drain();
    expect(await flags(target.id, 'report_burst')).toHaveLength(0);

    await reportUser(await user(), target.id);
    await drain();
    const [flag] = await flags(target.id, 'report_burst');
    expect(flag!.details).toMatchObject({ reporters: 3, rating: ANTIFRAUD.reportBurstBlockBelowRating - 1 });
    const blocked = await t.prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(blocked.status).toBe('blocked');
    expect(Math.abs(blocked.blockedUntil!.getTime() - (Date.now() + ANTIFRAUD.reportBurstBlockHours * HOUR))).toBeLessThan(60_000);
    await request(t.http).get('/api/v1/me').set(bearer(target.token)).expect(401);
    expect((await t.prisma.notification.findFirstOrThrow({ where: { userId: target.id, type: 'admin_warning' } })).payload).toMatchObject({
      kind: 'blocked',
      automatic: true,
    });

    // A 4th reporter within 24 h doesn't flag again.
    await reportUser(await user(), target.id);
    await drain();
    expect(await flags(target.id, 'report_burst')).toHaveLength(1);
  });

  it('flags without blocking when the rating is ≥ 30; reports older than 24 h do not count', async () => {
    const target = await user({ rating: ANTIFRAUD.reportBurstBlockBelowRating });
    const old = await user();
    const r = (await reportUser(old, target.id)).body.id as string;
    await t.prisma.report.update({ where: { id: r }, data: { createdAt: new Date(Date.now() - (ANTIFRAUD.reportBurstHours * HOUR + 60_000)) } });
    await reportUser(await user(), target.id);
    await reportUser(await user(), target.id);
    await drain();
    expect(await flags(target.id, 'report_burst')).toHaveLength(0);

    await reportUser(await user(), target.id);
    await drain();
    expect(await flags(target.id, 'report_burst')).toHaveLength(1);
    expect((await t.prisma.user.findUniqueOrThrow({ where: { id: target.id } })).status).toBe('active');
  });
});

describe('location_teleport', () => {
  const put = (u: U, lat: number, lng: number) => request(t.http).put('/api/v1/me/location').set(bearer(u.token)).send({ lat, lng }).expect(204);
  const unthrottle = (u: U) => t.redis.del(`loc:throttle:${u.id}`);

  it('2 implausible jumps in 1 h → nothing; the 3rd → flag; plausible moves never count', async () => {
    const u = await user();
    await put(u, 43.2, 76.9);
    await unthrottle(u);
    await put(u, 43.2005, 76.9); // ~55 m: plausible
    for (const lat of [44.2, 43.2]) {
      await unthrottle(u);
      await put(u, lat, 76.9); // ~110 km in a second
    }
    await drain();
    expect(await flags(u.id, 'location_teleport')).toHaveLength(0);
    expect(await t.redis.zcard(`af:teleport:${u.id}`)).toBe(2);

    await unthrottle(u);
    await put(u, 45.2, 76.9);
    await drain();
    const [flag] = await flags(u.id, 'location_teleport');
    expect(flag!.details).toMatchObject({ jumps: 3, windowMin: 60 });
  });
});

describe('otp_abuse', () => {
  const otpRequest = (phone: string) => request(t.http).post('/api/v1/auth/otp/request').set('X-Forwarded-For', nextIp()).send({ phone }).expect(200);
  const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

  /** A real lockout: 10 wrong codes for the phone from one IP (two codes × 5 attempts). */
  async function lockOut(phone: string) {
    const ip = nextIp();
    for (let round = 0; round < 2; round++) {
      await t.redis.del(`rl:otp:phone:cooldown:${phone}`, `rl:otp:phone:hour:${phone}`);
      const code = (await otpRequest(phone)).body.devCode as string;
      for (let i = 0; i < 5; i++) {
        await request(t.http).post('/api/v1/auth/otp/verify').set('X-Forwarded-For', ip).send({ phone, code: wrong(code) }).expect(400);
      }
    }
    // Locked: further guesses from that IP are refused without counting again.
    await request(t.http).post('/api/v1/auth/otp/verify').set('X-Forwarded-For', ip).send({ phone, code: '000000' }).expect(429);
    await drain();
  }

  it('a lockout is recorded once; more than 3 in 24 h → flag with the masked phone (no account → userId null)', async () => {
    const phone = nextPhone();
    await lockOut(phone);
    const keys = await t.redis.keys('af:otp-lockouts:*');
    const counter = keys.find((k) => !k.includes('flagged'))!;
    expect(await t.redis.zcard(counter)).toBe(1);
    // Two more (3 in total) → still nothing.
    expect(await antifraud().recordOtpLockout(phone)).toBe(false);
    expect(await antifraud().recordOtpLockout(phone)).toBe(false);
    expect(await t.prisma.fraudFlag.count({ where: { kind: 'otp_abuse' } })).toBe(0);
    // The 4th (a real one) → flag.
    await lockOut(phone);
    const [flag] = await t.prisma.fraudFlag.findMany({ where: { kind: 'otp_abuse' } });
    expect(flag).toMatchObject({ userId: null, details: { phoneMasked: expect.stringContaining('***'), lockouts: 4 } });
    expect(JSON.stringify(flag!.details)).not.toContain(phone.slice(-7));
  });

  it('links the flag to the account when the phone has one', async () => {
    const phone = nextPhone();
    const u = await createUser(t, { phone });
    for (let i = 0; i < ANTIFRAUD.otpLockoutsMin - 1; i++) await antifraud().recordOtpLockout(phone);
    expect(await antifraud().recordOtpLockout(phone)).toBe(true);
    expect(await flags(u.id, 'otp_abuse')).toHaveLength(1);
    // Once per window.
    expect(await antifraud().recordOtpLockout(phone)).toBe(false);
  });
});

