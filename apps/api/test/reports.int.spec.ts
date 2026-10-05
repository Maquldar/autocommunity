import { REPORT_LIMITS, type ReportDto, type SosDto } from '@autoc/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../src/common/ids';
import { bearer, createCommunity, createTestApp, createUser, setLocation, type TestApp } from './support/app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ SOS_EXPAND_DELAY_MS: '3600000' });
});
afterAll(async () => {
  await t.close();
});

type U = { id: string; token: string };
const report = (u: U, body: object) => request(t.http).post('/api/v1/reports').set(bearer(u.token)).send(body);
const target = (targetType: string, targetId: string, reason = 'spam', details?: string) => ({ targetType, targetId, reason, ...(details ? { details } : {}) });

async function service(status: 'verified' | 'pending', submittedById: string | null): Promise<string> {
  const id = newId();
  await t.prisma.$executeRaw`
    INSERT INTO service_centers (id, name, category, address, location, status, qr_secret, submitted_by_id, updated_at)
    VALUES (${id}::uuid, 'Шиномонтаж «Тест»', 'tires', 'ул. Абая 1', ST_SetSRID(ST_MakePoint(76.9, 43.24), 4326)::geography,
            ${status}::"ServiceStatus", 'secret', ${submittedById}::uuid, now())`;
  return id;
}

describe('POST /reports per target type', () => {
  it('user: resolves the user, rejects self, deleted and unknown users', async () => {
    const me = await createUser(t);
    const other = await createUser(t);
    const res = (await report(me, target('user', other.id, 'harassment', '  оскорбления в чате  ')).expect(201)).body as ReportDto;
    expect(res).toMatchObject({ targetType: 'user', targetId: other.id, reason: 'harassment', details: 'оскорбления в чате', status: 'open', resolutionNote: null, resolvedAt: null });
    expect((await t.prisma.report.findUniqueOrThrow({ where: { id: res.id } })).targetUserId).toBe(other.id);
    expect((await report(me, target('user', me.id)).expect(400)).body.error.code).toBe('INVALID_TARGET');
    await report(me, target('user', (await createUser(t, { status: 'deleted' })).id)).expect(404);
    await report(me, target('user', (await createUser(t, { onboarded: false })).id)).expect(404);
    await report(me, target('user', newId())).expect(404);
    // Blocked users stay reportable (they're visible with status "blocked").
    await report(me, target('user', (await createUser(t, { status: 'blocked' })).id)).expect(201);
  });

  it('message: only chat members; resolves the sender; own messages rejected', async () => {
    const me = await createUser(t);
    const other = await createUser(t);
    const outsider = await createUser(t);
    const chat = (await request(t.http).post('/api/v1/chats/direct').set(bearer(me.token)).send({ userId: other.id }).expect(200)).body;
    const theirs = (await request(t.http).post(`/api/v1/chats/${chat.id}/messages`).set(bearer(other.token)).send({ type: 'text', text: 'спам' }).expect(201)).body;
    const mine = (await request(t.http).post(`/api/v1/chats/${chat.id}/messages`).set(bearer(me.token)).send({ type: 'text', text: 'мой' }).expect(201)).body;
    const r = (await report(me, target('message', theirs.id)).expect(201)).body as ReportDto;
    expect((await t.prisma.report.findUniqueOrThrow({ where: { id: r.id } })).targetUserId).toBe(other.id);
    expect((await report(me, target('message', mine.id)).expect(400)).body.error.code).toBe('INVALID_TARGET');
    await report(outsider, target('message', theirs.id)).expect(404);
    await report(me, target('message', newId())).expect(404);
  });

  it('sos: visible SOS only; fake_sos only for SOS; own SOS rejected', async () => {
    const requester = await createUser(t);
    const near = await createUser(t);
    const far = await createUser(t);
    await setLocation(t, near.id, 10.01, 10, 0);
    await setLocation(t, far.id, 12, 12, 0);
    const sos = (await request(t.http).post('/api/v1/sos').set(bearer(requester.token)).send({ type: 'other', lat: 10, lng: 10, sharePhone: false }).expect(201)).body as SosDto;
    const r = (await report(near, target('sos', sos.id, 'fake_sos')).expect(201)).body as ReportDto;
    expect((await t.prisma.report.findUniqueOrThrow({ where: { id: r.id } })).targetUserId).toBe(requester.id);
    await report(far, target('sos', sos.id)).expect(404);
    expect((await report(requester, target('sos', sos.id)).expect(400)).body.error.code).toBe('INVALID_TARGET');
    const wrong = await report(near, target('user', requester.id, 'fake_sos')).expect(400);
    expect(wrong.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('community: live communities, resolves the owner; the owner can\'t report their own', async () => {
    const owner = await createUser(t);
    const me = await createUser(t);
    const id = await createCommunity(t, owner.id, [], { isPrivate: true });
    const r = (await report(me, target('community', id, 'inappropriate')).expect(201)).body as ReportDto;
    expect((await t.prisma.report.findUniqueOrThrow({ where: { id: r.id } })).targetUserId).toBe(owner.id);
    expect((await report(owner, target('community', id)).expect(400)).body.error.code).toBe('INVALID_TARGET');
    await report(me, target('community', await createCommunity(t, owner.id, [], { deleted: true }))).expect(404);
  });

  it('service: verified ones, or pending ones by their submitter; resolves the submitter', async () => {
    const submitter = await createUser(t);
    const me = await createUser(t);
    const verified = await service('verified', submitter.id);
    const pending = await service('pending', submitter.id);
    const orphan = await service('verified', null);
    const r = (await report(me, target('service', verified, 'fraud')).expect(201)).body as ReportDto;
    expect((await t.prisma.report.findUniqueOrThrow({ where: { id: r.id } })).targetUserId).toBe(submitter.id);
    await report(me, target('service', pending)).expect(404);
    expect((await report(submitter, target('service', pending)).expect(400)).body.error.code).toBe('INVALID_TARGET');
    const o = (await report(me, target('service', orphan)).expect(201)).body as ReportDto;
    expect((await t.prisma.report.findUniqueOrThrow({ where: { id: o.id } })).targetUserId).toBeNull();
  });

  it('post / comment are not reportable yet; validation', async () => {
    const me = await createUser(t);
    for (const type of ['post', 'comment']) expect((await report(me, target(type, newId())).expect(400)).body.error.code).toBe('INVALID_TARGET');
    for (const body of [
      target('video', newId()),
      target('user', 'nope'),
      target('user', newId(), 'rude'),
      { ...target('user', newId()), details: 'x'.repeat(501) },
      { targetType: 'user', reason: 'spam' },
    ]) {
      expect((await report(me, body).expect(400)).body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('report limits and /me/reports', () => {
  it('one open report per target, 10 per day, and lists only my reports with status', async () => {
    const me = await createUser(t);
    const other = await createUser(t);
    const first = (await report(me, target('user', other.id)).expect(201)).body as ReportDto;
    expect((await report(me, target('user', other.id, 'fraud')).expect(409)).body.error.code).toBe('ALREADY_REPORTED');
    // Concurrent duplicates still produce one open report.
    const third = await createUser(t);
    const results = await Promise.all([1, 2, 3].map(() => report(me, target('user', third.id))));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    // After a resolution a new report is possible.
    await t.prisma.report.update({ where: { id: first.id }, data: { status: 'dismissed', resolvedNote: 'Нарушений не найдено', resolvedAt: new Date() } });
    await report(me, target('user', other.id)).expect(201);

    const mineBefore = await request(t.http).get('/api/v1/me/reports?limit=2').set(bearer(me.token)).expect(200);
    expect(mineBefore.body.items).toHaveLength(2);
    const all: ReportDto[] = [];
    let cursor: string | null = null;
    do {
      const res: request.Response = await request(t.http).get(`/api/v1/me/reports?limit=2${cursor ? `&cursor=${cursor}` : ''}`).set(bearer(me.token)).expect(200);
      all.push(...res.body.items);
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(all).toHaveLength(3);
    expect(all.find((r) => r.id === first.id)).toMatchObject({ status: 'dismissed', resolutionNote: 'Нарушений не найдено', resolvedAt: expect.any(String) });
    expect((await request(t.http).get('/api/v1/me/reports').set(bearer(other.token)).expect(200)).body.items).toEqual([]);

    // Daily limit: 3 used, 7 more allowed, the 11th → 429.
    for (let i = 0; i < REPORT_LIMITS.perDay - 3; i++) await report(me, target('user', (await createUser(t)).id)).expect(201);
    const limited = await report(me, target('user', (await createUser(t)).id)).expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.body.error.details.retryAfterSec).toBeGreaterThan(0);
    expect(await t.prisma.notification.count({ where: { userId: other.id } })).toBe(0); // nobody is notified
  });
});
