import type { AdminViolationDto, OwnVehicleDto, Paginated, RatingDto, UserPublic, VehicleDetailDto, VehicleDto, ViolationDto } from '@autoc/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../src/common/ids';
import { BackgroundTasks } from '../src/infra/tasks/background-tasks';
import { UploadsCleanupService } from '../src/modules/uploads/uploads-cleanup.service';
import { bearer, createTestApp, createUser, makeFriends, type TestApp } from './support/app';
import { admin, seasoned, uploadRow, vehicleOf, type U } from './support/phase9';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const drain = () => t.app.get(BackgroundTasks).drain();
const get = (u: U, path: string) => request(t.http).get(`/api/v1${path}`).set(bearer(u.token));
const postAs = (u: U, path: string, body: object = {}) => request(t.http).post(`/api/v1${path}`).set(bearer(u.token)).send(body);
const patchAs = (u: U, path: string, body: object = {}) => request(t.http).patch(`/api/v1${path}`).set(bearer(u.token)).send(body);
const hourAgo = () => new Date(Date.now() - 3600_000).toISOString();

/** `submit(...).expect(status)` like a supertest call; the photo upload is created first. */
function submit(u: U, vehicleId: string, extra: object = {}) {
  return {
    expect: async (status: number) => {
      const photo = await uploadRow(t, u.id, 'violation');
      return postAs(u, `/vehicles/${vehicleId}/violations`, {
        category: 'speeding',
        codeType: 'koap',
        article: 'ст. 592 КоАП',
        occurredAt: hourAgo(),
        description: 'Ехал 120 км/ч по Аль-Фараби',
        photoUploadIds: [photo],
        ...extra,
      }).expect(status);
    },
  };
}

async function setup() {
  const owner = await seasoned(t, { rating: 50 });
  const vehicleId = await vehicleOf(t, owner.id);
  const reporter = await seasoned(t);
  return { owner, vehicleId, reporter };
}

async function ledgerMatches(userId: string): Promise<boolean> {
  const [r] = await t.prisma.$queryRaw<{ sum: number }[]>`SELECT coalesce(sum(delta), 0)::int AS sum FROM rating_events WHERE user_id = ${userId}::uuid`;
  return 50 + r!.sum === (await t.prisma.user.findUniqueOrThrow({ where: { id: userId } })).rating;
}

describe('submitting violations', () => {
  it('creates a pending violation, notifies the owner and hides the submitter', async () => {
    const { owner, vehicleId, reporter } = await setup();
    const v = (await submit(reporter, vehicleId).expect(201)).body as ViolationDto;
    expect(v).toMatchObject({
      vehicle: { id: vehicleId, brand: 'Toyota', model: 'Camry', year: 2018 },
      category: 'speeding',
      codeType: 'koap',
      article: 'ст. 592 КоАП',
      status: 'pending',
      dispute: null,
      submittedByMe: true,
      canDispute: false,
      decidedAt: null,
    });
    expect(v.photos).toHaveLength(1);
    expect(JSON.stringify(v)).not.toContain(reporter.id);
    const n = await t.prisma.notification.findFirstOrThrow({ where: { userId: owner.id, type: 'violation_reported' } });
    expect(n.payload).toEqual({ violationId: v.id, vehicleId, category: 'speeding', vehicle: 'Toyota Camry' });
    expect(JSON.stringify(n.payload)).not.toContain(reporter.id);
  });

  it('enforces eligibility, photos and the daily limit', async () => {
    const { owner, vehicleId, reporter } = await setup();
    expect((await submit(await seasoned(t, { ageDays: 3 }), vehicleId).expect(403)).body.error).toMatchObject({ code: 'ACCOUNT_TOO_NEW', details: { minDays: 7 } });
    expect((await submit(await seasoned(t, { rating: 39 }), vehicleId).expect(403)).body.error).toMatchObject({ code: 'RATING_TOO_LOW', details: { min: 40 } });
    // the owner may self-report whatever their age and rating
    await t.prisma.user.update({ where: { id: owner.id }, data: { createdAt: new Date(), rating: 10 } });
    await submit(owner, vehicleId).expect(201);
    expect(await t.prisma.notification.count({ where: { userId: owner.id, type: 'violation_reported' } })).toBe(0);

    await submit(reporter, newId()).expect(404);
    const gone = await createUser(t, { status: 'deleted' });
    await submit(reporter, await vehicleOf(t, gone.id)).expect(404);
    const other = await seasoned(t);
    await postAs(reporter, `/vehicles/${vehicleId}/violations`, { category: 'speeding', codeType: 'koap', occurredAt: hourAgo(), description: 'Нарушение ПДД тут', photoUploadIds: [await uploadRow(t, other.id, 'violation')] }).expect(400);
    await postAs(reporter, `/vehicles/${vehicleId}/violations`, { category: 'speeding', codeType: 'koap', occurredAt: hourAgo(), description: 'Нарушение ПДД тут', photoUploadIds: [await uploadRow(t, reporter.id, 'post')] }).expect(400);
    await postAs(reporter, `/vehicles/${vehicleId}/violations`, { category: 'speeding', codeType: 'koap', occurredAt: hourAgo(), description: 'Нарушение ПДД тут', photoUploadIds: [] }).expect(400);
    await submit(reporter, vehicleId, { occurredAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(400);
    // a photo can back only one violation
    const used = await uploadRow(t, reporter.id, 'violation');
    await postAs(reporter, `/vehicles/${vehicleId}/violations`, { category: 'parking', codeType: 'koap', occurredAt: hourAgo(), description: 'Парковка на тротуаре', photoUploadIds: [used] }).expect(201);
    expect((await postAs(reporter, `/vehicles/${vehicleId}/violations`, { category: 'parking', codeType: 'koap', occurredAt: hourAgo(), description: 'Парковка на тротуаре', photoUploadIds: [used] }).expect(400)).body.error.code).toBe('INVALID_UPLOAD');

    for (let i = 0; i < 4; i++) await submit(reporter, vehicleId).expect(201);
    expect((await submit(reporter, vehicleId).expect(429)).body.error.code).toBe('RATE_LIMITED');
  });
});

describe('visibility and disputes', () => {
  it('the public sees approved only; the owner also pending and disputed; the submitter sees their own', async () => {
    const { owner, vehicleId, reporter } = await setup();
    const adm = await admin(t);
    const stranger = await seasoned(t);
    const a = (await submit(reporter, vehicleId).expect(201)).body as ViolationDto;
    const b = (await submit(reporter, vehicleId, { category: 'red_light' }).expect(201)).body as ViolationDto;
    const c = (await submit(reporter, vehicleId, { category: 'parking' }).expect(201)).body as ViolationDto;
    await postAs(adm, `/admin/violations/${a.id}/approve`, { note: 'Видно на фото' }).expect(200);
    await postAs(adm, `/admin/violations/${c.id}/reject`, { note: 'Не видно номера' }).expect(200);

    const pub = (await get(stranger, `/vehicles/${vehicleId}/violations`).expect(200)).body as Paginated<ViolationDto>;
    expect(pub.items.map((v) => v.id)).toEqual([a.id]);
    expect(pub.items[0]).toMatchObject({ status: 'approved', submittedByMe: false, canDispute: false, dispute: null });
    expect(((await get(stranger, `/users/${owner.id}/violations`).expect(200)).body as Paginated<ViolationDto>).items.map((v) => v.id)).toEqual([a.id]);

    const mine = (await get(owner, `/vehicles/${vehicleId}/violations`).expect(200)).body as Paginated<ViolationDto>;
    expect(mine.items.map((v) => v.id).sort()).toEqual([a.id, b.id].sort());
    expect(mine.items.find((v) => v.id === b.id)).toMatchObject({ status: 'pending', canDispute: true });

    const submitted = (await get(reporter, '/me/violations/submitted').expect(200)).body as Paginated<ViolationDto>;
    expect(submitted.items.map((v) => v.status).sort()).toEqual(['approved', 'pending', 'rejected']);

    const detail = (await get(stranger, `/vehicles/${vehicleId}`).expect(200)).body as VehicleDetailDto;
    expect(detail).toMatchObject({ id: vehicleId, plate: null, owner: { id: owner.id }, approvedViolations: 1 });
    expect(detail).not.toHaveProperty('vin');
    for (const body of [pub, mine, submitted]) expect(JSON.stringify(body)).not.toContain(reporter.id);
  });

  it('only the owner disputes, once; a dispute moves pending/approved to disputed', async () => {
    const { owner, vehicleId, reporter } = await setup();
    const stranger = await seasoned(t);
    const v = (await submit(reporter, vehicleId).expect(201)).body as ViolationDto;
    await postAs(stranger, `/violations/${v.id}/dispute`, { text: 'Это не моя машина вообще' }).expect(404);
    await postAs(reporter, `/violations/${v.id}/dispute`, { text: 'Это не моя машина вообще' }).expect(403);
    await postAs(owner, `/violations/${v.id}/dispute`, { text: 'нет' }).expect(400);
    const d = (await postAs(owner, `/violations/${v.id}/dispute`, { text: 'Машина была на ремонте в тот день' }).expect(200)).body as ViolationDto;
    expect(d).toMatchObject({ status: 'disputed', canDispute: false, dispute: { text: 'Машина была на ремонте в тот день' } });
    expect((await postAs(owner, `/violations/${v.id}/dispute`, { text: 'Ещё раз спорю с этим' }).expect(409)).body.error.code).toBe('ALREADY_DISPUTED');
    // the submitter never sees the owner's dispute text
    const seen = ((await get(reporter, '/me/violations/submitted')).body as Paginated<ViolationDto>).items.find((x) => x.id === v.id)!;
    expect(seen).toMatchObject({ status: 'disputed', dispute: null });
  });
});

describe('admin moderation and rating', () => {
  it('approve → −5 through the ledger; remove after a dispute reverses it; all audited and notified', async () => {
    const { owner, vehicleId, reporter } = await setup();
    const adm = await admin(t);
    const v = (await submit(reporter, vehicleId).expect(201)).body as ViolationDto;
    await postAs(owner, `/admin/violations`).expect(404);
    await get(owner, '/admin/violations').expect(403);

    const queue = (await get(adm, '/admin/violations?status=pending').expect(200)).body as Paginated<AdminViolationDto>;
    expect(queue.items.find((x) => x.id === v.id)).toMatchObject({ owner: { id: owner.id }, submitter: { id: reporter.id }, penaltyApplied: false, submitterRejectedCount: 0 });

    const approved = (await postAs(adm, `/admin/violations/${v.id}/approve`, { note: 'Подтверждено видео' }).expect(200)).body as AdminViolationDto;
    expect(approved).toMatchObject({ status: 'approved', penaltyApplied: true, decisionNote: 'Подтверждено видео' });
    expect(((await get(owner, '/me/rating')).body as RatingDto)).toMatchObject({ rating: 45, breakdown: { penalties: -5 } });
    expect((await postAs(adm, `/admin/violations/${v.id}/approve`, { note: 'Ещё раз' }).expect(409)).body.error.code).toBe('VIOLATION_INVALID_STATE');

    await postAs(owner, `/violations/${v.id}/dispute`, { text: 'Это была не моя машина' }).expect(200);
    const removed = (await postAs(adm, `/admin/violations/${v.id}/resolve-dispute`, { decision: 'remove', note: 'Номер не читается' }).expect(200)).body as AdminViolationDto;
    expect(removed).toMatchObject({ status: 'removed', penaltyApplied: false });
    expect(((await get(owner, '/me/rating')).body as RatingDto)).toMatchObject({ rating: 50, breakdown: { penalties: 0 } });
    expect(await t.prisma.ratingEvent.findFirst({ where: { userId: owner.id, reason: 'penalty_reversed', refId: v.id } })).not.toBeNull();
    expect(await ledgerMatches(owner.id)).toBe(true);
    expect(((await get(reporter, `/vehicles/${vehicleId}/violations`)).body as Paginated<ViolationDto>).items).toHaveLength(0);

    const actions = await t.prisma.adminAction.findMany({ where: { targetId: v.id }, orderBy: { createdAt: 'asc' } });
    expect(actions.map((a) => [a.action, a.targetType, a.targetUserId])).toEqual([
      ['violation.approve', 'violation', owner.id],
      ['violation.remove', 'violation', owner.id],
    ]);
    const ownerNotes = await t.prisma.notification.findMany({ where: { userId: owner.id, type: 'violation_status' }, orderBy: { createdAt: 'asc' } });
    expect(ownerNotes.map((n) => (n.payload as { status: string }).status)).toEqual(['approved', 'removed']);
    const subNotes = await t.prisma.notification.findMany({ where: { userId: reporter.id, type: 'violation_status' } });
    expect(subNotes.map((n) => n.payload)).toEqual([{ violationId: v.id, vehicleId, category: 'speeding', status: 'approved', role: 'submitter' }]);
  });

  it('uphold of a disputed pending violation applies the penalty once; violations cap at −20', async () => {
    const { owner, vehicleId } = await setup();
    const adm = await admin(t);
    const reporters = await Promise.all(Array.from({ length: 2 }, () => seasoned(t)));
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(((await submit(reporters[i % 2]!, vehicleId).expect(201)).body as ViolationDto).id);
    await postAs(owner, `/violations/${ids[0]}/dispute`, { text: 'Оспариваю это нарушение' }).expect(200);
    expect((await postAs(adm, `/admin/violations/${ids[0]}/approve`, { note: 'Нельзя' }).expect(409)).body.error.code).toBe('VIOLATION_INVALID_STATE');
    expect(((await postAs(adm, `/admin/violations/${ids[0]}/resolve-dispute`, { decision: 'uphold', note: 'Факт подтверждён' }).expect(200)).body as AdminViolationDto)).toMatchObject({ status: 'approved', penaltyApplied: true });
    for (const id of ids.slice(1)) await postAs(adm, `/admin/violations/${id}/approve`, { note: 'Подтверждено' }).expect(200);
    const r = (await get(owner, '/me/rating')).body as RatingDto;
    expect(r.breakdown.penalties).toBe(-20);
    expect(r.rating).toBe(30);
    expect(await t.prisma.ratingEvent.count({ where: { userId: owner.id, reason: 'penalty', penaltyKind: 'violation' } })).toBe(6);
    expect(await ledgerMatches(owner.id)).toBe(true);
  });

  it('violation penalties expire after 365 days', async () => {
    const { owner, vehicleId, reporter } = await setup();
    const adm = await admin(t);
    const v = (await submit(reporter, vehicleId).expect(201)).body as ViolationDto;
    await postAs(adm, `/admin/violations/${v.id}/approve`, { note: 'Подтверждено' }).expect(200);
    await t.prisma.ratingEvent.updateMany({ where: { userId: owner.id, refId: v.id }, data: { createdAt: new Date(Date.now() - 366 * 24 * 3600 * 1000) } });
    expect(((await get(owner, '/me/rating')).body as RatingDto).breakdown.penalties).toBe(0);
  });

  it('admins cannot moderate their own submissions; admins’ vehicles refuse submissions (403 INVALID_TARGET)', async () => {
    const adm = await admin(t);
    const other = await admin(t);
    const { vehicleId } = await setup();
    await t.prisma.user.update({ where: { id: adm.id }, data: { createdAt: new Date(Date.now() - 30 * 86_400_000), rating: 60 } });
    const own = (await submit(adm, vehicleId).expect(201)).body as ViolationDto;
    expect((await postAs(adm, `/admin/violations/${own.id}/approve`, { note: 'Моё' }).expect(403)).body.error.code).toBe('INVALID_TARGET');
    const reporter = await seasoned(t);
    const adminCar = await vehicleOf(t, other.id);
    expect((await submit(reporter, adminCar).expect(403)).body.error.code).toBe('INVALID_TARGET');
    expect((await submit(other, adminCar).expect(403)).body.error.code).toBe('INVALID_TARGET');
    expect(await t.prisma.violation.count({ where: { vehicleId: adminCar } })).toBe(0);
  });

  it('a submitter rejected 3 times → violation_rejections flag', async () => {
    const { vehicleId, reporter } = await setup();
    const adm = await admin(t);
    for (let i = 0; i < 4; i++) {
      const v = (await submit(reporter, vehicleId).expect(201)).body as ViolationDto;
      await postAs(adm, `/admin/violations/${v.id}/reject`, { note: 'Нет доказательств' }).expect(200);
      await drain();
      expect(await t.prisma.fraudFlag.count({ where: { userId: reporter.id, kind: 'violation_rejections' } })).toBe(i >= 2 ? 1 : 0);
    }
    const n = await t.prisma.notification.findMany({ where: { userId: reporter.id, type: 'violation_status' } });
    expect(n.every((x) => (x.payload as { status: string; role: string }).status === 'rejected')).toBe(true);
  });
});

describe('vehicle details', () => {
  it('stores the details; the VIN is owner-only; photos are ordered, replaceable and purpose-checked', async () => {
    const owner = await seasoned(t);
    const friend = await seasoned(t);
    const stranger = await seasoned(t);
    await makeFriends(t, owner.id, friend.id);
    const p1 = await uploadRow(t, owner.id, 'vehicle');
    const p2 = await uploadRow(t, owner.id, 'vehicle');
    const created = (await postAs(owner, '/me/vehicles', {
      brand: 'Toyota',
      model: 'Land Cruiser',
      year: 2021,
      plate: '001aaa02',
      vin: 'jtmhv05j604123456',
      engineVolumeL: 3.46,
      fuel: 'petrol',
      transmission: 'automatic',
      drive: 'awd',
      bodyType: 'suv',
      color: 'white',
      mileageKm: 54000,
      description: 'Полная комплектация',
      photoUploadIds: [p2, p1],
    }).expect(201)).body as OwnVehicleDto;
    expect(created).toMatchObject({ vin: 'JTMHV05J604123456', engineVolumeL: 3.5, fuel: 'petrol', transmission: 'automatic', drive: 'awd', bodyType: 'suv', color: 'white', mileageKm: 54000, description: 'Полная комплектация', plate: '001AAA02' });
    expect(created.photos.map((p) => p.id)).toEqual([p2, p1]);

    expect(((await get(owner, '/me/vehicles')).body as OwnVehicleDto[])[0]!.vin).toBe('JTMHV05J604123456');
    for (const viewer of [friend, stranger]) {
      const list = (await get(viewer, `/users/${owner.id}/vehicles`).expect(200)).body as VehicleDto[];
      expect(list[0]).not.toHaveProperty('vin');
      expect(list[0]!.photos).toHaveLength(2);
      const prof = (await get(viewer, `/users/${owner.id}`).expect(200)).body as UserPublic;
      expect(prof.primaryVehicle).not.toHaveProperty('vin');
      expect(prof.primaryVehicle!.photos.map((p) => p.id)).toEqual([p2]); // embedded: the cover only
      expect(JSON.stringify(await get(viewer, `/vehicles/${created.id}`).then((r) => r.body))).not.toContain('JTMHV05J604123456');
    }
    expect(((await get(friend, `/vehicles/${created.id}`)).body as VehicleDetailDto).plate).toBe('001AAA02');
    expect(((await get(stranger, `/vehicles/${created.id}`)).body as VehicleDetailDto).plate).toBeNull();

    for (const bad of [{ vin: 'JTMHV05J60412345O' }, { vin: 'SHORT' }, { engineVolumeL: 9 }, { fuel: 'coal' }, { color: 'pink' }, { mileageKm: -5 }, { description: 'x'.repeat(501) }]) {
      await patchAs(owner, `/me/vehicles/${created.id}`, bad).expect(400);
    }
    expect((await patchAs(owner, `/me/vehicles/${created.id}`, { photoUploadIds: [await uploadRow(t, owner.id, 'post')] }).expect(400)).body.error.code).toBe('INVALID_UPLOAD');
    expect((await patchAs(owner, `/me/vehicles/${created.id}`, { photoUploadIds: [await uploadRow(t, stranger.id, 'vehicle')] }).expect(400)).body.error.code).toBe('INVALID_UPLOAD');

    const p3 = await uploadRow(t, owner.id, 'vehicle');
    const updated = (await patchAs(owner, `/me/vehicles/${created.id}`, { photoUploadIds: [p3], fuel: null, color: 'black' }).expect(200)).body as OwnVehicleDto;
    expect(updated.photos.map((p) => p.id)).toEqual([p3]);
    expect(updated).toMatchObject({ fuel: null, color: 'black', vin: 'JTMHV05J604123456' });
    expect(await t.prisma.upload.count({ where: { id: { in: [p1, p2] } } })).toBe(0); // replaced photos are deleted

    // another vehicle can't reuse a photo
    const second = (await postAs(owner, '/me/vehicles', { brand: 'Kia', model: 'Rio', year: 2019 }).expect(201)).body as OwnVehicleDto;
    expect((await patchAs(owner, `/me/vehicles/${second.id}`, { photoUploadIds: [p3] }).expect(400)).body.error.code).toBe('INVALID_UPLOAD');
    // the orphan purge keeps attached vehicle photos
    await t.prisma.upload.updateMany({ where: { id: p3 }, data: { createdAt: new Date(Date.now() - 48 * 3600 * 1000) } });
    await t.app.get(UploadsCleanupService).purge();
    expect(await t.prisma.upload.count({ where: { id: p3 } })).toBe(1);
    await request(t.http).delete(`/api/v1/me/vehicles/${created.id}`).set(bearer(owner.token)).expect(204);
    expect(await t.prisma.upload.count({ where: { id: p3 } })).toBe(0);
  });
});
