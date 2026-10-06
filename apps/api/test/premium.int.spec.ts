import type { Me, PremiumDto, UserPublic, WalletDto } from '@autoc/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../src/common/ids';
import { PremiumRenewalService } from '../src/modules/wallet/premium-renewal.service';
import { PremiumService } from '../src/modules/wallet/premium.service';
import { bearer, createCommunity, createTestApp, createUser, type TestApp } from './support/app';
import { balanceOf, fund, ledgerConsistent, seasoned, uploadRow, type U } from './support/phase9';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const DAY_MS = 24 * 3600 * 1000;
const get = (u: U, path: string) => request(t.http).get(`/api/v1${path}`).set(bearer(u.token));
const postAs = (u: U, path: string, body: object = {}) => request(t.http).post(`/api/v1${path}`).set(bearer(u.token)).send(body);
const premium = () => t.app.get(PremiumService);

async function subscribed(balance = 1490): Promise<U> {
  const u = await seasoned(t);
  await fund(t, u.id, balance);
  await postAs(u, '/premium/subscribe').expect(200);
  return u;
}

/** Moves the user's live period end to `at` (and the users.premium_until cache with it). */
async function periodEndsAt(userId: string, at: Date): Promise<void> {
  await t.prisma.premiumSubscription.updateMany({ where: { userId, endedAt: null }, data: { currentPeriodEnd: at } });
  await t.prisma.user.update({ where: { id: userId }, data: { premiumUntil: at } });
}

const notes = (userId: string, type: string) => t.prisma.notification.findMany({ where: { userId, type }, orderBy: { createdAt: 'asc' } });

describe('subscribe / cancel / resume', () => {
  it('charges 1 490 for 30 days and turns on the badge everywhere', async () => {
    const u = await seasoned(t);
    const viewer = await seasoned(t);
    expect((await postAs(u, '/premium/subscribe').expect(409)).body.error).toMatchObject({ code: 'INSUFFICIENT_FUNDS', details: { balance: 0, price: 1490 } });
    await fund(t, u.id, 2000);
    const before = Date.now();
    const dto = (await postAs(u, '/premium/subscribe').expect(200)).body as PremiumDto;
    expect(dto).toMatchObject({ status: 'active', isPremium: true, autoRenew: true, priceCoins: 1490, periodDays: 30, limits: { vehicles: 10, postMedia: 12, communitiesOwned: 20, communityMemberships: 100 } });
    const end = new Date(dto.currentPeriodEnd!).getTime();
    expect(end - before).toBeGreaterThanOrEqual(30 * DAY_MS - 5000);
    expect(end - before).toBeLessThanOrEqual(30 * DAY_MS + 5000);
    expect(await balanceOf(t, u.id)).toBe(510);
    const charge = await t.prisma.walletTransaction.findFirstOrThrow({ where: { userId: u.id, kind: 'subscription' } });
    expect(Number(charge.amount)).toBe(-1490);
    expect(await ledgerConsistent(t, u.id)).toBe(true);

    expect(((await get(u, '/me').expect(200)).body as Me)).toMatchObject({ isPremium: true, profileFrame: 'premium' });
    expect(((await get(viewer, `/users/${u.id}`).expect(200)).body as UserPublic)).toMatchObject({ isPremium: true, profileFrame: 'premium', tier: 'bronze' });
    expect(((await get(viewer, `/users/${viewer.id}`).expect(200)).body as UserPublic)).toMatchObject({ isPremium: false, profileFrame: null });
    expect(((await get(u, '/wallet').expect(200)).body as WalletDto).premium.status).toBe('active');
    expect((await postAs(u, '/premium/subscribe').expect(409)).body.error.code).toBe('ALREADY_PREMIUM');
  });

  it('concurrent subscribes charge once', async () => {
    const u = await seasoned(t);
    await fund(t, u.id, 5000);
    const res = await Promise.all(Array.from({ length: 5 }, () => postAs(u, '/premium/subscribe')));
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
    expect(res.filter((r) => r.status === 409).every((r) => r.body.error.code === 'ALREADY_PREMIUM')).toBe(true);
    expect(await balanceOf(t, u.id)).toBe(3510);
    expect(await t.prisma.premiumSubscription.count({ where: { userId: u.id } })).toBe(1);
  });

  it('cancel keeps premium until the period ends; resume turns auto-renew back on', async () => {
    const plain = await seasoned(t);
    expect((await postAs(plain, '/premium/cancel').expect(409)).body.error.code).toBe('NOT_PREMIUM');
    expect((await postAs(plain, '/premium/resume').expect(409)).body.error.code).toBe('NOT_PREMIUM');
    const u = await subscribed();
    const c = (await postAs(u, '/premium/cancel').expect(200)).body as PremiumDto;
    expect(c).toMatchObject({ status: 'cancelled', isPremium: true, autoRenew: false });
    expect(((await postAs(u, '/premium/cancel').expect(200)).body as PremiumDto).status).toBe('cancelled');
    expect(((await get(u, '/premium').expect(200)).body as PremiumDto).isPremium).toBe(true);
    expect(((await postAs(u, '/premium/resume').expect(200)).body as PremiumDto)).toMatchObject({ status: 'active', autoRenew: true });

    // after the period has ended (before the job ran) it reads as none and can't be resumed
    await periodEndsAt(u.id, new Date(Date.now() - 1000));
    expect(((await get(u, '/premium').expect(200)).body as PremiumDto)).toMatchObject({ status: 'none', isPremium: false });
    expect((await postAs(u, '/premium/resume').expect(409)).body.error.code).toBe('NOT_PREMIUM');
    expect(((await get(u, '/me')).body as Me).isPremium).toBe(false);
  });

  it('a frozen wallet cannot subscribe; SOS stays free (no coins needed)', async () => {
    const u = await seasoned(t);
    await fund(t, u.id, 5000);
    await t.prisma.wallet.update({ where: { userId: u.id }, data: { frozen: true } });
    expect((await postAs(u, '/premium/subscribe').expect(403)).body.error.code).toBe('WALLET_FROZEN');
    const poor = await createUser(t);
    await postAs(poor, '/sos', { type: 'other', lat: 43.2, lng: 76.9, sharePhone: false }).expect(201);
  });
});

describe('renewal job', () => {
  it('renews a period ending within 24 h once, extending from the old end', async () => {
    const u = await subscribed(1490 + 2000);
    const end = new Date(Date.now() + 12 * 3600 * 1000);
    await periodEndsAt(u.id, end);
    const report = await premium().runRenewals();
    expect(report.renewed).toBe(1);
    const sub = await t.prisma.premiumSubscription.findFirstOrThrow({ where: { userId: u.id, endedAt: null } });
    expect(sub.currentPeriodEnd.getTime()).toBe(end.getTime() + 30 * DAY_MS);
    expect((await t.prisma.user.findUniqueOrThrow({ where: { id: u.id } })).premiumUntil!.getTime()).toBe(sub.currentPeriodEnd.getTime());
    expect(await balanceOf(t, u.id)).toBe(510);
    expect((await premium().runRenewals()).renewed).toBe(0);
    expect(await balanceOf(t, u.id)).toBe(510);
    const renewed = await notes(u.id, 'premium_renewed');
    expect(renewed).toHaveLength(1);
    expect(renewed[0]!.payload).toMatchObject({ priceCoins: 1490, balance: 510, periodEnd: sub.currentPeriodEnd.toISOString() });
  });

  it('expires when the balance is short, when cancelled and when frozen, with the reason', async () => {
    const poor = await subscribed(1490);
    const cancelled = await subscribed(5000);
    const frozen = await subscribed(5000);
    await postAs(cancelled, '/premium/cancel').expect(200);
    await t.prisma.wallet.update({ where: { userId: frozen.id }, data: { frozen: true } });
    for (const u of [poor, cancelled, frozen]) await periodEndsAt(u.id, new Date(Date.now() - 60_000));

    const report = await premium().runRenewals();
    expect(report.renewed).toBe(0);
    expect(report.expired).toBeGreaterThanOrEqual(3);
    const reasons = await Promise.all([poor, cancelled, frozen].map(async (u) => (await notes(u.id, 'premium_expired'))[0]?.payload));
    expect(reasons).toEqual([{ reason: 'insufficient_funds' }, { reason: 'cancelled' }, { reason: 'wallet_frozen' }]);
    for (const u of [poor, cancelled, frozen]) {
      expect(await t.prisma.premiumSubscription.count({ where: { userId: u.id, endedAt: null } })).toBe(0);
      expect(((await get(u, '/premium')).body as PremiumDto).status).toBe('none');
    }
    expect(await balanceOf(t, cancelled.id)).toBe(3510);
    // a second run sends nothing more; the user can subscribe again
    await premium().runRenewals();
    expect(await notes(poor.id, 'premium_expired')).toHaveLength(1);
    await fund(t, poor.id, 1490);
    await postAs(poor, '/premium/subscribe').expect(200);
  });

  it('a lapsed subscription with auto-renew and enough coins restarts from now', async () => {
    const u = await subscribed(1490 + 1490);
    await periodEndsAt(u.id, new Date(Date.now() - 3600 * 1000));
    const before = Date.now();
    expect((await premium().runRenewals()).renewed).toBe(1);
    const sub = await t.prisma.premiumSubscription.findFirstOrThrow({ where: { userId: u.id, endedAt: null } });
    expect(sub.currentPeriodEnd.getTime()).toBeGreaterThanOrEqual(before + 30 * DAY_MS);
  });

  it('reminds once 3 days before the end, flagging a low balance', async () => {
    const low = await subscribed(1490 + 100);
    const rich = await subscribed(1490 + 5000);
    const off = await subscribed(1490 + 5000);
    await postAs(off, '/premium/cancel').expect(200);
    for (const u of [low, rich, off]) await periodEndsAt(u.id, new Date(Date.now() + 2.5 * DAY_MS));
    await premium().runRenewals();
    await premium().runRenewals();
    const [l, r, o] = await Promise.all([low, rich, off].map((u) => notes(u.id, 'premium_reminder')));
    expect([l, r, o].map((n) => n!.length)).toEqual([1, 1, 1]);
    expect(l![0]!.payload).toMatchObject({ autoRenew: true, lowBalance: true, priceCoins: 1490, balance: 100 });
    expect(r![0]!.payload).toMatchObject({ autoRenew: true, lowBalance: false });
    expect(o![0]!.payload).toMatchObject({ autoRenew: false, lowBalance: false });
  });

  it('runs at most once a day across instances (Redis lock)', async () => {
    await t.redis.del('premium:renewal:lock');
    const job = t.app.get(PremiumRenewalService);
    expect(await job.runIfDue()).not.toBeNull();
    expect(await job.runIfDue()).toBeNull();
  });
});

describe('perks enforced server-side', () => {
  const vehicle = (u: U, i: number) => postAs(u, '/me/vehicles', { brand: 'Toyota', model: `M${i}`, year: 2015 });

  it('vehicles: 5, premium 10', async () => {
    const plain = await seasoned(t);
    for (let i = 0; i < 5; i++) await vehicle(plain, i).expect(201);
    expect((await vehicle(plain, 5).expect(409)).body.error).toMatchObject({ code: 'VEHICLE_LIMIT', details: { limit: 5, premiumLimit: 10 } });
    const pro = await subscribed();
    for (let i = 0; i < 10; i++) await vehicle(pro, i).expect(201);
    expect((await vehicle(pro, 10).expect(409)).body.error).toMatchObject({ code: 'VEHICLE_LIMIT', details: { limit: 10 } });
  });

  it('post images: 6, premium 12', async () => {
    const plain = await seasoned(t);
    const pro = await subscribed();
    const imgs = (owner: string, n: number) => Promise.all(Array.from({ length: n }, () => uploadRow(t, owner, 'post')));
    expect((await postAs(plain, '/posts', { mediaUploadIds: await imgs(plain.id, 7) }).expect(400)).body.error).toMatchObject({
      code: 'MEDIA_LIMIT',
      details: { limit: 6, premiumLimit: 12 },
    });
    await postAs(plain, '/posts', { mediaUploadIds: await imgs(plain.id, 6) }).expect(201);
    await postAs(pro, '/posts', { mediaUploadIds: await imgs(pro.id, 12) }).expect(201);
    await postAs(pro, '/posts', { mediaUploadIds: await imgs(pro.id, 13) }).expect(400);
  });

  it('owned communities: 10, premium 20; memberships: 50, premium 100', async () => {
    const create = (u: U) => postAs(u, '/communities', { name: `Club ${newId().slice(-10)}`, description: 'x', isPrivate: false });
    const plain = await seasoned(t);
    const pro = await subscribed();
    for (let i = 0; i < 10; i++) {
      await createCommunity(t, plain.id);
      await createCommunity(t, pro.id);
    }
    expect((await create(plain).expect(409)).body.error).toMatchObject({ code: 'COMMUNITY_LIMIT', details: { limit: 10, premiumLimit: 20 } });
    await create(pro).expect(201);

    const joiner = await seasoned(t);
    const owner = await seasoned(t);
    for (let i = 0; i < 49; i++) await createCommunity(t, owner.id, [{ userId: joiner.id }]);
    const open = await createCommunity(t, (await seasoned(t)).id);
    const another = await createCommunity(t, (await seasoned(t)).id);
    await postAs(joiner, `/communities/${open}/join`).expect(200);
    expect((await postAs(joiner, `/communities/${another}/join`).expect(409)).body.error).toMatchObject({ code: 'MEMBERSHIP_LIMIT', details: { limit: 50, premiumLimit: 100 } });
    await fund(t, joiner.id, 1490);
    await postAs(joiner, '/premium/subscribe').expect(200);
    await postAs(joiner, `/communities/${another}/join`).expect(200);
  });
});
