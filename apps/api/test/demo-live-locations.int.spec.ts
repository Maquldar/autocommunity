import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_LOCK_KEY, DemoLiveLocationsService } from '../src/modules/demo/demo-live-locations.service';
import { ALMATY_BOUNDS } from '../src/modules/demo/demo-path';
import { bearer, createTestApp, createUser, getLocation, setLocation, waitFor, type TestApp } from './support/app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const metersBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  Math.hypot((b.lat - a.lat) * 111_320, (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180));

describe('demo live locations', () => {
  it('is off unless enabled; when enabled it refreshes seeded users right at boot', async () => {
    expect(t.app.get(DemoLiveLocationsService)['timer']).toBeNull();
    const seed = await createUser(t, { isSeed: true });
    await setLocation(t, seed.id, 43.24, 76.9, 60, 'seed');
    await t.redis.del(DEMO_LOCK_KEY);
    // DEMO_LIVE_LOCATIONS unset → defaults to DEMO_MODE.
    const live = await createTestApp({ DEMO_MODE: 'true', DEMO_LIVE_LOCATIONS: '' });
    try {
      expect(live.app.get(DemoLiveLocationsService)['timer']).not.toBeNull();
      await waitFor(async () => (await getLocation(t, seed.id))!.updatedAt.getTime() > Date.now() - 60_000);
    } finally {
      await live.close();
    }
    await t.redis.del(DEMO_LOCK_KEY);
    await t.prisma.user.update({ where: { id: seed.id }, data: { isSeed: false } });
  });

  it('moves only seeded users, ≤ 50 m per tick, within Almaty, with a fresh updated_at', async () => {
    const service = t.app.get(DemoLiveLocationsService);
    const seeds = [];
    for (let i = 0; i < 5; i++) {
      const u = await createUser(t, { isSeed: true });
      await setLocation(t, u.id, 43.2 + i * 0.02, 76.85 + i * 0.03, 30, 'seed');
      seeds.push(u);
    }
    const real = await createUser(t);
    await setLocation(t, real.id, 43.25, 76.9, 30);
    // A real user whose row somehow says 'seed' is still not touched (not an is_seed account).
    const realSeedRow = await createUser(t);
    await setLocation(t, realSeedRow.id, 43.255, 76.905, 30, 'seed');
    // A visitor signed in to a shared seed account sent a real position: never refreshed.
    const visitorOnSeed = await createUser(t, { isSeed: true });
    await setLocation(t, visitorOnSeed.id, 43.26, 76.91, 30, 'client');
    const seedWithoutLocation = await createUser(t, { isSeed: true });
    const blockedSeed = await createUser(t, { isSeed: true, status: 'blocked' });
    await setLocation(t, blockedSeed.id, 43.27, 76.92, 30, 'seed');

    const before = new Map(await Promise.all([...seeds, real, realSeedRow, visitorOnSeed, blockedSeed].map(async (u) => [u.id, (await getLocation(t, u.id))!] as const)));
    let tickNow = Date.now();
    expect(await service.tick(tickNow)).toBe(5);

    for (const s of seeds) {
      const after = (await getLocation(t, s.id))!;
      const prev = before.get(s.id)!;
      const moved = metersBetween(prev, after);
      expect(moved).toBeGreaterThan(5);
      expect(moved).toBeLessThanOrEqual(50);
      expect(after.updatedAt.getTime()).toBeGreaterThan(Date.now() - 10_000);
      expect(after.lat).toBeGreaterThanOrEqual(ALMATY_BOUNDS.minLat);
      expect(after.lat).toBeLessThanOrEqual(ALMATY_BOUNDS.maxLat);
      expect(after.lng).toBeGreaterThanOrEqual(ALMATY_BOUNDS.minLng);
      expect(after.lng).toBeLessThanOrEqual(ALMATY_BOUNDS.maxLng);
    }
    for (const u of [real, realSeedRow, visitorOnSeed, blockedSeed]) expect(await getLocation(t, u.id)).toEqual(before.get(u.id));
    expect(await getLocation(t, seedWithoutLocation.id)).toBeNull();

    // Deterministic path: the next tick continues along the loop.
    const mid = (await getLocation(t, seeds[0]!.id))!;
    tickNow += 60_000;
    await service.tick(tickNow);
    const next = (await getLocation(t, seeds[0]!.id))!;
    expect(metersBetween(mid, next)).toBeLessThanOrEqual(50);
    expect(metersBetween(mid, next)).toBeGreaterThan(5);
  });

  it('runs once per tick across instances (Redis lock)', async () => {
    const service = t.app.get(DemoLiveLocationsService);
    const seed = await createUser(t, { isSeed: true });
    await setLocation(t, seed.id, 43.24, 76.9, 20, 'seed');
    await t.redis.del(DEMO_LOCK_KEY);
    const other = await createTestApp();
    try {
      const results = await Promise.all([service.runIfLeader(), other.app.get(DemoLiveLocationsService).runIfLeader()]);
      expect(results.filter((r) => r === null)).toHaveLength(1);
      expect(results.find((r) => r !== null)).toBeGreaterThanOrEqual(1);
    } finally {
      await other.close();
    }
  });

  it('a client PUT on a seeded account switches it to source=client: it stops moving and expires', async () => {
    const service = t.app.get(DemoLiveLocationsService);
    const demo = await createUser(t, { isSeed: true });
    await setLocation(t, demo.id, 43.25, 76.93, 5, 'seed');
    await t.prisma.$executeRaw`UPDATE users SET is_seed = false WHERE id <> ${demo.id}::uuid`;
    expect(await service.tick()).toBe(1);
    await request(t.http).put('/api/v1/me/location').set(bearer(demo.token)).send({ lat: 52.52, lng: 13.405 }).expect(204);
    expect(await t.prisma.userLocation.findUniqueOrThrow({ where: { userId: demo.id } })).toMatchObject({ source: 'client' });
    // Make the visitor's position 20 min old: the ticker must not revive it.
    await t.prisma.$executeRaw`UPDATE user_locations SET updated_at = now() - interval '20 minutes' WHERE user_id = ${demo.id}::uuid`;
    const old = (await getLocation(t, demo.id))!;
    expect(await service.tick()).toBe(0);
    expect(await getLocation(t, demo.id)).toEqual(old);
    const viewer = await createUser(t);
    await t.prisma.user.update({ where: { id: demo.id }, data: { privacyMode: 'everyone' } });
    const map = await request(t.http).get('/api/v1/map/users?bbox=12.4,51.5,14.4,53.5').set(bearer(viewer.token)).expect(200);
    expect(map.body.items).toEqual([]);
  });
});
