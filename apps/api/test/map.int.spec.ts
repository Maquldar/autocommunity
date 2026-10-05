import type { MapUser, PrivacyMode } from '@autoc/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../src/common/ids';
import { Prisma } from '@prisma/client';
import { GRID_CELL_DEG, MAP_MAX_USERS, MapService } from '../src/modules/map/map.service';
import { bearer, createCommunity, createTestApp, createUser, getLocation, makeFriends, setLocation, type TestApp } from './support/app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

/**
 * Every test works in its own map area (shared database), ~0.2° apart, inside a 0.1°-wide bbox.
 * Area centres sit in the middle of a grid cell row so snapping stays inside the bbox.
 */
let areaSeq = 0;
function area() {
  const lat = 43.0 + areaSeq * 0.2;
  const lng = 70.0 + areaSeq * 0.2;
  areaSeq++;
  const bbox = `${lng - 0.05},${lat - 0.05},${lng + 0.05},${lat + 0.05}`;
  return { lat, lng, bbox };
}

const mapUsers = (token: string, query: string) => request(t.http).get(`/api/v1/map/users?${query}`).set(bearer(token));
const byId = (items: MapUser[]) => new Map(items.map((i) => [i.userId, i]));
const metersBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  Math.hypot((b.lat - a.lat) * 111_320, (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180));

describe('PUT/DELETE /me/location', () => {
  it('stores the position (also in hidden mode), ignores updates within 10 s, and deletes it', async () => {
    const u = await createUser(t, { privacyMode: 'hidden' });
    await request(t.http).put('/api/v1/me/location').set(bearer(u.token)).send({ lat: 43.25, lng: 76.95, accuracyM: 12 }).expect(204);
    const first = await getLocation(t, u.id);
    expect(first).toMatchObject({ lat: 43.25, lng: 76.95 });
    const stored = await t.prisma.userLocation.findUniqueOrThrow({ where: { userId: u.id } });
    expect(stored.accuracyM).toBe(12);

    // Within 10 s: acknowledged, not written.
    await request(t.http).put('/api/v1/me/location').set(bearer(u.token)).send({ lat: 43.3, lng: 76.9 }).expect(204);
    expect(await getLocation(t, u.id)).toMatchObject({ lat: 43.25, lng: 76.95 });

    // Once the window has passed (simulated by expiring the throttle key) the update is written.
    await t.redis.del(`loc:throttle:${u.id}`);
    await request(t.http).put('/api/v1/me/location').set(bearer(u.token)).send({ lat: 43.3, lng: 76.9 }).expect(204);
    const second = await getLocation(t, u.id);
    expect(second).toMatchObject({ lat: 43.3, lng: 76.9 });
    expect(second!.updatedAt.getTime()).toBeGreaterThanOrEqual(first!.updatedAt.getTime());
    expect(await t.prisma.userLocation.count({ where: { userId: u.id } })).toBe(1);

    await request(t.http).delete('/api/v1/me/location').set(bearer(u.token)).expect(204);
    expect(await getLocation(t, u.id)).toBeNull();
    // Deleting resets the throttle: the next update is written immediately.
    await request(t.http).put('/api/v1/me/location').set(bearer(u.token)).send({ lat: 43.2, lng: 76.8 }).expect(204);
    expect(await getLocation(t, u.id)).toMatchObject({ lat: 43.2, lng: 76.8 });
  });

  it('validates coordinates and requires auth', async () => {
    const u = await createUser(t);
    const res = await request(t.http).put('/api/v1/me/location').set(bearer(u.token)).send({ lat: 91, lng: 0 }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    // JSON bodies take real numbers only (no string coercion).
    for (const body of [{ lat: '43.2', lng: 76.9 }, { lat: 43.2, lng: '76.9' }, { lat: 43.2, lng: 76.9, accuracyM: '5' }, { lat: '', lng: 0 }]) {
      expect((await request(t.http).put('/api/v1/me/location').set(bearer(u.token)).send(body).expect(400)).body.error.code).toBe('VALIDATION_ERROR');
    }
    await request(t.http).put('/api/v1/me/location').send({ lat: 1, lng: 1 }).expect(401);
  });
});

describe('GET /map/users visibility', () => {
  type Rel = 'stranger' | 'friend' | 'co_public' | 'co_private' | 'pending_out' | 'pending_in' | 'friend_and_co_public';
  const modes: PrivacyMode[] = ['hidden', 'friends', 'community', 'everyone'];
  const rels: Rel[] = ['stranger', 'friend', 'co_public', 'co_private', 'pending_out', 'pending_in', 'friend_and_co_public'];

  /**
   * Expected outcome per (mode, relation): null = not visible. Exact positions only for friends and
   * co-members of a shared private community; co-members of public communities are approximate.
   */
  function expected(mode: PrivacyMode, rel: Rel): { relation: MapUser['relation']; approximate: boolean } | null {
    const isFriend = rel === 'friend' || rel === 'friend_and_co_public';
    const isCo = rel === 'co_public' || rel === 'co_private' || rel === 'friend_and_co_public';
    const exact = isFriend || rel === 'co_private';
    const strongest = isFriend ? 'friend' : isCo ? 'community' : 'public';
    switch (mode) {
      case 'hidden':
        return null;
      case 'friends':
        return isFriend ? { relation: 'friend', approximate: false } : null;
      case 'community':
        return isFriend || isCo ? { relation: strongest, approximate: !exact } : null;
      case 'everyone':
        return { relation: strongest, approximate: !exact };
    }
  }

  it('applies the privacy-mode × relation matrix in SQL', async () => {
    const a = area();
    const viewer = await createUser(t);
    const coPublic: string[] = [];
    const coPrivate: string[] = [];
    const cases: { mode: PrivacyMode; rel: Rel; id: string; lat: number; lng: number }[] = [];
    let i = 0;
    for (const mode of modes) {
      for (const rel of rels) {
        const u = await createUser(t, { privacyMode: mode });
        const lat = a.lat + 0.001 * i;
        const lng = a.lng + 0.0013 * i;
        i++;
        await setLocation(t, u.id, lat, lng, 1);
        if (rel === 'friend' || rel === 'friend_and_co_public') await makeFriends(t, viewer.id, u.id);
        if (rel === 'pending_out') await makeFriends(t, viewer.id, u.id, 'pending');
        if (rel === 'pending_in') await makeFriends(t, u.id, viewer.id, 'pending');
        if (rel === 'co_public' || rel === 'friend_and_co_public') coPublic.push(u.id);
        if (rel === 'co_private') coPrivate.push(u.id);
        cases.push({ mode, rel, id: u.id, lat, lng });
      }
    }
    await createCommunity(t, viewer.id, coPublic.map((userId) => ({ userId })));
    // Co-members of a private community also share a public one: private wins (exact).
    await createCommunity(t, viewer.id, coPrivate.map((userId) => ({ userId })), { isPrivate: true });
    await createCommunity(t, viewer.id, coPrivate.map((userId) => ({ userId })));

    const res = await mapUsers(viewer.token, `bbox=${a.bbox}`).expect(200);
    expect(res.body.truncated).toBe(false);
    const items = byId(res.body.items as MapUser[]);
    for (const c of cases) {
      const want = expected(c.mode, c.rel);
      const got = items.get(c.id);
      const label = `${c.mode} × ${c.rel}`;
      if (!want) {
        expect(got, label).toBeUndefined();
        continue;
      }
      expect(got, label).toBeDefined();
      expect({ relation: got!.relation, approximate: got!.approximate }, label).toEqual(want);
      if (want.approximate) {
        expect(got!.lat === c.lat && got!.lng === c.lng, label).toBe(false);
        expect(metersBetween(c, got!), label).toBeLessThan(400);
        expect(new Date(got!.updatedAt).getUTCSeconds() + new Date(got!.updatedAt).getUTCMilliseconds(), label).toBe(0);
      } else {
        expect(got!.lat, label).toBeCloseTo(c.lat, 9);
        expect(got!.lng, label).toBeCloseTo(c.lng, 9);
      }
    }
    expect(items.size).toBe(cases.filter((c) => expected(c.mode, c.rel)).length);
  });

  it('ignores pending memberships and deleted communities for the community rule', async () => {
    const a = area();
    const viewer = await createUser(t);
    const pendingMember = await createUser(t, { privacyMode: 'community' });
    const deletedCo = await createUser(t, { privacyMode: 'community' });
    const viewerPending = await createUser(t, { privacyMode: 'community' });
    for (const u of [pendingMember, deletedCo, viewerPending]) await setLocation(t, u.id, a.lat, a.lng, 1);
    await createCommunity(t, viewer.id, [{ userId: pendingMember.id, status: 'pending' }]);
    await createCommunity(t, viewer.id, [{ userId: deletedCo.id }], { deleted: true });
    const owner = await createUser(t);
    await createCommunity(t, owner.id, [{ userId: viewer.id, status: 'pending' }, { userId: viewerPending.id }]);
    const res = await mapUsers(viewer.token, `bbox=${a.bbox}`).expect(200);
    expect(res.body.items).toEqual([]);
  });

  it('hides stale positions, blocked/deleted/un-onboarded users and the viewer', async () => {
    const a = area();
    const viewer = await createUser(t, { privacyMode: 'everyone' });
    await setLocation(t, viewer.id, a.lat, a.lng, 0);
    const fresh = await createUser(t, { privacyMode: 'everyone' });
    const stale = await createUser(t, { privacyMode: 'everyone' });
    const blocked = await createUser(t, { privacyMode: 'everyone', status: 'blocked' });
    const tempBlocked = await createUser(t, { privacyMode: 'everyone', status: 'blocked', blockedUntil: new Date(Date.now() + 3_600_000) });
    const blockExpired = await createUser(t, { privacyMode: 'everyone', status: 'blocked', blockedUntil: new Date(Date.now() - 60_000) });
    const deleted = await createUser(t, { privacyMode: 'everyone', status: 'deleted' });
    const notOnboarded = await createUser(t, { privacyMode: 'everyone', onboarded: false });
    const blockedFriend = await createUser(t, { privacyMode: 'friends', status: 'blocked' });
    await makeFriends(t, viewer.id, blockedFriend.id);
    await setLocation(t, fresh.id, a.lat, a.lng, 14);
    await setLocation(t, stale.id, a.lat, a.lng, 16);
    for (const u of [blocked, tempBlocked, blockExpired, deleted, notOnboarded, blockedFriend]) await setLocation(t, u.id, a.lat, a.lng, 1);

    const res = await mapUsers(viewer.token, `bbox=${a.bbox}`).expect(200);
    const ids = (res.body.items as MapUser[]).map((i) => i.userId).sort();
    expect(ids).toEqual([fresh.id, blockExpired.id].sort());
  });

  it('never returns hidden users although their position is stored', async () => {
    const a = area();
    const viewer = await createUser(t);
    const hidden = await createUser(t, { privacyMode: 'everyone' });
    await makeFriends(t, viewer.id, hidden.id);
    await setLocation(t, hidden.id, a.lat, a.lng, 1);
    expect((await mapUsers(viewer.token, `bbox=${a.bbox}`).expect(200)).body.items).toHaveLength(1);
    // "Go invisible"
    await request(t.http).patch('/api/v1/me/settings').set(bearer(hidden.token)).send({ privacyMode: 'hidden' }).expect(200);
    expect((await mapUsers(viewer.token, `bbox=${a.bbox}`).expect(200)).body.items).toEqual([]);
    expect(await getLocation(t, hidden.id)).not.toBeNull();
  });

  it('returns the map payload shape without the plate, with the primary vehicle and avatar', async () => {
    const a = area();
    const viewer = await createUser(t);
    const friend = await createUser(t, { privacyMode: 'friends', nickname: 'map_friend' });
    await makeFriends(t, friend.id, viewer.id);
    await t.prisma.vehicle.createMany({
      data: [
        { id: newId(), userId: friend.id, brand: 'Toyota', model: 'Camry', year: 2019, plate: '777ABC02', isPrimary: true },
        { id: newId(), userId: friend.id, brand: 'Lada', model: 'Niva', year: 2010, plate: '111AAA02', isPrimary: false },
      ],
    });
    await setLocation(t, friend.id, a.lat, a.lng, 1);
    const res = await mapUsers(viewer.token, `bbox=${a.bbox}`).expect(200);
    expect(res.body.items).toHaveLength(1);
    const item = res.body.items[0];
    expect(Object.keys(item).sort()).toEqual(
      ['approximate', 'avatarUrl', 'lat', 'lng', 'nickname', 'rating', 'relation', 'updatedAt', 'userId', 'vehicle'].sort(),
    );
    expect(item).toMatchObject({ userId: friend.id, nickname: 'map_friend', rating: 50, avatarUrl: null, vehicle: { brand: 'Toyota', model: 'Camry' } });
    expect(JSON.stringify(res.body)).not.toContain('777ABC02');
    expect(new Date(item.updatedAt).getTime()).toBeGreaterThan(Date.now() - 2 * 60_000 - 5_000);
  });
});

describe('GET /map/users approximate positions', () => {
  const S = GRID_CELL_DEG;
  const H = S / 2;

  it('snaps strangers to the centre of a ~500 m cell, stably', async () => {
    const a = area();
    const viewer = await createUser(t);
    const one = await createUser(t, { privacyMode: 'everyone' });
    const two = await createUser(t, { privacyMode: 'everyone' });
    // Both inside the same cell (cell row centred at H + k·S).
    const k = Math.round((a.lat - H) / S);
    const rowLat = k * S + H;
    await setLocation(t, one.id, rowLat + 0.001, a.lng + 0.0004, 1);
    await setLocation(t, two.id, rowLat - 0.0012, a.lng + 0.0001, 1);

    const r1 = byId((await mapUsers(viewer.token, `bbox=${a.bbox}`).expect(200)).body.items);
    const p1 = r1.get(one.id)!;
    const p2 = r1.get(two.id)!;
    expect(p1.approximate).toBe(true);
    // The returned point is the cell centre: it doesn't depend on where inside the cell the user is.
    expect(p1.lat).toBeCloseTo(rowLat, 9);
    expect({ lat: p2.lat, lng: p2.lng }).toEqual({ lat: p1.lat, lng: p1.lng });
    expect(p1.lat).not.toBeCloseTo(rowLat + 0.001, 6);
    // Cell width in longitude is ~500 m at this latitude: the centre sits on (lng - w/2) / w ∈ ℤ.
    const w = S / Math.cos((rowLat * Math.PI) / 180);
    const idx = (p1.lng - w / 2) / w;
    expect(Math.abs(idx - Math.round(idx))).toBeLessThan(1e-6);
    expect(w * 111_320 * Math.cos((rowLat * Math.PI) / 180)).toBeCloseTo(500, -1);

    // Stable across requests and small moves within the cell.
    await setLocation(t, one.id, rowLat + 0.0005, a.lng + 0.0002, 1);
    const r2 = byId((await mapUsers(viewer.token, `bbox=${a.bbox}`).expect(200)).body.items);
    expect(r2.get(one.id)).toMatchObject({ lat: p1.lat, lng: p1.lng });
  });

  it("filters strangers by their snapped position, so the bbox edge can't reveal the exact one", async () => {
    const a = area();
    const viewer = await createUser(t);
    const stranger = await createUser(t, { privacyMode: 'everyone' });
    const k = Math.round((a.lat - H) / S);
    const centreLat = k * S + H;
    const exactLat = centreLat + 0.0015; // north of its cell centre
    await setLocation(t, stranger.id, exactLat, a.lng, 1);
    // A bbox containing the exact point but not the cell centre: not returned.
    const tight = `${a.lng - 0.01},${centreLat + 0.0005},${a.lng + 0.01},${exactLat + 0.01}`;
    expect((await mapUsers(viewer.token, `bbox=${tight}`).expect(200)).body.items).toEqual([]);
    // A bbox containing the centre but not the exact point: returned (approximate).
    const around = `${a.lng - 0.01},${centreLat - 0.001},${a.lng + 0.01},${centreLat + 0.001}`;
    const res = await mapUsers(viewer.token, `bbox=${around}`).expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].approximate).toBe(true);
  });
});

describe('GET /map/users filters and limits', () => {
  it('friends=true returns friends only', async () => {
    const a = area();
    const viewer = await createUser(t);
    const friend = await createUser(t, { privacyMode: 'everyone' });
    const stranger = await createUser(t, { privacyMode: 'everyone' });
    const co = await createUser(t, { privacyMode: 'community' });
    await makeFriends(t, viewer.id, friend.id);
    await createCommunity(t, viewer.id, [{ userId: co.id }]);
    for (const u of [friend, stranger, co]) await setLocation(t, u.id, a.lat, a.lng, 1);
    expect((await mapUsers(viewer.token, `bbox=${a.bbox}`).expect(200)).body.items).toHaveLength(3);
    const res = await mapUsers(viewer.token, `bbox=${a.bbox}&friends=true`).expect(200);
    expect((res.body.items as MapUser[]).map((i) => i.userId)).toEqual([friend.id]);
    expect((await mapUsers(viewer.token, `bbox=${a.bbox}&friends=false`).expect(200)).body.items).toHaveLength(3);
  });

  it('communityIds returns visible members of those communities and rejects foreign communities', async () => {
    const a = area();
    const viewer = await createUser(t);
    const m1 = await createUser(t, { privacyMode: 'community' });
    const m2 = await createUser(t, { privacyMode: 'everyone' });
    const other = await createUser(t, { privacyMode: 'everyone' });
    const pendingInC1 = await createUser(t, { privacyMode: 'everyone' });
    const c1 = await createCommunity(t, viewer.id, [{ userId: m1.id }, { userId: pendingInC1.id, status: 'pending' }], { isPrivate: true });
    const c2 = await createCommunity(t, m2.id, [{ userId: viewer.id }]);
    for (const u of [m1, m2, other, pendingInC1]) await setLocation(t, u.id, a.lat, a.lng, 1);

    const r1 = await mapUsers(viewer.token, `bbox=${a.bbox}&communityIds=${c1}`).expect(200);
    expect((r1.body.items as MapUser[]).map((i) => i.userId)).toEqual([m1.id]);
    const r2 = await mapUsers(viewer.token, `bbox=${a.bbox}&communityIds=${c1},${c2}`).expect(200);
    expect((r2.body.items as MapUser[]).map((i) => i.userId).sort()).toEqual([m1.id, m2.id].sort());
    const r2map = byId(r2.body.items as MapUser[]);
    expect(r2map.get(m1.id)).toMatchObject({ relation: 'community', approximate: false }); // private community
    expect(r2map.get(m2.id)).toMatchObject({ relation: 'community', approximate: true }); // public community only

    // Not a member / pending member / deleted community → 403.
    const foreign = await createCommunity(t, other.id);
    const pendingMine = await createCommunity(t, other.id, [{ userId: viewer.id, status: 'pending' }]);
    const deleted = await createCommunity(t, viewer.id, [], { deleted: true });
    for (const id of [foreign, `${c1},${foreign}`, pendingMine, deleted, newId()]) {
      const res = await mapUsers(viewer.token, `bbox=${a.bbox}&communityIds=${id}`).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    await mapUsers(viewer.token, `bbox=${a.bbox}&communityIds=not-a-uuid`).expect(400);
  });

  it('brand matches the primary vehicle, case-insensitively', async () => {
    const a = area();
    const viewer = await createUser(t);
    const toyota = await createUser(t, { privacyMode: 'everyone' });
    const secondaryToyota = await createUser(t, { privacyMode: 'everyone' });
    const noCar = await createUser(t, { privacyMode: 'everyone' });
    await t.prisma.vehicle.createMany({
      data: [
        { id: newId(), userId: toyota.id, brand: 'Toyota', model: 'Prado', year: 2015, isPrimary: true },
        { id: newId(), userId: secondaryToyota.id, brand: 'Kia', model: 'Rio', year: 2018, isPrimary: true },
        { id: newId(), userId: secondaryToyota.id, brand: 'Toyota', model: 'Corolla', year: 2008, isPrimary: false },
      ],
    });
    for (const u of [toyota, secondaryToyota, noCar]) await setLocation(t, u.id, a.lat, a.lng, 1);
    const res = await mapUsers(viewer.token, `bbox=${a.bbox}&brand=tOYOTA`).expect(200);
    expect((res.body.items as MapUser[]).map((i) => i.userId)).toEqual([toyota.id]);
    expect(res.body.items[0].vehicle).toEqual({ brand: 'Toyota', model: 'Prado' });
    expect((await mapUsers(viewer.token, `bbox=${a.bbox}&brand=Lada`).expect(200)).body.items).toEqual([]);
  });

  it('rejects a bbox larger than 2° × 2° and malformed ones', async () => {
    const viewer = await createUser(t);
    for (const bbox of ['76,43,78.5,44', '76,42,77,44.01']) {
      const res = await mapUsers(viewer.token, `bbox=${bbox}`).expect(400);
      expect(res.body.error.code).toBe('BBOX_TOO_LARGE');
    }
    await mapUsers(viewer.token, 'bbox=76,43,78,45').expect(200);
    for (const bbox of ['', '1,2,3', '77,43,76,44', 'a,b,c,d', '0,0,200,1']) {
      const res = await mapUsers(viewer.token, `bbox=${bbox}`).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    await request(t.http).get('/api/v1/map/users?bbox=76,43,77,44').expect(401);
  });

  it(`returns at most ${MAP_MAX_USERS} users, newest first, with truncated=true`, async () => {
    const a = area();
    const viewer = await createUser(t);
    const total = MAP_MAX_USERS + 5;
    const ids = Array.from({ length: total }, () => newId());
    await t.prisma.user.createMany({
      data: ids.map((id, i) => ({ id, name: `Bulk ${i}`, nickname: `bulk_${id.slice(-12)}`, privacyMode: 'everyone' as const, onboardedAt: new Date() })),
    });
    // Spread over the area; the i-th user is i seconds old.
    await t.prisma.$executeRaw`
      INSERT INTO user_locations (user_id, location, updated_at)
      SELECT d.id, ST_SetSRID(ST_MakePoint(${a.lng}::float8 + (d.n % 20) * 0.002, ${a.lat}::float8 + (d.n / 20) * 0.001), 4326)::geography,
             now() - make_interval(secs => d.n)
      FROM unnest(${ids}::uuid[]) WITH ORDINALITY AS d(id, n)`;
    const res = await mapUsers(viewer.token, `bbox=${a.bbox}`).expect(200);
    expect(res.body.truncated).toBe(true);
    expect(res.body.items).toHaveLength(MAP_MAX_USERS);
    const times = (res.body.items as MapUser[]).map((i) => new Date(i.updatedAt).getTime());
    expect([...times].sort((x, y) => y - x)).toEqual(times);
    // The cut-off rows are the oldest (approximate times are minute-rounded, ties broken by id).
    const returned = new Set((res.body.items as MapUser[]).map((i) => i.userId));
    const cut = ids.filter((id) => !returned.has(id));
    expect(cut).toHaveLength(5);
    const cutTimes = await t.prisma.$queryRaw<{ m: Date }[]>`
      SELECT date_trunc('minute', updated_at) AS m FROM user_locations WHERE user_id = ANY(${cut}::uuid[])`;
    const oldestReturned = Math.min(...times);
    expect(cutTimes.every((r) => r.m.getTime() <= oldestReturned)).toBe(true);
  });
});

describe('map query plan', () => {
  it('uses the GiST index on user_locations.location for the bbox', async () => {
    // Realistic shape: many fresh positions spread over Kazakhstan, a city-sized bbox.
    const ids = Array.from({ length: 5000 }, () => newId());
    await t.prisma.user.createMany({
      data: ids.map((id, i) => ({ id, name: `Plan ${i}`, nickname: `plan_${id.slice(-12)}`, privacyMode: 'everyone' as const, onboardedAt: new Date() })),
    });
    await t.prisma.$executeRaw`
      INSERT INTO user_locations (user_id, location, updated_at)
      SELECT d.id, ST_SetSRID(ST_MakePoint(50 + random() * 37, 41 + random() * 14), 4326)::geography, now()
      FROM unnest(${ids}::uuid[]) AS d(id)`;
    await t.prisma.$executeRaw`ANALYZE user_locations`;
    await t.prisma.$executeRaw`ANALYZE users`;
    const viewer = await createUser(t);
    const sql = t.app.get(MapService).buildQuery(viewer.id, { minLng: 76.85, minLat: 43.21, maxLng: 76.95, maxLat: 43.26 }, {
      friendsOnly: false,
      communityIds: [],
      brand: null,
    });
    const plan = await t.prisma.$queryRaw<{ 'QUERY PLAN': string }[]>(Prisma.sql`EXPLAIN ${sql}`);
    const text = plan.map((r) => r['QUERY PLAN']).join('\n');
    // "Index Scan using …" or "Bitmap Index Scan on …", depending on statistics.
    expect(text).toMatch(/Index Scan (using|on) user_locations_location_gist/);
    expect(text).not.toMatch(/Seq Scan on user_locations/);
  });
});

describe('map access rules', () => {
  it('requires a completed onboarding (403 ONBOARDING_INCOMPLETE)', async () => {
    const fresh = await createUser(t, { onboarded: false, nickname: null });
    const res = await mapUsers(fresh.token, 'bbox=76,43,77,44').expect(403);
    expect(res.body.error.code).toBe('ONBOARDING_INCOMPLETE');
  });

  it('rate limits to 60 requests per minute per user', async () => {
    const u = await createUser(t);
    const now = Date.now();
    await t.redis.zadd(`rl:map:${u.id}`, ...Array.from({ length: 60 }, (_, i) => [now - i, `m${i}`]).flat());
    const res = await mapUsers(u.token, 'bbox=76,43,77,44').expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    const other = await createUser(t);
    await mapUsers(other.token, 'bbox=76,43,77,44').expect(200);
  });

  it('rounds updatedAt to the minute for approximate entries only', async () => {
    const a = area();
    const viewer = await createUser(t);
    const stranger = await createUser(t, { privacyMode: 'everyone' });
    const friend = await createUser(t, { privacyMode: 'everyone' });
    await makeFriends(t, viewer.id, friend.id);
    await t.prisma.$executeRaw`
      INSERT INTO user_locations (user_id, location, updated_at) VALUES
        (${stranger.id}::uuid, ST_SetSRID(ST_MakePoint(${a.lng}::float8, ${a.lat}::float8), 4326)::geography, date_trunc('minute', now()) + interval '17.25 seconds' - interval '1 minute'),
        (${friend.id}::uuid, ST_SetSRID(ST_MakePoint(${a.lng}::float8, ${a.lat}::float8), 4326)::geography, date_trunc('minute', now()) + interval '17.25 seconds' - interval '1 minute')`;
    const items = byId((await mapUsers(viewer.token, `bbox=${a.bbox}`).expect(200)).body.items);
    expect(new Date(items.get(stranger.id)!.updatedAt).getUTCSeconds()).toBe(0);
    expect(new Date(items.get(friend.id)!.updatedAt).getUTCSeconds()).toBe(17);
  });
});
