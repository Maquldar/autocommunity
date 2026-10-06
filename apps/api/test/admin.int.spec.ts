import type { AddressInfo } from 'node:net';
import type {
  AdminReportDto,
  AdminResolveResult,
  AdminServiceDto,
  AdminSosDetail,
  AdminStatsDto,
  AdminUserDetail,
  AdminUserRow,
  AdminVisitDto,
  Paginated,
  SosDto,
} from '@autoc/shared';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../src/common/ids';
import { BackgroundTasks } from '../src/infra/tasks/background-tasks';
import { currentQrCode } from '../src/modules/services/qr';
import { bearer, createCommunity, createTestApp, createUser, loginWithOtp, nextIp, readCookies, setLocation, type TestApp } from './support/app';
import { pngImage } from './support/images';

let t: TestApp;
let baseUrl: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  t = await createTestApp({ SOS_EXPAND_DELAY_MS: '3600000' });
  await t.app.listen(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${(t.app.getHttpServer().address() as AddressInfo).port}`;
});
afterEach(() => {
  for (const s of sockets.splice(0)) s.disconnect();
});
afterAll(async () => {
  await t.close();
});

type U = { id: string; token: string };
const NOTE = 'Нарушение правил сообщества';
const drain = () => t.app.get(BackgroundTasks).drain();

const as = (u: U) => ({
  get: (path: string) => request(t.http).get(`/api/v1${path}`).set(bearer(u.token)),
  post: (path: string, body: object = {}) => request(t.http).post(`/api/v1${path}`).set(bearer(u.token)).send(body),
  del: (path: string, body: object = {}) => request(t.http).delete(`/api/v1${path}`).set(bearer(u.token)).send(body),
});

const admin = () => createUser(t, { role: 'admin', nickname: `adm_${newId().slice(-8)}` });

/** Each test works ~1° away from the others so SOS visibility never crosses. */
let areaSeq = 0;
const area = () => {
  const lat = 20 + areaSeq * 1.0;
  const lng = 20 + areaSeq * 1.0;
  areaSeq++;
  return { lat, lng };
};

async function openSos(u: U, at = area()): Promise<string> {
  await setLocation(t, u.id, at.lat, at.lng, 1);
  const res = await as(u).post('/sos', { type: 'battery', description: 'Сел аккумулятор', lat: at.lat, lng: at.lng, sharePhone: false }).expect(201);
  return (res.body as SosDto).id;
}

async function service(status: 'verified' | 'pending' | 'rejected', submittedById: string | null, name = 'Автосервис «Тест»'): Promise<string> {
  const id = newId();
  await t.prisma.$executeRaw`
    INSERT INTO service_centers (id, name, category, address, location, status, qr_secret, submitted_by_id, updated_at)
    VALUES (${id}::uuid, ${name}, 'repair', 'ул. Абая 10', ST_SetSRID(ST_MakePoint(76.9, 43.24), 4326)::geography,
            ${status}::"ServiceStatus", 'secret-qr', ${submittedById}::uuid, now())`;
  return id;
}

const notificationsOf = (userId: string, type: string) =>
  t.prisma.notification.findMany({ where: { userId, type }, orderBy: { createdAt: 'asc' } });

const auditOf = (targetId: string) => t.prisma.adminAction.findMany({ where: { targetId }, orderBy: { createdAt: 'asc' } });

function connect(token: string): Socket {
  const socket = io(`${baseUrl}/rt`, { path: '/socket.io', auth: { token }, transports: ['polling'], reconnection: false, forceNew: true });
  sockets.push(socket);
  return socket;
}

const once = <T = unknown>(socket: Socket, event: string, timeoutMs = 5_000) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

/* ------------------------------------------------------------------ authorization */

describe('authorization', () => {
  const id = '0192a6c5-1234-7abc-8def-0123456789ab';
  const routes: [method: 'get' | 'post' | 'delete', path: string][] = [
    ['get', '/admin/stats'],
    ['get', '/admin/users'],
    ['get', `/admin/users/${id}`],
    ['post', `/admin/users/${id}/warn`],
    ['post', `/admin/users/${id}/block`],
    ['post', `/admin/users/${id}/unblock`],
    ['post', `/admin/users/${id}/sos-ban`],
    ['post', `/admin/users/${id}/sos-unban`],
    ['get', '/admin/communities'],
    ['delete', `/admin/communities/${id}`],
    ['get', '/admin/sos'],
    ['get', `/admin/sos/${id}`],
    ['post', `/admin/sos/${id}/mark-fake`],
    ['get', '/admin/reports'],
    ['post', `/admin/reports/${id}/resolve`],
    ['get', '/admin/fraud-flags'],
    ['get', '/admin/audit'],
    ['get', '/admin/services'],
    ['get', `/admin/services/${id}`],
    ['post', `/admin/services/${id}/verify`],
    ['post', `/admin/services/${id}/reject`],
    ['get', `/admin/services/${id}/qr`],
    ['get', '/admin/visits'],
    ['post', `/admin/visits/${id}/approve`],
    ['post', `/admin/visits/${id}/reject`],
  ];

  it('every admin route answers 403 FORBIDDEN to a regular user and 401 without a token', async () => {
    const user = await createUser(t);
    for (const [method, path] of routes) {
      const res = await request(t.http)[method](`/api/v1${path}`).set(bearer(user.token)).send({ note: NOTE });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.error.code, `${method} ${path}`).toBe('FORBIDDEN');
      expect((await request(t.http)[method](`/api/v1${path}`).send({ note: NOTE })).status, `${method} ${path} anonymous`).toBe(401);
    }
    // Nothing was written on the user's behalf.
    expect(await t.prisma.adminAction.count({ where: { adminId: user.id } })).toBe(0);
  });

  it('the admin role is read from the account state, not from the token claim', async () => {
    const user = await createUser(t);
    await t.prisma.user.update({ where: { id: user.id }, data: { role: 'admin' } });
    await t.redis.del(`user:state:${user.id}`);
    // The role comes from the cached account state, not from the token claim.
    await as(user).get('/admin/stats').expect(200);
  });

  it('rate-limits each admin to 300 requests per minute', async () => {
    const a = await admin();
    const other = await admin();
    // Fill the window directly (300 hits), then the next request is refused.
    const now = Date.now();
    const members = Array.from({ length: 300 }, (_, i) => [now, `seed-${i}`] as const).flat();
    await t.redis.zadd(`rl:admin:${a.id}`, ...members);
    await t.redis.pexpire(`rl:admin:${a.id}`, 60_000);
    const res = await as(a).get('/admin/stats').expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.headers['retry-after']).toBeDefined();
    // Per admin: another admin is unaffected.
    await as(other).get('/admin/stats').expect(200);
  });
});

/* ------------------------------------------------------------------ users */

describe('users', () => {
  it('lists with search by nickname, name and phone digits, a status filter and keyset pagination', async () => {
    const a = await admin();
    const tag = newId().slice(-6);
    const u1 = await createUser(t, { nickname: `find_${tag}_one`, name: 'Ерлан Нурланов', phone: `+7705${tag.replace(/\D/g, '1').padEnd(7, '1').slice(0, 7)}` });
    await createUser(t, { nickname: `find_${tag}_two` });
    const blocked = await createUser(t, { nickname: `find_${tag}_blk`, status: 'blocked' });
    await createUser(t, { nickname: `find_${tag}_exp`, status: 'blocked', blockedUntil: new Date(Date.now() - 60_000) });

    const all = (await as(a).get(`/admin/users?q=find_${tag}`).expect(200)).body as Paginated<AdminUserRow>;
    expect(all.items).toHaveLength(4);
    const page1 = (await as(a).get(`/admin/users?q=find_${tag}&limit=3`).expect(200)).body as Paginated<AdminUserRow>;
    expect(page1.items).toHaveLength(3);
    const page2 = (await as(a).get(`/admin/users?q=find_${tag}&limit=3&cursor=${page1.nextCursor}`).expect(200)).body as Paginated<AdminUserRow>;
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    expect(new Set([...page1.items, ...page2.items].map((u) => u.id)).size).toBe(4);

    const onlyBlocked = (await as(a).get(`/admin/users?q=find_${tag}&status=blocked`).expect(200)).body as Paginated<AdminUserRow>;
    expect(onlyBlocked.items.map((u) => u.id)).toEqual([blocked.id]);
    // An expired temporary block reads as active.
    const active = (await as(a).get(`/admin/users?q=find_${tag}&status=active`).expect(200)).body as Paginated<AdminUserRow>;
    expect(active.items).toHaveLength(3);

    const byName = (await as(a).get(`/admin/users?q=${encodeURIComponent('нурлан')}`).expect(200)).body as Paginated<AdminUserRow>;
    expect(byName.items.map((u) => u.id)).toContain(u1.id);
    const phone = (await t.prisma.user.findUniqueOrThrow({ where: { id: u1.id } })).phone!;
    const byPhone = (await as(a).get(`/admin/users?q=${encodeURIComponent(phone.slice(-7))}`).expect(200)).body as Paginated<AdminUserRow>;
    expect(byPhone.items.map((u) => u.id)).toContain(u1.id);
    expect(byPhone.items.find((u) => u.id === u1.id)).toMatchObject({ phone, status: 'active', role: 'user', onboarded: true });
  });

  it('detail has counts, rating events, admin actions and fraud flags', async () => {
    const a = await admin();
    const u = await createUser(t);
    const reporter = await createUser(t);
    await as(reporter).post('/reports', { targetType: 'user', targetId: u.id, reason: 'spam' }).expect(201);
    await t.prisma.fraudFlag.create({ data: { id: newId(), userId: u.id, kind: 'new_account_sos', details: { sosId: newId() } } });
    await as(a).post(`/admin/users/${u.id}/warn`, { note: NOTE }).expect(200);
    const d = (await as(a).get(`/admin/users/${u.id}`).expect(200)).body as AdminUserDetail;
    expect(d.user).toMatchObject({ id: u.id, status: 'active', phoneVerified: true });
    expect(d.counts).toEqual({ sosCreated: 0, helps: 0, reportsAgainst: 1, reportsFiled: 0, warnings: 1 });
    expect(d.recentAdminActions).toHaveLength(1);
    expect(d.recentAdminActions[0]).toMatchObject({ action: 'user.warn', note: NOTE, admin: { id: a.id }, targetUser: { id: u.id } });
    expect(d.fraudFlags).toEqual([expect.objectContaining({ kind: 'new_account_sos', user: expect.objectContaining({ id: u.id }) })]);
    await as(a).get(`/admin/users/${newId()}`).expect(404);
  });

  it('warn: admin_warning notification with the note, audit row, warningsCount', async () => {
    const a = await admin();
    const u = await createUser(t);
    await as(a).post(`/admin/users/${u.id}/warn`, { note: '  Не спамьте в чатах  ' }).expect(200);
    const [n] = await notificationsOf(u.id, 'admin_warning');
    expect(n!.payload).toEqual({ kind: 'warning', note: 'Не спамьте в чатах', until: null, automatic: false });
    expect(await auditOf(u.id)).toEqual([
      expect.objectContaining({ adminId: a.id, action: 'user.warn', targetType: 'user', targetUserId: u.id, note: 'Не спамьте в чатах' }),
    ]);
    expect((await as(u).get('/me').expect(200)).body.warningsCount).toBe(1);
  });

  it('validates the note (3–500 chars) and the block/ban dates', async () => {
    const a = await admin();
    const u = await createUser(t);
    for (const note of [undefined, '', '  a ', 'x'.repeat(501)]) {
      expect((await as(a).post(`/admin/users/${u.id}/warn`, { note }).expect(400)).body.error.code).toBe('VALIDATION_ERROR');
    }
    const past = new Date(Date.now() - 60_000).toISOString();
    await as(a).post(`/admin/users/${u.id}/block`, { note: NOTE, until: past }).expect(400);
    await as(a).post(`/admin/users/${u.id}/sos-ban`, { note: NOTE }).expect(400);
    await as(a).post(`/admin/users/${u.id}/sos-ban`, { note: NOTE, until: past }).expect(400);
    await as(a).post(`/admin/users/not-a-uuid/warn`, { note: NOTE }).expect(400);
    expect(await t.prisma.adminAction.count({ where: { targetUserId: u.id } })).toBe(0);
  });

  it('admins cannot act on themselves or on other admins (403 INVALID_TARGET)', async () => {
    const a = await admin();
    const b = await admin();
    for (const target of [a.id, b.id]) {
      for (const [path, body] of [
        ['warn', { note: NOTE }],
        ['block', { note: NOTE }],
        ['unblock', { note: NOTE }],
        ['sos-ban', { note: NOTE, until: new Date(Date.now() + 3_600_000).toISOString() }],
        ['sos-unban', { note: NOTE }],
      ] as const) {
        const res = await as(a).post(`/admin/users/${target}/${path}`, body).expect(403);
        expect(res.body.error.code).toBe('INVALID_TARGET');
      }
    }
    expect(await t.prisma.adminAction.count({ where: { adminId: a.id } })).toBe(0);
    expect((await t.prisma.user.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('active');
  });

  it('block: sessions revoked, sockets disconnected, open SOS cancelled, helpers and user notified', async () => {
    const a = await admin();
    const login = await loginWithOtp(t);
    const u: U = { id: login.user.id, token: login.accessToken };
    await t.prisma.user.update({ where: { id: u.id }, data: { name: 'Блок Тестов', nickname: `blk_${newId().slice(-8)}`, onboardedAt: new Date() } });
    const at = area();
    const sosId = await openSos(u, at);
    const helper = await createUser(t);
    await setLocation(t, helper.id, at.lat + 0.01, at.lng, 1);
    await as(helper).post(`/sos/${sosId}/respond`).expect(200);

    const socket = connect(u.token);
    await once(socket, 'connect');
    const revoked = once(socket, 'session:revoked');
    const disconnected = once(socket, 'disconnect');

    const res = await as(a).post(`/admin/users/${u.id}/block`, { note: NOTE }).expect(200);
    expect((res.body as AdminUserDetail).user).toMatchObject({ status: 'blocked', blockedUntil: null });

    expect(await revoked).toEqual({});
    await disconnected;
    // Refresh tokens revoked; the old access token no longer works.
    expect(await t.prisma.refreshToken.count({ where: { userId: u.id, revokedAt: null } })).toBe(0);
    await as(u).get('/me').expect(401);
    const refresh = await request(t.http)
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`ac_rt=${login.refreshToken}`, `ac_csrf=${login.csrfToken}`])
      .set('X-CSRF-Token', login.csrfToken)
      .set('X-Forwarded-For', nextIp());
    expect(refresh.status).toBeGreaterThanOrEqual(401);
    expect(readCookies(refresh).ac_rt ?? '').toBe('');

    const sos = await t.prisma.sosRequest.findUniqueOrThrow({ where: { id: sosId } });
    expect(sos.status).toBe('cancelled');
    expect(sos.cancelReason).toBe('system:admin_blocked');
    await drain();
    expect((await notificationsOf(helper.id, 'sos_status')).map((n) => n.payload)).toContainEqual({ sosId, status: 'cancelled' });
    expect((await notificationsOf(u.id, 'admin_warning')).map((n) => n.payload)).toEqual([{ kind: 'blocked', note: NOTE, until: null, automatic: false }]);
    expect(await auditOf(u.id)).toEqual([expect.objectContaining({ action: 'user.block', note: NOTE })]);
    // A system cancellation is not the user's own: no antifraud streak flag.
    expect(await t.prisma.fraudFlag.count({ where: { userId: u.id, kind: 'sos_cancel_streak' } })).toBe(0);

    // A new login is refused while blocked.
    await t.redis.del(`rl:otp:phone:cooldown:${login.phone}`);
    const otp = await request(t.http).post('/api/v1/auth/otp/request').set('X-Forwarded-For', nextIp()).send({ phone: login.phone }).expect(200);
    const verify = await request(t.http).post('/api/v1/auth/otp/verify').set('X-Forwarded-For', nextIp()).send({ phone: login.phone, code: otp.body.devCode });
    expect(verify.status).toBe(403);
    expect(verify.body.error.code).toBe('ACCOUNT_BLOCKED');

    // Unblock: back to active, audit row, can sign in again.
    const unblocked = (await as(a).post(`/admin/users/${u.id}/unblock`, { note: 'Разблокирован по апелляции' }).expect(200)).body as AdminUserDetail;
    expect(unblocked.user).toMatchObject({ status: 'active', blockedUntil: null });
    expect((await auditOf(u.id)).map((r) => r.action)).toEqual(['user.block', 'user.unblock']);
    await t.redis.del(`rl:otp:phone:cooldown:${login.phone}`);
    const again = await loginWithOtp(t, login.phone);
    await as({ id: u.id, token: again.accessToken }).get('/me').expect(200);
    expect((await as(a).post(`/admin/users/${u.id}/unblock`, { note: NOTE }).expect(409)).body.error.code).toBe('NOT_BLOCKED');
  });

  it('a temporary block ends at `until`', async () => {
    const a = await admin();
    const u = await createUser(t);
    const until = new Date(Date.now() + 3_600_000);
    const d = (await as(a).post(`/admin/users/${u.id}/block`, { note: NOTE, until: until.toISOString() }).expect(200)).body as AdminUserDetail;
    expect(d.user).toMatchObject({ status: 'blocked', blockedUntil: until.toISOString() });
    expect((await notificationsOf(u.id, 'admin_warning'))[0]!.payload).toMatchObject({ kind: 'blocked', until: until.toISOString() });
    await t.prisma.user.update({ where: { id: u.id }, data: { blockedUntil: new Date(Date.now() - 1000) } });
    expect(((await as(a).get(`/admin/users/${u.id}`).expect(200)).body as AdminUserDetail).user.status).toBe('active');
  });

  it('sos-ban sets sosBannedUntil (SOS creation refused), sos-unban clears it', async () => {
    const a = await admin();
    const u = await createUser(t);
    const until = new Date(Date.now() + 2 * 3_600_000);
    await as(a).post(`/admin/users/${u.id}/sos-ban`, { note: NOTE, until: until.toISOString() }).expect(200);
    expect((await t.prisma.user.findUniqueOrThrow({ where: { id: u.id } })).sosBannedUntil?.toISOString()).toBe(until.toISOString());
    const at = area();
    const refused = await as(u).post('/sos', { type: 'fuel', description: '', lat: at.lat, lng: at.lng, sharePhone: false }).expect(403);
    expect(refused.body.error.code).toBe('SOS_BANNED');
    expect((await notificationsOf(u.id, 'admin_warning'))[0]!.payload).toEqual({ kind: 'sos_ban', note: NOTE, until: until.toISOString(), automatic: false });

    await as(a).post(`/admin/users/${u.id}/sos-unban`, { note: NOTE }).expect(200);
    expect((await t.prisma.user.findUniqueOrThrow({ where: { id: u.id } })).sosBannedUntil).toBeNull();
    await openSos(u, at);
    expect((await auditOf(u.id)).map((r) => r.action)).toEqual(['user.sos_ban', 'user.sos_unban']);
    expect((await as(a).post(`/admin/users/${u.id}/sos-unban`, { note: NOTE }).expect(409)).body.error.code).toBe('NOT_SOS_BANNED');
  });
});

/* ------------------------------------------------------------------ SOS */

describe('SOS', () => {
  it('lists with a status filter and shows full detail', async () => {
    const a = await admin();
    const u = await createUser(t);
    const at = area();
    const sosId = await openSos(u, at);
    const list = (await as(a).get('/admin/sos?status=created&limit=50').expect(200)).body as Paginated<{ id: string; status: string }>;
    expect(list.items.map((s) => s.id)).toContain(sosId);
    expect(list.items.every((s) => s.status === 'created')).toBe(true);
    const d = (await as(a).get(`/admin/sos/${sosId}`).expect(200)).body as AdminSosDetail;
    expect(d).toMatchObject({ id: sosId, status: 'created', isFake: false, requester: { id: u.id }, responses: [], chatId: null, reports: [] });
    expect(d.lat).toBeCloseTo(at.lat, 5);
    await as(a).get(`/admin/sos/${newId()}`).expect(404);
  });

  it('mark-fake: cancelled, isFake, −50 penalty in the ledger, requester notified, audit; twice → 409', async () => {
    const a = await admin();
    const u = await createUser(t);
    const sosId = await openSos(u);
    expect((await t.prisma.user.findUniqueOrThrow({ where: { id: u.id } })).rating).toBe(50);

    const d = (await as(a).post(`/admin/sos/${sosId}/mark-fake`, { note: 'Ложный вызов' }).expect(200)).body as AdminSosDetail;
    expect(d).toMatchObject({ isFake: true, status: 'cancelled', cancelReason: 'system:fake' });
    const penalty = await t.prisma.ratingEvent.findFirstOrThrow({ where: { userId: u.id, reason: 'penalty' } });
    expect(penalty).toMatchObject({ delta: -50, penaltyPoints: -50, penaltyKind: 'fake_sos', refId: sosId });
    expect((await t.prisma.user.findUniqueOrThrow({ where: { id: u.id } })).rating).toBe(0);
    expect((await notificationsOf(u.id, 'admin_warning')).map((n) => n.payload)).toEqual([
      { kind: 'fake_sos', note: 'Ложный вызов', until: null, automatic: false, sosId },
    ]);
    expect(await auditOf(sosId)).toEqual([expect.objectContaining({ action: 'sos.mark_fake', targetType: 'sos', targetUserId: u.id })]);
    expect((await as(a).post(`/admin/sos/${sosId}/mark-fake`, { note: NOTE }).expect(409)).body.error.code).toBe('SOS_ALREADY_FAKE');
    expect(await t.prisma.ratingEvent.count({ where: { userId: u.id, reason: 'penalty' } })).toBe(1);
  });

  it('mark-fake on an SOS of another admin → 403 INVALID_TARGET', async () => {
    const a = await admin();
    const b = await admin();
    const sosId = await openSos(b);
    expect((await as(a).post(`/admin/sos/${sosId}/mark-fake`, { note: NOTE }).expect(403)).body.error.code).toBe('INVALID_TARGET');
  });
});

/* ------------------------------------------------------------------ reports */

describe('reports', () => {
  async function messageReported(reporters: number) {
    const author = await createUser(t, { name: 'Автор Сообщения' });
    const members = await Promise.all(Array.from({ length: reporters }, () => createUser(t)));
    const communityId = await createCommunity(t, author.id, members.map((m) => ({ userId: m.id })));
    const chat = await t.prisma.chat.findUniqueOrThrow({ where: { refId: communityId } });
    const msg = (await as(author).post(`/chats/${chat.id}/messages`, { type: 'text', text: 'Продам права, недорого' }).expect(201)).body as { id: string };
    const reportIds: string[] = [];
    for (const m of members) {
      reportIds.push((await as(m).post('/reports', { targetType: 'message', targetId: msg.id, reason: 'spam', details: 'спам' }).expect(201)).body.id);
    }
    return { author, members, messageId: msg.id, chatId: chat.id, reportIds };
  }

  it('lists the queue with target preview, filters by status and type', async () => {
    const a = await admin();
    const { reportIds, author } = await messageReported(1);
    const open = (await as(a).get('/admin/reports?status=open&targetType=message&limit=50').expect(200)).body as Paginated<AdminReportDto>;
    const item = open.items.find((r) => r.id === reportIds[0]);
    expect(item).toMatchObject({
      status: 'open',
      reason: 'spam',
      details: 'спам',
      targetUser: { id: author.id },
      preview: { title: 'text', text: 'Продам права, недорого', deleted: false },
    });
    const users = (await as(a).get('/admin/reports?targetType=user&limit=50').expect(200)).body as Paginated<AdminReportDto>;
    expect(users.items.every((r) => r.targetType === 'user')).toBe(true);
  });

  it('confirm + removeContent: message deleted, −10 penalty, siblings resolved, all reporters notified, audit', async () => {
    const a = await admin();
    const { author, members, messageId, reportIds } = await messageReported(3);
    const res = (await as(a).post(`/admin/reports/${reportIds[0]}/resolve`, { decision: 'confirm', note: 'Спам подтверждён', removeContent: true }).expect(200))
      .body as AdminResolveResult;
    expect(res).toMatchObject({ resolvedSiblings: 2, penaltyApplied: true, contentRemoved: true, report: { status: 'confirmed', resolutionNote: 'Спам подтверждён' } });
    expect(res.report.preview.deleted).toBe(true);

    expect((await t.prisma.message.findUniqueOrThrow({ where: { id: messageId } })).deletedAt).not.toBeNull();
    const rows = await t.prisma.report.findMany({ where: { id: { in: reportIds } } });
    expect(rows.every((r) => r.status === 'confirmed' && r.resolvedById === a.id && r.resolvedAt !== null)).toBe(true);

    const penalties = await t.prisma.ratingEvent.findMany({ where: { userId: author.id, reason: 'penalty' } });
    expect(penalties).toEqual([expect.objectContaining({ delta: -10, penaltyPoints: -10, penaltyKind: 'report_confirmed', refId: reportIds[0] })]);
    expect((await t.prisma.user.findUniqueOrThrow({ where: { id: author.id } })).rating).toBe(40);

    for (const [i, m] of members.entries()) {
      expect((await notificationsOf(m.id, 'report_resolved')).map((n) => n.payload)).toEqual([
        { reportId: reportIds[i], decision: 'confirmed', targetType: 'message' },
      ]);
    }
    expect(await auditOf(reportIds[0]!)).toEqual([expect.objectContaining({ action: 'report.confirm', targetUserId: author.id, note: 'Спам подтверждён' })]);
    // Already resolved (also the siblings).
    for (const id of reportIds) {
      expect((await as(a).post(`/admin/reports/${id}/resolve`, { decision: 'dismiss', note: NOTE }).expect(409)).body.error.code).toBe('REPORT_ALREADY_RESOLVED');
    }
  });

  it('dismiss: no penalty, no removal, siblings dismissed', async () => {
    const a = await admin();
    const { author, members, messageId, reportIds } = await messageReported(2);
    const res = (await as(a).post(`/admin/reports/${reportIds[1]}/resolve`, { decision: 'dismiss', note: 'Нарушений нет', removeContent: true }).expect(200))
      .body as AdminResolveResult;
    expect(res).toMatchObject({ resolvedSiblings: 1, penaltyApplied: false, contentRemoved: false });
    expect((await t.prisma.message.findUniqueOrThrow({ where: { id: messageId } })).deletedAt).toBeNull();
    expect(await t.prisma.ratingEvent.count({ where: { userId: author.id, reason: 'penalty' } })).toBe(0);
    expect((await t.prisma.report.findMany({ where: { id: { in: reportIds } } })).every((r) => r.status === 'dismissed')).toBe(true);
    expect((await notificationsOf(members[0]!.id, 'report_resolved'))[0]!.payload).toMatchObject({ decision: 'dismissed' });
  });

  it('confirm without removeContent keeps the content; user reports penalize the user', async () => {
    const a = await admin();
    const target = await createUser(t);
    const reporter = await createUser(t);
    const r = (await as(reporter).post('/reports', { targetType: 'user', targetId: target.id, reason: 'harassment' }).expect(201)).body as { id: string };
    const res = (await as(a).post(`/admin/reports/${r.id}/resolve`, { decision: 'confirm', note: NOTE }).expect(200)).body as AdminResolveResult;
    expect(res).toMatchObject({ penaltyApplied: true, contentRemoved: false, resolvedSiblings: 0 });
    expect((await t.prisma.user.findUniqueOrThrow({ where: { id: target.id } })).rating).toBe(40);
  });

  it('removes content per target type: community soft-deleted, service rejected, fake SOS marked', async () => {
    const a = await admin();
    const reporter = await createUser(t);
    // community
    const owner = await createUser(t);
    const communityId = await createCommunity(t, owner.id, [{ userId: reporter.id }]);
    const rc = (await as(reporter).post('/reports', { targetType: 'community', targetId: communityId, reason: 'inappropriate' }).expect(201)).body.id;
    await as(a).post(`/admin/reports/${rc}/resolve`, { decision: 'confirm', note: NOTE, removeContent: true }).expect(200);
    expect((await t.prisma.community.findUniqueOrThrow({ where: { id: communityId } })).deletedAt).not.toBeNull();
    expect(await t.prisma.chatMember.count({ where: { chat: { refId: communityId } } })).toBe(0);
    // service
    const submitter = await createUser(t);
    const serviceId = await service('verified', submitter.id);
    const rs = (await as(reporter).post('/reports', { targetType: 'service', targetId: serviceId, reason: 'fraud' }).expect(201)).body.id;
    await as(a).post(`/admin/reports/${rs}/resolve`, { decision: 'confirm', note: NOTE, removeContent: true }).expect(200);
    expect((await t.prisma.serviceCenter.findUniqueOrThrow({ where: { id: serviceId } })).status).toBe('rejected');
    expect((await notificationsOf(submitter.id, 'service_status'))[0]!.payload).toMatchObject({ serviceId, status: 'rejected' });
    // SOS with reason fake_sos → mark-fake (−50) on top of the confirmed report (−10)
    const requester = await createUser(t);
    const at = area();
    const sosId = await openSos(requester, at);
    await setLocation(t, reporter.id, at.lat, at.lng, 1);
    const rf = (await as(reporter).post('/reports', { targetType: 'sos', targetId: sosId, reason: 'fake_sos' }).expect(201)).body.id;
    await as(a).post(`/admin/reports/${rf}/resolve`, { decision: 'confirm', note: NOTE, removeContent: true }).expect(200);
    const sos = await t.prisma.sosRequest.findUniqueOrThrow({ where: { id: sosId } });
    expect(sos).toMatchObject({ isFake: true, status: 'cancelled' });
    const kinds = (await t.prisma.ratingEvent.findMany({ where: { userId: requester.id, reason: 'penalty' }, orderBy: { createdAt: 'asc' } })).map((e) => [
      e.penaltyKind,
      e.penaltyPoints,
    ]);
    expect(kinds).toEqual([
      ['fake_sos', -50],
      ['report_confirmed', -10],
    ]);
  });

  it('confirming a report about another admin → 403 INVALID_TARGET (dismiss is allowed)', async () => {
    const a = await admin();
    const b = await admin();
    const reporter = await createUser(t);
    const r = (await as(reporter).post('/reports', { targetType: 'user', targetId: b.id, reason: 'other' }).expect(201)).body.id;
    expect((await as(a).post(`/admin/reports/${r}/resolve`, { decision: 'confirm', note: NOTE }).expect(403)).body.error.code).toBe('INVALID_TARGET');
    await as(a).post(`/admin/reports/${r}/resolve`, { decision: 'dismiss', note: NOTE }).expect(200);
  });
});

/* ------------------------------------------------------------------ communities */

describe('communities', () => {
  it('lists with a deleted flag and deletes with the owner-delete side effects', async () => {
    const a = await admin();
    const owner = await createUser(t);
    const member = await createUser(t);
    const name = `Админ тест ${newId().slice(-6)}`;
    const id = await createCommunity(t, owner.id, [{ userId: member.id }], { name });
    const list = (await as(a).get(`/admin/communities?q=${encodeURIComponent(name)}`).expect(200)).body as Paginated<{ id: string; deleted: boolean; owner: { id: string } }>;
    expect(list.items).toEqual([expect.objectContaining({ id, deleted: false, owner: expect.objectContaining({ id: owner.id }) })]);

    await as(a).del(`/admin/communities/${id}`, { note: 'x' }).expect(400);
    await as(a).del(`/admin/communities/${id}`, { note: NOTE }).expect(204);
    expect((await t.prisma.community.findUniqueOrThrow({ where: { id } })).deletedAt).not.toBeNull();
    expect(await t.prisma.chatMember.count({ where: { chat: { refId: id } } })).toBe(0);
    await as(member).get(`/communities/${id}`).expect(404);
    expect(await auditOf(id)).toEqual([expect.objectContaining({ action: 'community.delete', targetUserId: owner.id, note: NOTE })]);
    const after = (await as(a).get(`/admin/communities?q=${encodeURIComponent(name)}`).expect(200)).body as Paginated<{ deleted: boolean }>;
    expect(after.items[0]!.deleted).toBe(true);
    await as(a).del(`/admin/communities/${id}`, { note: NOTE }).expect(404);

    const adminOwned = await createCommunity(t, (await admin()).id);
    expect((await as(a).del(`/admin/communities/${adminOwned}`, { note: NOTE }).expect(403)).body.error.code).toBe('INVALID_TARGET');
  });
});

/* ------------------------------------------------------------------ services & visits */

describe('services and photo visits', () => {
  it('verify / reject a pending service: status, service_status notification, audit, QR', async () => {
    const a = await admin();
    const submitter = await createUser(t);
    const id = await service('pending', submitter.id, 'Шиномонтаж на Абая');
    const pending = (await as(a).get('/admin/services?status=pending&limit=50').expect(200)).body as Paginated<AdminServiceDto>;
    expect(pending.items.find((s) => s.id === id)).toMatchObject({ status: 'pending', submittedBy: { id: submitter.id }, lat: 43.24, lng: 76.9 });

    const verified = (await as(a).post(`/admin/services/${id}/verify`, { note: 'Проверено по телефону' }).expect(200)).body as AdminServiceDto;
    expect(verified.status).toBe('verified');
    expect((await notificationsOf(submitter.id, 'service_status')).map((n) => n.payload)).toEqual([
      { serviceId: id, serviceName: 'Шиномонтаж на Абая', status: 'verified', note: 'Проверено по телефону' },
    ]);
    expect(await auditOf(id)).toEqual([expect.objectContaining({ action: 'service.verify', targetUserId: submitter.id })]);
    expect((await as(a).post(`/admin/services/${id}/verify`, { note: NOTE }).expect(409)).body.error.code).toBe('SERVICE_STATUS_UNCHANGED');
    // Now listed publicly.
    await as(submitter).get(`/services/${id}`).expect(200);

    const qr = (await as(a).get(`/admin/services/${id}/qr`).expect(200)).body as { code: string; url: string };
    expect(qr.code).toBe(currentQrCode('secret-qr'));
    expect(qr.url).toBe(`http://localhost:3000/services/${id}?code=${qr.code}`);

    await as(a).post(`/admin/services/${id}/reject`, { note: 'Закрылся' }).expect(200);
    expect((await notificationsOf(submitter.id, 'service_status'))[1]!.payload).toMatchObject({ status: 'rejected', note: 'Закрылся' });
    await as(a).post(`/admin/services/${newId()}/verify`, { note: NOTE }).expect(404);
  });

  it("an admin can't moderate their own submission", async () => {
    const a = await admin();
    const id = await service('pending', a.id);
    expect((await as(a).post(`/admin/services/${id}/verify`, { note: NOTE }).expect(403)).body.error.code).toBe('INVALID_TARGET');
  });

  it('photo visits: pending queue with the photo; approve enables the review, reject notifies', async () => {
    const a = await admin();
    const serviceId = await service('verified', null, 'Мойка «Блеск»');
    const visit = async () => {
      const u = await createUser(t);
      const up = (await request(t.http).post('/api/v1/uploads?purpose=order').set(bearer(u.token)).attach('file', await pngImage(24), { filename: 'o.png', contentType: 'image/png' }).expect(201)).body;
      const v = (await as(u).post(`/services/${serviceId}/visits`, { method: 'photo', uploadId: up.id }).expect(201)).body as { id: string; status: string };
      expect(v.status).toBe('pending');
      return { u, visitId: v.id };
    };
    const one = await visit();
    const two = await visit();

    const queue = (await as(a).get('/admin/visits?status=pending&limit=50').expect(200)).body as Paginated<AdminVisitDto>;
    const item = queue.items.find((v) => v.id === one.visitId);
    expect(item).toMatchObject({ method: 'photo', status: 'pending', service: { id: serviceId, name: 'Мойка «Блеск»' }, user: { id: one.u.id } });
    expect(item!.photo?.url).toMatch(/^http/);

    // Before approval no review is possible.
    await as(one.u).post(`/services/${serviceId}/reviews`, { visitId: one.visitId, stars: 5 }).expect(403);
    const approved = (await as(a).post(`/admin/visits/${one.visitId}/approve`, { note: 'Чек совпадает' }).expect(200)).body as AdminVisitDto;
    expect(approved.status).toBe('verified');
    expect((await notificationsOf(one.u.id, 'visit_status'))[0]!.payload).toEqual({
      visitId: one.visitId,
      serviceId,
      serviceName: 'Мойка «Блеск»',
      status: 'verified',
      note: 'Чек совпадает',
    });
    expect((await t.prisma.serviceCenter.findUniqueOrThrow({ where: { id: serviceId } })).visitCount).toBe(1);
    await as(one.u).post(`/services/${serviceId}/reviews`, { visitId: one.visitId, stars: 5 }).expect(201);
    expect((await as(a).post(`/admin/visits/${one.visitId}/reject`, { note: NOTE }).expect(409)).body.error.code).toBe('VISIT_NOT_PENDING');

    await as(a).post(`/admin/visits/${two.visitId}/reject`, { note: 'Фото не читается' }).expect(200);
    expect((await notificationsOf(two.u.id, 'visit_status'))[0]!.payload).toMatchObject({ status: 'rejected' });
    expect((await auditOf(two.visitId)).map((r) => r.action)).toEqual(['visit.reject']);
    await as(two.u).post(`/services/${serviceId}/reviews`, { visitId: two.visitId, stars: 1 }).expect(403);
  });
});

/* ------------------------------------------------------------------ stats, audit, flags */

describe('stats, audit log and fraud flags', () => {
  it('stats reflect the data', async () => {
    const a = await admin();
    const before = (await as(a).get('/admin/stats').expect(200)).body as AdminStatsDto;
    const u = await createUser(t);
    const helper = await createUser(t);
    const at = area();
    const sosId = await openSos(u, at);
    await t.prisma.sosRequest.update({ where: { id: sosId }, data: { createdAt: new Date(Date.now() - 120_000) } });
    await setLocation(t, helper.id, at.lat, at.lng + 0.01, 1);
    await as(helper).post(`/sos/${sosId}/respond`).expect(200);
    await service('pending', u.id);
    const after = (await as(a).get('/admin/stats').expect(200)).body as AdminStatsDto;
    expect(after.users.total).toBe(before.users.total + 2);
    expect(after.users.new7d).toBe(before.users.new7d + 2);
    expect(after.sos.open).toBe(before.sos.open + 1);
    expect(after.sos.last7d).toBe(before.sos.last7d + 1);
    expect(after.services.pending).toBe(before.services.pending + 1);
    expect(after.sos.medianFirstResponseSec7d).toEqual(expect.any(Number));
    expect(after.sos.fakeRate30d).toBeGreaterThanOrEqual(0);
    expect(after.sos.fakeRate30d).toBeLessThanOrEqual(1);
  });

  it('audit log filters by admin and target user; fraud flags filter by kind', async () => {
    const a = await admin();
    const b = await admin();
    const u = await createUser(t);
    await as(a).post(`/admin/users/${u.id}/warn`, { note: NOTE }).expect(200);
    await as(b).post(`/admin/users/${u.id}/warn`, { note: 'Второе предупреждение' }).expect(200);
    const byAdmin = (await as(a).get(`/admin/audit?adminId=${b.id}`).expect(200)).body as Paginated<{ admin: { id: string }; note: string }>;
    expect(byAdmin.items).toEqual([expect.objectContaining({ admin: expect.objectContaining({ id: b.id }), note: 'Второе предупреждение' })]);
    const byTarget = (await as(a).get(`/admin/audit?targetUserId=${u.id}`).expect(200)).body as Paginated<unknown>;
    expect(byTarget.items).toHaveLength(2);

    await t.prisma.fraudFlag.create({ data: { id: newId(), userId: null, kind: 'otp_abuse', details: { phoneMasked: '+7 701 *** ** 11' } } });
    const flags = (await as(a).get('/admin/fraud-flags?kind=otp_abuse').expect(200)).body as Paginated<{ kind: string; user: unknown; details: object }>;
    expect(flags.items[0]).toMatchObject({ kind: 'otp_abuse', user: null, details: { phoneMasked: '+7 701 *** ** 11' } });
    await as(a).get('/admin/fraud-flags?kind=bogus').expect(400);
  });
});

