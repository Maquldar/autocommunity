import { bayesianServiceRating, type Paginated, type ServiceListItem, type WEEKDAYS } from '@autoc/shared';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../src/common/ids';
import { currentQrCode, serviceQrCode } from '../src/modules/services/qr';
import { almatyClock } from '@autoc/shared';
import { bearer, createTestApp, createUser, type TestApp } from './support/app';
import { pngImage as tinyPng } from './support/images';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

type Hours = Record<(typeof WEEKDAYS)[number], string | null>;
const WEEK: Hours = { mon: '09:00-19:00', tue: '09:00-19:00', wed: '09:00-19:00', thu: '09:00-19:00', fri: '09:00-19:00', sat: '10:00-16:00', sun: null };
const ALWAYS: Hours = { mon: '00:00-24:00', tue: '00:00-24:00', wed: '00:00-24:00', thu: '00:00-24:00', fri: '00:00-24:00', sat: '00:00-24:00', sun: '00:00-24:00' };

/** Base point (Almaty centre) and a helper to move north by metres (1° lat ≈ 111 195 m). */
const BASE = { lat: 43.2389, lng: 76.8897 };
const north = (m: number, from = BASE) => ({ lat: from.lat + m / 111_195, lng: from.lng });

type SeedOpts = {
  name?: string;
  category?: 'repair' | 'tires' | 'wash' | 'parts' | 'tow';
  status?: 'pending' | 'verified' | 'rejected';
  lat?: number;
  lng?: number;
  rating?: number;
  reviewCount?: number;
  address?: string;
  hours?: Hours;
  submittedById?: string | null;
};

async function seedService(o: SeedOpts = {}): Promise<{ id: string; qrSecret: string }> {
  const id = newId();
  const qrSecret = randomBytes(32).toString('hex');
  const at = { lat: o.lat ?? BASE.lat, lng: o.lng ?? BASE.lng };
  await t.prisma.$executeRaw`
    INSERT INTO service_centers (id, name, category, description, address, phone, hours, location, rating, review_count,
                                 status, qr_secret, submitted_by_id, updated_at)
    VALUES (${id}::uuid, ${o.name ?? `Service ${id.slice(-6)}`}, ${o.category ?? 'repair'}::"ServiceCategory", 'desc',
            ${o.address ?? 'ул. Абая, 1'}, '+77271234567', ${JSON.stringify(o.hours ?? WEEK)}::jsonb,
            ST_SetSRID(ST_MakePoint(${at.lng}::float8, ${at.lat}::float8), 4326)::geography,
            ${o.rating ?? 3.5}::float8, ${o.reviewCount ?? 0}::int, ${o.status ?? 'verified'}::"ServiceStatus", ${qrSecret},
            ${o.submittedById ?? null}::uuid, now())`;
  return { id, qrSecret };
}

const clearServices = async () => {
  await t.prisma.$executeRawUnsafe('TRUNCATE service_centers, service_visits, reviews CASCADE');
  await t.redis.flushdb();
};

const get = (token: string, path: string, query: Record<string, unknown> = {}) =>
  request(t.http).get(`/api/v1${path}`).query(query).set(bearer(token));
const post = (token: string, path: string, body: object) => request(t.http).post(`/api/v1${path}`).set(bearer(token)).send(body);

async function allPages(token: string, query: Record<string, unknown>, limit = 2): Promise<ServiceListItem[]> {
  const items: ServiceListItem[] = [];
  let cursor: string | null | undefined;
  for (let i = 0; i < 50; i++) {
    const res = await get(token, '/services', { ...query, limit, ...(cursor ? { cursor } : {}) }).expect(200);
    const page = res.body as Paginated<ServiceListItem>;
    expect(page.items.length).toBeLessThanOrEqual(limit);
    items.push(...page.items);
    cursor = page.nextCursor;
    if (!cursor) return items;
  }
  throw new Error('pagination did not terminate');
}

const validBody = (over: Record<string, unknown> = {}) => ({
  name: 'Автосервис Тест',
  category: 'repair',
  description: 'Ремонт ходовой',
  address: 'ул. Сатпаева, 30',
  phone: '+7 727 300 10 20',
  hours: WEEK,
  lat: 43.2401,
  lng: 76.9101,
  photoUploadIds: [],
  ...over,
});

describe('GET /services (list)', () => {
  let token: string;
  beforeAll(async () => {
    await clearServices();
    token = (await createUser(t)).token;
    // Distances from BASE: 100, 300, 500, 700, 900 m; ratings deliberately not in distance order.
    await seedService({ name: 'Alpha Wash', category: 'wash', ...north(100), rating: 3.9, reviewCount: 2, address: 'пр. Абая, 10' });
    await seedService({ name: 'Bravo Tires', category: 'tires', ...north(300), rating: 4.4, reviewCount: 8 });
    await seedService({ name: 'Charlie Repair', category: 'repair', ...north(500), rating: 4.4, reviewCount: 3 });
    await seedService({ name: 'Delta Repair', category: 'repair', ...north(700), rating: 4.4, reviewCount: 3 });
    await seedService({ name: 'Echo Parts', category: 'parts', ...north(900), rating: 3.5, reviewCount: 0, address: 'ул. Тимирязева, 5' });
    await seedService({ name: 'Hidden Pending', category: 'repair', ...north(50), status: 'pending' });
    await seedService({ name: 'Rejected One', category: 'repair', ...north(60), status: 'rejected' });
  });

  it('returns only verified services sorted by rating desc, reviewCount desc, id desc by default', async () => {
    const items = await allPages(token, {});
    expect(items.map((s) => s.name)).toEqual(['Bravo Tires', expect.any(String), expect.any(String), 'Alpha Wash', 'Echo Parts']);
    // Charlie and Delta tie on (rating, reviewCount): id desc → the later-created (Delta) first.
    expect(items.slice(1, 3).map((s) => s.name)).toEqual(['Delta Repair', 'Charlie Repair']);
    expect(items.every((s) => s.status === 'verified' && s.distanceM === null)).toBe(true);
  });

  it('sorts by distance with a (distance, id) cursor when lat/lng are given', async () => {
    const items = await allPages(token, { ...BASE });
    expect(items.map((s) => s.name)).toEqual(['Alpha Wash', 'Bravo Tires', 'Charlie Repair', 'Delta Repair', 'Echo Parts']);
    const d = items.map((s) => s.distanceM!);
    expect(d[0]).toBeGreaterThan(90);
    expect(d[0]).toBeLessThan(110);
    expect(d[4]).toBeGreaterThan(890);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
  });

  it('sort=rating with a location still reports distance', async () => {
    const items = await allPages(token, { ...BASE, sort: 'rating' }, 3);
    expect(items[0]!.name).toBe('Bravo Tires');
    expect(items.every((s) => typeof s.distanceM === 'number')).toBe(true);
  });

  it('filters by category and searches name/address (case-insensitive, literal)', async () => {
    expect((await allPages(token, { category: 'repair' })).map((s) => s.name)).toEqual(['Delta Repair', 'Charlie Repair']);
    expect((await allPages(token, { q: 'TIRES' })).map((s) => s.name)).toEqual(['Bravo Tires']);
    expect((await allPages(token, { q: 'тимирязева' })).map((s) => s.name)).toEqual(['Echo Parts']);
    expect(await allPages(token, { q: '%%' })).toEqual([]);
    expect((await allPages(token, { q: 'repair', category: 'repair', ...BASE })).map((s) => s.name)).toEqual([
      'Charlie Repair',
      'Delta Repair',
    ]);
  });

  it('includes list fields: openNow, photoUrl, counters', async () => {
    const [first] = (await get(token, '/services', { q: 'Alpha' }).expect(200)).body.items as ServiceListItem[];
    expect(first).toMatchObject({ category: 'wash', photoUrl: null, reviewCount: 2, visitCount: 0, phone: '+77271234567' });
    expect(typeof first!.openNow).toBe('boolean');
    expect(first).not.toHaveProperty('hours');
  });

  it('validates the query', async () => {
    await get(token, '/services', { sort: 'distance' }).expect(400);
    await get(token, '/services', { lat: 43.2 }).expect(400);
    await get(token, '/services', { q: 'a' }).expect(400);
    await get(token, '/services', { category: 'spa' }).expect(400);
    await get(token, '/services', { cursor: 'garbage' }).expect(400);
    // A rating cursor can't be replayed against the distance sort.
    const page = (await get(token, '/services', { limit: 1 }).expect(200)).body as Paginated<ServiceListItem>;
    await get(token, '/services', { ...BASE, cursor: page.nextCursor }).expect(400);
    await request(t.http).get('/api/v1/services').expect(401);
  });
});

describe('GET /map/services', () => {
  let token: string;
  beforeAll(async () => {
    await clearServices();
    token = (await createUser(t)).token;
    await seedService({ name: 'In box', ...BASE, category: 'tow' });
    await seedService({ name: 'In box wash', lat: BASE.lat + 0.01, lng: BASE.lng + 0.01, category: 'wash' });
    await seedService({ name: 'Outside', lat: 43.5, lng: 77.5 });
    await seedService({ name: 'Pending in box', ...BASE, status: 'pending' });
  });

  it('returns verified services inside the bbox, filtered by category', async () => {
    const bbox = '76.8,43.2,77.0,43.3';
    const res = await get(token, '/map/services', { bbox }).expect(200);
    expect(res.body.truncated).toBe(false);
    expect(res.body.items.map((i: { name: string }) => i.name).sort()).toEqual(['In box', 'In box wash']);
    expect(res.body.items[0]).toEqual({
      id: expect.any(String),
      name: expect.any(String),
      category: expect.any(String),
      lat: expect.any(Number),
      lng: expect.any(Number),
      rating: 3.5,
    });
    const tow = await get(token, '/map/services', { bbox, category: 'tow' }).expect(200);
    expect(tow.body.items.map((i: { name: string }) => i.name)).toEqual(['In box']);
    const item = tow.body.items[0];
    expect(item.lat).toBeCloseTo(BASE.lat, 6);
    expect(item.lng).toBeCloseTo(BASE.lng, 6);
  });

  it('rejects malformed and oversized bboxes', async () => {
    await get(token, '/map/services', { bbox: '1,2,3' }).expect(400);
    const big = await get(token, '/map/services', { bbox: '75.0,43.0,77.5,43.5' }).expect(400);
    expect(big.body.error.code).toBe('BBOX_TOO_LARGE');
  });
});

describe('GET /services/:id (details)', () => {
  it('shows verified services to everyone, pending only to the submitter and admins', async () => {
    await clearServices();
    const submitter = await createUser(t);
    const other = await createUser(t);
    const admin = await createUser(t, { role: 'admin' });
    const verified = await seedService({ name: 'Open one', hours: ALWAYS });
    const pending = await seedService({ name: 'Mine pending', status: 'pending', submittedById: submitter.id });

    const res = await get(other.token, `/services/${verified.id}`, north(40)).expect(200);
    expect(res.body).toMatchObject({
      id: verified.id,
      name: 'Open one',
      status: 'verified',
      openNow: true,
      myVisit: null,
      photos: [],
      hours: ALWAYS,
      description: 'desc',
    });
    expect(res.body.distanceM).toBeGreaterThan(35);
    expect(res.body.distanceM).toBeLessThan(45);
    expect((await get(other.token, `/services/${verified.id}`).expect(200)).body.distanceM).toBeNull();

    expect((await get(submitter.token, `/services/${pending.id}`).expect(200)).body.status).toBe('pending');
    await get(admin.token, `/services/${pending.id}`).expect(200);
    expect((await get(other.token, `/services/${pending.id}`).expect(404)).body.error.code).toBe('NOT_FOUND');
    await get(other.token, `/services/${pending.id}/reviews`).expect(404);
    await get(other.token, `/services/${newId()}`).expect(404);
    await get(other.token, '/services/not-a-uuid').expect(400);
  });
});

describe('POST /services (submit)', () => {
  beforeEach(clearServices);

  it('creates a pending service with photos and normalized fields', async () => {
    const u = await createUser(t);
    const upload = await request(t.http)
      .post('/api/v1/uploads?purpose=service')
      .set(bearer(u.token))
      .attach('file', await tinyPng(), 'p.png')
      .expect(201);
    const res = await post(u.token, '/services', validBody({ photoUploadIds: [upload.body.id] })).expect(201);
    expect(res.body).toMatchObject({
      name: 'Автосервис Тест',
      status: 'pending',
      phone: '+77273001020',
      rating: 3.5,
      reviewCount: 0,
      visitCount: 0,
      myVisit: null,
      hours: WEEK,
    });
    expect(res.body.photos).toHaveLength(1);
    expect(res.body.lat).toBeCloseTo(43.2401, 6);
    // Not listed until verified.
    expect((await get(u.token, '/services').expect(200)).body.items).toEqual([]);
  });

  it('validates the body', async () => {
    const u = await createUser(t);
    const bad = async (over: Record<string, unknown>) =>
      expect((await post(u.token, '/services', validBody(over)).expect(400)).body.error.code).toBe('VALIDATION_ERROR');
    await bad({ name: 'A' });
    await bad({ name: 'x'.repeat(81) });
    await bad({ category: 'spa' });
    await bad({ address: 'abc' });
    await bad({ description: 'x'.repeat(1001) });
    await bad({ phone: '12' });
    await bad({ hours: { ...WEEK, mon: '9-19' } });
    await bad({ hours: { mon: '09:00-19:00' } });
    await bad({ lat: 91 });
    await bad({ photoUploadIds: Array.from({ length: 7 }, () => newId()) });
    // Someone else's upload or a wrong purpose.
    const other = await createUser(t);
    const foreign = await request(t.http)
      .post('/api/v1/uploads?purpose=service')
      .set(bearer(other.token))
      .attach('file', await tinyPng(), 'p.png')
      .expect(201);
    const res = await post(u.token, '/services', validBody({ photoUploadIds: [foreign.body.id] })).expect(400);
    expect(res.body.error.code).toBe('INVALID_UPLOAD');
    // Phone is optional; "" means none.
    expect((await post(u.token, '/services', validBody({ phone: '' })).expect(201)).body.phone).toBeNull();
  });

  it('rejects a duplicate: same category, within 30 m and a similar name', async () => {
    const u = await createUser(t);
    const first = await post(u.token, '/services', validBody()).expect(201);
    const near = north(20, { lat: 43.2401, lng: 76.9101 });
    const dup = await post(u.token, '/services', validBody({ name: ' автосервис  тест! ', ...near })).expect(409);
    expect(dup.body.error).toMatchObject({ code: 'SERVICE_DUPLICATE', details: { serviceId: first.body.id } });
    const contained = await post(u.token, '/services', validBody({ name: 'Автосервис Тест Плюс', ...near })).expect(409);
    expect(contained.body.error.code).toBe('SERVICE_DUPLICATE');
    // Different category, different name or farther than 30 m are fine.
    await post(u.token, '/services', validBody({ category: 'wash', ...near })).expect(201);
    await post(u.token, '/services', validBody({ name: 'Шиномонтаж Колесо', ...near })).expect(201);
    await post(u.token, '/services', validBody(north(60, { lat: 43.2401, lng: 76.9101 }))).expect(201);
  });

  it('does not reveal a duplicate pending entry of another user', async () => {
    const a = await createUser(t);
    const b = await createUser(t);
    await post(a.token, '/services', validBody()).expect(201);
    const dup = await post(b.token, '/services', validBody()).expect(409);
    expect(dup.body.error.code).toBe('SERVICE_DUPLICATE');
    expect(dup.body.error.details).toBeUndefined();
  });

  it('allows 5 accepted submissions per day; refused ones do not count', async () => {
    const u = await createUser(t);
    await post(u.token, '/services', validBody({ name: 'Sub 0', lat: 43.2 })).expect(201);
    await post(u.token, '/services', validBody({ name: 'Sub 0', lat: 43.2 })).expect(409); // duplicate, refunded
    for (let i = 1; i < 5; i++) await post(u.token, '/services', validBody({ name: `Sub ${i}`, lat: 43.2 + i * 0.01 })).expect(201);
    const limited = await post(u.token, '/services', validBody({ name: 'Sub 5', lat: 43.29 })).expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();
  });
});

describe('visits', () => {
  beforeEach(clearServices);

  it('geo: verified within 150 m, 422 TOO_FAR beyond (nothing stored)', async () => {
    const u = await createUser(t);
    const s = await seedService();
    const far = await post(u.token, `/services/${s.id}/visits`, { method: 'geo', ...north(200) }).expect(422);
    expect(far.body.error.code).toBe('TOO_FAR');
    expect(far.body.error.details.distanceM).toBeGreaterThan(190);
    expect(await t.prisma.serviceVisit.count()).toBe(0);

    const ok = await post(u.token, `/services/${s.id}/visits`, { method: 'geo', ...north(120) }).expect(201);
    expect(ok.body).toMatchObject({ serviceId: s.id, method: 'geo', status: 'verified' });
    expect(ok.body.distanceM).toBeGreaterThan(110);
    expect(ok.body.distanceM).toBeLessThanOrEqual(150);

    const details = (await get(u.token, `/services/${s.id}`).expect(200)).body;
    expect(details.visitCount).toBe(1);
    expect(details.myVisit).toMatchObject({ id: ok.body.id, method: 'geo', status: 'verified', reviewed: false });
  });

  it('VISIT_EXISTS: one verified/pending visit per service per user per 24 h', async () => {
    const u = await createUser(t);
    const s = await seedService();
    const other = await seedService({ name: 'Other' });
    const first = await post(u.token, `/services/${s.id}/visits`, { method: 'geo', ...BASE }).expect(201);
    const again = await post(u.token, `/services/${s.id}/visits`, { method: 'qr', code: currentQrCode(s.qrSecret) }).expect(409);
    expect(again.body.error.code).toBe('VISIT_EXISTS');
    // Another service is fine; so is the same one after 24 h.
    await post(u.token, `/services/${other.id}/visits`, { method: 'geo', ...BASE }).expect(201);
    await t.prisma.serviceVisit.update({ where: { id: first.body.id }, data: { createdAt: new Date(Date.now() - 25 * 3_600_000) } });
    await post(u.token, `/services/${s.id}/visits`, { method: 'geo', ...BASE }).expect(201);
    // A rejected visit doesn't block.
    const v = await createUser(t);
    const rejected = await post(v.token, `/services/${s.id}/visits`, { method: 'geo', ...BASE }).expect(201);
    await t.prisma.serviceVisit.update({ where: { id: rejected.body.id }, data: { status: 'rejected' } });
    await post(v.token, `/services/${s.id}/visits`, { method: 'geo', ...BASE }).expect(201);
  });

  it('qr: today and yesterday (Almaty date) are valid; anything else is INVALID_QR', async () => {
    const s = await seedService();
    const today = almatyClock(new Date()).date;
    const yesterday = almatyClock(new Date(Date.now() - 86_400_000)).date;
    const twoDaysAgo = almatyClock(new Date(Date.now() - 2 * 86_400_000)).date;

    const a = await createUser(t);
    const code = serviceQrCode(s.qrSecret, today);
    expect(code).toMatch(/^[A-Z2-7]{8}$/);
    // Lowercase with separators is accepted.
    const pretty = `${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`;
    expect((await post(a.token, `/services/${s.id}/visits`, { method: 'qr', code: pretty }).expect(201)).body).toMatchObject({
      method: 'qr',
      status: 'verified',
      distanceM: null,
    });

    const b = await createUser(t);
    await post(b.token, `/services/${s.id}/visits`, { method: 'qr', code: serviceQrCode(s.qrSecret, yesterday) }).expect(201);

    const c = await createUser(t);
    for (const bad of [serviceQrCode(s.qrSecret, twoDaysAgo), 'AAAAAAAA', 'short', serviceQrCode('other-secret', today)]) {
      const res = await post(c.token, `/services/${s.id}/visits`, { method: 'qr', code: bad }).expect(422);
      expect(res.body.error.code).toBe('INVALID_QR');
    }
    expect(await t.prisma.serviceVisit.count({ where: { userId: c.id } })).toBe(0);
  });

  it('photo: creates a pending visit (order upload, own, not reused); pending counts toward VISIT_EXISTS', async () => {
    const u = await createUser(t);
    const s = await seedService();
    const s2 = await seedService({ name: 'Second' });
    const upload = async (purpose: string) =>
      (
        await request(t.http)
          .post(`/api/v1/uploads?purpose=${purpose}`)
          .set(bearer(u.token))
          .attach('file', await tinyPng(), 'o.png')
          .expect(201)
      ).body.id as string;
    const wrong = await upload('service');
    expect((await post(u.token, `/services/${s.id}/visits`, { method: 'photo', uploadId: wrong }).expect(400)).body.error.code).toBe(
      'INVALID_UPLOAD',
    );
    const order = await upload('order');
    const res = await post(u.token, `/services/${s.id}/visits`, { method: 'photo', uploadId: order }).expect(201);
    expect(res.body).toMatchObject({ method: 'photo', status: 'pending' });
    expect((await get(u.token, `/services/${s.id}`).expect(200)).body).toMatchObject({ visitCount: 0, myVisit: { status: 'pending' } });
    expect((await post(u.token, `/services/${s.id}/visits`, { method: 'geo', ...BASE }).expect(409)).body.error.code).toBe('VISIT_EXISTS');
    // The same order photo can't back a second visit.
    expect((await post(u.token, `/services/${s2.id}/visits`, { method: 'photo', uploadId: order }).expect(400)).body.error.code).toBe(
      'INVALID_UPLOAD',
    );
  });

  it('only verified services can be visited; body is validated', async () => {
    const u = await createUser(t);
    const pending = await seedService({ status: 'pending', submittedById: u.id });
    await post(u.token, `/services/${pending.id}/visits`, { method: 'geo', ...BASE }).expect(404);
    const s = await seedService({ name: 'v' });
    await post(u.token, `/services/${s.id}/visits`, { method: 'teleport' }).expect(400);
    await post(u.token, `/services/${s.id}/visits`, { method: 'geo', lat: 100, lng: 0 }).expect(400);
    await post(u.token, `/services/${newId()}/visits`, { method: 'geo', ...BASE }).expect(404);
  });

  it('rate-limits visit attempts (30/h per user)', async () => {
    const u = await createUser(t);
    const s = await seedService();
    for (let i = 0; i < 30; i++) await post(u.token, `/services/${s.id}/visits`, { method: 'qr', code: 'AAAAAAAA' }).expect(422);
    expect((await post(u.token, `/services/${s.id}/visits`, { method: 'qr', code: 'AAAAAAAA' }).expect(429)).body.error.code).toBe(
      'RATE_LIMITED',
    );
  });
});

describe('reviews', () => {
  beforeEach(clearServices);

  const visit = async (token: string, serviceId: string) =>
    (await post(token, `/services/${serviceId}/visits`, { method: 'geo', ...BASE }).expect(201)).body.id as string;

  it('requires a verified visit of the caller to this service', async () => {
    const u = await createUser(t);
    const other = await createUser(t);
    const s = await seedService();
    const s2 = await seedService({ name: 'Two' });
    const code = async (token: string, body: object, id = s.id) => (await post(token, `/services/${id}/reviews`, body).expect(403)).body.error.code;

    expect(await code(u.token, { visitId: newId(), stars: 5 })).toBe('VISIT_REQUIRED');
    const otherVisit = await visit(other.token, s.id);
    expect(await code(u.token, { visitId: otherVisit, stars: 5 })).toBe('VISIT_REQUIRED');
    const myVisitElsewhere = await visit(u.token, s2.id);
    expect(await code(u.token, { visitId: myVisitElsewhere, stars: 5 })).toBe('VISIT_REQUIRED');

    // Pending (photo) visit isn't enough.
    const pendingId = newId();
    await t.prisma.serviceVisit.create({ data: { id: pendingId, userId: u.id, serviceId: s.id, method: 'photo', status: 'pending' } });
    expect(await code(u.token, { visitId: pendingId, stars: 4 })).toBe('VISIT_REQUIRED');

    await post(u.token, `/services/${s.id}/reviews`, { visitId: newId(), stars: 6 }).expect(400);
  });

  it('one review per visit, then a 30-day cooldown per service', async () => {
    const u = await createUser(t);
    const s = await seedService();
    const v1 = await visit(u.token, s.id);
    const created = await post(u.token, `/services/${s.id}/reviews`, { visitId: v1, stars: 5, comment: '  Отлично!  ' }).expect(201);
    expect(created.body).toMatchObject({ stars: 5, comment: 'Отлично!', visitMethod: 'geo', author: { id: u.id } });

    expect((await post(u.token, `/services/${s.id}/reviews`, { visitId: v1, stars: 4 }).expect(403)).body.error.code).toBe(
      'VISIT_REQUIRED',
    );

    // A new visit a day later can't be reviewed within 30 days of the last review.
    await t.prisma.serviceVisit.update({ where: { id: v1 }, data: { createdAt: new Date(Date.now() - 25 * 3_600_000) } });
    const v2 = await visit(u.token, s.id);
    const cooldown = await post(u.token, `/services/${s.id}/reviews`, { visitId: v2, stars: 4 }).expect(409);
    expect(cooldown.body.error.code).toBe('REVIEW_COOLDOWN');
    expect(cooldown.body.error.details.availableAt).toEqual(expect.any(String));

    await t.prisma.review.updateMany({ where: { authorId: u.id }, data: { createdAt: new Date(Date.now() - 31 * 86_400_000) } });
    await post(u.token, `/services/${s.id}/reviews`, { visitId: v2, stars: 4 }).expect(201);
    expect((await get(u.token, `/services/${s.id}`).expect(200)).body.myVisit).toMatchObject({ id: v2, reviewed: true });
  });

  it('recomputes the Bayesian rating and counters transactionally; lists reviews newest first', async () => {
    const s = await seedService();
    const stars = [5, 4, 5, 2];
    const authors: { id: string; token: string }[] = [];
    for (const n of stars) {
      const u = await createUser(t);
      authors.push(u);
      await post(u.token, `/services/${s.id}/reviews`, { visitId: await visit(u.token, s.id), stars: n }).expect(201);
    }
    // (3.5·5 + 16) / (5 + 4) = 3.722… → 3.7
    expect(bayesianServiceRating(16, 4)).toBe(3.7);
    const details = (await get(authors[0]!.token, `/services/${s.id}`).expect(200)).body;
    expect(details).toMatchObject({ rating: 3.7, reviewCount: 4, visitCount: 4 });

    // A verified visit without a review still counts as a visit.
    const lurker = await createUser(t);
    await visit(lurker.token, s.id);
    expect((await get(lurker.token, `/services/${s.id}`).expect(200)).body).toMatchObject({ rating: 3.7, reviewCount: 4, visitCount: 5 });

    const page1 = (await get(lurker.token, `/services/${s.id}/reviews`, { limit: 3 }).expect(200)).body;
    expect(page1.items.map((r: { stars: number }) => r.stars)).toEqual([2, 5, 4]);
    expect(page1.items[0]).toMatchObject({
      author: { id: authors[3]!.id, nickname: expect.any(String), rating: expect.any(Number) },
      visitMethod: 'geo',
      comment: null,
    });
    const page2 = (await get(lurker.token, `/services/${s.id}/reviews`, { limit: 3, cursor: page1.nextCursor }).expect(200)).body;
    expect(page2.items.map((r: { stars: number }) => r.stars)).toEqual([5]);
    expect(page2.nextCursor).toBeNull();

    // Rating sort uses the recomputed values.
    await seedService({ name: 'Unrated' });
    const list = (await get(lurker.token, '/services').expect(200)).body.items as ServiceListItem[];
    expect(list.map((i) => i.name)[0]).toBe(details.name);
  });
});

describe('GET /services/:id/qr', () => {
  it('is admin-only and returns today’s code', async () => {
    await clearServices();
    const s = await seedService({ status: 'pending' });
    const user = await createUser(t);
    const admin = await createUser(t, { role: 'admin' });
    expect((await get(user.token, `/services/${s.id}/qr`).expect(403)).body.error.code).toBe('FORBIDDEN');
    const res = await get(admin.token, `/services/${s.id}/qr`).expect(200);
    expect(res.body).toEqual({ code: currentQrCode(s.qrSecret), validFor: 'today' });
    await get(admin.token, `/services/${newId()}/qr`).expect(404);
  });
});
