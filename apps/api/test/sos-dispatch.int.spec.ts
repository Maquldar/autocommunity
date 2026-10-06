import type { AddressInfo } from 'node:net';
import type { NotificationDto, SosDto } from '@autoc/shared';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { RealtimeService } from '../src/modules/realtime/realtime.service';
import { SosDispatchService } from '../src/modules/sos/sos-dispatch.service';
import { SosBroadcastService } from '../src/modules/sos/sos-broadcast.service';
import { BackgroundTasks } from '../src/infra/tasks/background-tasks';
import { bearer, createTestApp, createUser, setLocation, waitFor, type CreateUserData, type TestApp } from './support/app';

const STEP_MS = 700;
let t: TestApp;
let baseUrl: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  t = await createTestApp({ SOS_EXPAND_DELAY_MS: String(STEP_MS), SOS_TTL_SEC: '4' });
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
let areaSeq = 0;
/** Separate areas ~1° apart. `km(n)` is a point n km north of the centre. */
const area = () => {
  const lat = 45 + areaSeq;
  const lng = 50 + areaSeq;
  areaSeq++;
  return { lat, lng, km: (n: number, east = 0) => ({ lat: lat + n / 111.32, lng: lng + east / 78 }) };
};

async function userAt(p: { lat: number; lng: number }, data: CreateUserData & { rating?: number; receiveSos?: boolean } = {}, minutesAgo = 1): Promise<U> {
  const { rating, receiveSos, ...rest } = data;
  const u = await createUser(t, rest);
  if (rating !== undefined || receiveSos !== undefined) await t.prisma.user.update({ where: { id: u.id }, data: { rating, receiveSos } });
  await setLocation(t, u.id, p.lat, p.lng, minutesAgo);
  return u;
}

const createSos = async (u: U, p: { lat: number; lng: number }) =>
  (await request(t.http).post('/api/v1/sos').set(bearer(u.token)).send({ type: 'battery', lat: p.lat, lng: p.lng, sharePhone: false }).expect(201)).body as SosDto;

const dispatchedIds = async (sosId: string) =>
  (await t.prisma.sosDispatch.findMany({ where: { sosId }, orderBy: { distanceM: 'asc' } })).map((d) => d.userId);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('dispatch', () => {
  it('notifies eligible users by expanding radius 5 → 10 → 20 km, never twice', async () => {
    const a = area();
    const requester = await userAt(a.km(0));
    const at3 = await userAt(a.km(3));
    const at8 = await userAt(a.km(8));
    const at15 = await userAt(a.km(15));
    const at25 = await userAt(a.km(25));
    const sos = await createSos(requester, a.km(0));

    await waitFor(async () => (await dispatchedIds(sos.id)).length === 1);
    expect(await dispatchedIds(sos.id)).toEqual([at3.id]);
    expect((await t.prisma.sosRequest.findUniqueOrThrow({ where: { id: sos.id } })).radiusM).toBe(5000);
    await waitFor(async () => (await dispatchedIds(sos.id)).length === 2, 5000);
    expect((await t.prisma.sosRequest.findUniqueOrThrow({ where: { id: sos.id } })).radiusM).toBe(10000);
    await waitFor(async () => (await dispatchedIds(sos.id)).length === 3, 5000);
    expect(await dispatchedIds(sos.id)).toEqual([at3.id, at8.id, at15.id]);
    expect((await t.prisma.sosRequest.findUniqueOrThrow({ where: { id: sos.id } })).radiusM).toBe(20000);
    await sleep(STEP_MS);
    expect(await dispatchedIds(sos.id)).not.toContain(at25.id);

    const note = await t.prisma.notification.findFirstOrThrow({ where: { userId: at8.id, type: 'sos_nearby' } });
    expect(note.payload).toMatchObject({ sosId: sos.id, type: 'battery', requester: { id: requester.id } });
    expect((note.payload as { distanceM: number }).distanceM).toBeGreaterThan(7900);
    expect((note.payload as { distanceM: number }).distanceM).toBeLessThan(8100);
    for (const u of [at3, at8, at15]) expect(await t.prisma.notification.count({ where: { userId: u.id, type: 'sos_nearby' } })).toBe(1);
    // Re-running a step (e.g. a retried job) never notifies anyone twice.
    expect(await t.app.get(SosDispatchService).dispatch(sos.id, 2)).toEqual([]);
    expect(await t.prisma.notification.count({ where: { userId: at3.id, type: 'sos_nearby' } })).toBe(1);
  });

  it('only picks fresh, active, onboarded users with receive_sos and rating ≥ 30 — hidden users included but never revealed', async () => {
    const a = area();
    const requester = await userAt(a.km(0));
    const ok = await userAt(a.km(1));
    const rating30 = await userAt(a.km(1.1), { rating: 30 });
    const hidden = await userAt(a.km(1.2), { privacyMode: 'hidden' });
    const stale = await userAt(a.km(1), {}, 16);
    const lowRating = await userAt(a.km(1), { rating: 29 });
    const noSos = await userAt(a.km(1), { receiveSos: false });
    const blocked = await userAt(a.km(1), { status: 'blocked' });
    const notOnboarded = await userAt(a.km(1), { onboarded: false });
    const sos = await createSos(requester, a.km(0));
    await waitFor(async () => (await dispatchedIds(sos.id)).length === 3);
    await sleep(STEP_MS * 2.5);
    expect((await dispatchedIds(sos.id)).sort()).toEqual([ok.id, rating30.id, hidden.id].sort());
    for (const u of [stale, lowRating, noSos, blocked, notOnboarded]) {
      expect(await t.prisma.notification.count({ where: { userId: u.id } })).toBe(0);
    }
    // The hidden user can open the SOS; the requester's view says nothing about who was dispatched.
    await request(t.http).get(`/api/v1/sos/${sos.id}`).set(bearer(hidden.token)).expect(200);
    const asRequester = (await request(t.http).get(`/api/v1/sos/${sos.id}`).set(bearer(requester.token)).expect(200)).body as SosDto;
    expect(JSON.stringify(asRequester)).not.toContain(hidden.id);
  });

  it('caps each step at the 20 nearest and fills the rest on expansion without duplicates', async () => {
    const a = area();
    const requester = await userAt(a.km(0));
    const users: U[] = [];
    for (let i = 0; i < 25; i++) users.push(await userAt(a.km(0.5 + i * 0.1)));
    const sos = await createSos(requester, a.km(0));
    await waitFor(async () => (await dispatchedIds(sos.id)).length === 20);
    expect((await dispatchedIds(sos.id)).sort()).toEqual(users.slice(0, 20).map((u) => u.id).sort());
    await waitFor(async () => (await dispatchedIds(sos.id)).length === 25, 5000);
    // Notifications are written right after the dispatch rows commit: wait for them, then check none doubled.
    const ids = users.map((u) => u.id);
    await waitFor(async () => (await t.prisma.notification.count({ where: { userId: { in: ids }, type: 'sos_nearby' } })) === 25, 5000);
    for (const u of users) expect(await t.prisma.notification.count({ where: { userId: u.id, type: 'sos_nearby' } })).toBe(1);
  });

  it('stops expanding once a helper is accepted', async () => {
    const a = area();
    const requester = await userAt(a.km(0));
    const helper = await userAt(a.km(1));
    const at8 = await userAt(a.km(8));
    const sos = await createSos(requester, a.km(0));
    await waitFor(async () => (await dispatchedIds(sos.id)).length === 1);
    const r = (await request(t.http).post(`/api/v1/sos/${sos.id}/respond`).set(bearer(helper.token)).expect(200)).body as SosDto;
    await request(t.http).post(`/api/v1/sos/${sos.id}/responses/${r.responses[0]!.id}/accept`).set(bearer(requester.token)).expect(200);
    await sleep(STEP_MS * 3);
    expect(await dispatchedIds(sos.id)).toEqual([helper.id]);
    expect(await t.prisma.notification.count({ where: { userId: at8.id } })).toBe(0);
    expect((await t.prisma.sosRequest.findUniqueOrThrow({ where: { id: sos.id } })).radiusM).toBe(5000);
  });
});

describe('expiry', () => {
  it('expires an unaccepted SOS at expiresAt; an accepted one stays', async () => {
    const a = area();
    const lonely = await userAt(a.km(0));
    const sos = await createSos(lonely, a.km(0));
    const requester2 = await userAt(a.km(0.5));
    const helper = await userAt(a.km(0.6));
    const sos2 = await createSos(requester2, a.km(0.5));
    const r = (await request(t.http).post(`/api/v1/sos/${sos2.id}/respond`).set(bearer(helper.token)).expect(200)).body as SosDto;
    await request(t.http).post(`/api/v1/sos/${sos2.id}/responses/${r.responses[0]!.id}/accept`).set(bearer(requester2.token)).expect(200);

    await waitFor(async () => (await t.prisma.sosRequest.findUniqueOrThrow({ where: { id: sos.id } })).status === 'expired', 10_000, 100);
    const row = await t.prisma.sosRequest.findUniqueOrThrow({ where: { id: sos.id } });
    expect(row.closedAt).not.toBeNull();
    expect((await t.prisma.notification.findFirstOrThrow({ where: { userId: lonely.id, type: 'sos_status' } })).payload).toMatchObject({ sosId: sos.id, status: 'expired' });
    expect((await t.prisma.sosRequest.findUniqueOrThrow({ where: { id: sos2.id } })).status).toBe('accepted');
    // The requester may open a new SOS right away.
    await createSos(lonely, a.km(0));
  });

  it('a withdraw after expiresAt expires the SOS instead of reopening it; the sweep catches lost jobs', async () => {
    const a = area();
    const requester = await userAt(a.km(0));
    const helper = await userAt(a.km(0.5));
    const sos = await createSos(requester, a.km(0));
    const r = (await request(t.http).post(`/api/v1/sos/${sos.id}/respond`).set(bearer(helper.token)).expect(200)).body as SosDto;
    await request(t.http).post(`/api/v1/sos/${sos.id}/responses/${r.responses[0]!.id}/accept`).set(bearer(requester.token)).expect(200);
    await sleep(4500);
    const w = (await request(t.http).post(`/api/v1/sos/${sos.id}/withdraw`).set(bearer(helper.token)).expect(200)).body as SosDto;
    expect(w.status).toBe('expired');

    const lost = await userAt(a.km(5));
    const s3 = await createSos(lost, a.km(5));
    await t.app.get(SosDispatchService).expire(s3.id); // too early: no-op
    expect((await t.prisma.sosRequest.findUniqueOrThrow({ where: { id: s3.id } })).status).toBe('created');
    await t.prisma.$executeRaw`UPDATE sos_requests SET expires_at = now() - interval '1 minute' WHERE id = ${s3.id}::uuid`;
    expect(await t.app.get(SosDispatchService).sweepExpired()).toBeGreaterThanOrEqual(1);
    expect((await t.prisma.sosRequest.findUniqueOrThrow({ where: { id: s3.id } })).status).toBe('expired');
  });
});

describe('lifetime limits (review M1)', () => {
  it('a transition on a created SOS past expiresAt expires it first and answers 409', async () => {
    const a = area();
    const requester = await userAt(a.km(0));
    const helper = await userAt(a.km(1));
    const sos = await createSos(requester, a.km(0));
    await t.prisma.$executeRaw`UPDATE sos_requests SET expires_at = now() - interval '5 minutes' WHERE id = ${sos.id}::uuid`;
    const res = await request(t.http).post(`/api/v1/sos/${sos.id}/respond`).set(bearer(helper.token)).expect(409);
    expect(res.body.error.code).toBe('SOS_INVALID_STATE');
    expect((await t.prisma.sosRequest.findUniqueOrThrow({ where: { id: sos.id } })).status).toBe('expired');
    expect(await t.prisma.notification.count({ where: { userId: requester.id, type: 'sos_status' } })).toBe(1);
    expect((await request(t.http).post(`/api/v1/sos/${sos.id}/cancel`).set(bearer(requester.token)).send({}).expect(409)).body.error.code).toBe('SOS_INVALID_STATE');
  });

  it('an accepted / in-progress SOS times out 24 h after acceptance; everyone is told', async () => {
    for (const arrive of [false, true]) {
      const a = area();
      const requester = await userAt(a.km(0));
      const helper = await userAt(a.km(1));
      const sos = await createSos(requester, a.km(0));
      const r = (await request(t.http).post(`/api/v1/sos/${sos.id}/respond`).set(bearer(helper.token)).expect(200)).body as SosDto;
      const accepted = (await request(t.http).post(`/api/v1/sos/${sos.id}/responses/${r.responses[0]!.id}/accept`).set(bearer(requester.token)).expect(200)).body as SosDto;
      if (arrive) await request(t.http).post(`/api/v1/sos/${sos.id}/arrived`).set(bearer(helper.token)).expect(200);
      const service = t.app.get(SosDispatchService);
      await service.sweepExpired();
      expect((await t.prisma.sosRequest.findUniqueOrThrow({ where: { id: sos.id } })).status).toBe(arrive ? 'in_progress' : 'accepted');
      await t.prisma.$executeRaw`UPDATE sos_requests SET accepted_at = now() - interval '25 hours' WHERE id = ${sos.id}::uuid`;
      expect(await service.sweepExpired()).toBeGreaterThanOrEqual(1);
      const row = await t.prisma.sosRequest.findUniqueOrThrow({ where: { id: sos.id } });
      expect(row.status).toBe('expired');
      expect(row.closedAt).not.toBeNull();
      for (const u of [requester, helper]) {
        expect((await t.prisma.notification.findFirstOrThrow({ where: { userId: u.id, type: 'sos_status' }, orderBy: { createdAt: 'desc' } })).payload).toMatchObject({ status: 'expired', event: 'timeout' });
      }
      const last = await t.prisma.message.findFirstOrThrow({ where: { chatId: accepted.chatId! }, orderBy: { createdAt: 'desc' } });
      expect(last).toMatchObject({ type: 'system', text: 'sos.timed_out' });
      // No help is confirmed by a timeout.
      expect(await t.prisma.ratingEvent.count({ where: { userId: helper.id, reason: 'help_confirmed' } })).toBe(0);
    }
  });
});

describe('bounded work (review M6 / L5)', () => {
  const queriesOf = async (fn: () => Promise<unknown>) => {
    const prisma = t.prisma as unknown as { queryCount: number };
    await t.app.get(BackgroundTasks).drain();
    const before = prisma.queryCount;
    await fn();
    await t.app.get(BackgroundTasks).drain();
    return prisma.queryCount - before;
  };

  it('sos:update to 30 participants takes a bounded number of queries', async () => {
    const a = area();
    const requester = await userAt(a.km(0));
    const sos = await createSos(requester, a.km(0));
    const users = await Promise.all(Array.from({ length: 30 }, () => createUser(t)));
    await t.prisma.sosDispatch.createMany({ data: users.map((u) => ({ sosId: sos.id, userId: u.id, distanceM: 1000, notifiedAt: new Date() })) });
    // The counter is process-wide (the SOS's own dispatch job may run meanwhile): take the best of 3.
    const runs: number[] = [];
    for (let i = 0; i < 3; i++) runs.push(await queriesOf(() => t.app.get(SosBroadcastService).send(sos.id, 'sos:update')));
    expect(Math.min(...runs)).toBeLessThanOrEqual(15);
  });

  it('dispatch cost does not grow with the number of notified users', async () => {
    const costFor = async (recipients: number) => {
      const a = area();
      const requester = await userAt(a.km(0));
      for (let i = 0; i < recipients; i++) await userAt(a.km(30 + i * 0.01)); // outside 20 km: not picked up automatically
      const sos = await createSos(requester, a.km(0));
      await sleep(STEP_MS * 3); // let the scheduled steps run (nobody in range)
      await t.prisma.$executeRaw`
        UPDATE user_locations SET location = ST_SetSRID(ST_MakePoint(${a.lng}::float8, ${a.lat + 0.01}::float8), 4326)::geography
        WHERE user_id IN (SELECT id FROM users WHERE id <> ${requester.id}::uuid) AND ST_DWithin(location, ST_SetSRID(ST_MakePoint(${a.lng}::float8, ${a.lat + 30 / 111.32}::float8), 4326)::geography, 5000)`;
      let notified: string[] = [];
      const n = await queriesOf(async () => {
        notified = await t.app.get(SosDispatchService).dispatch(sos.id, 0);
      });
      expect(notified).toHaveLength(recipients);
      return n;
    };
    // The counter is process-wide, so unrelated background work (expiry sweep, delayed dispatch steps of
    // other SOS) can land inside a measurement. It can only add queries, so the minimum of repeated
    // measurements is the dispatch's own cost.
    const cheapest = async (recipients: number) => Math.min(await costFor(recipients), await costFor(recipients));
    const few = await cheapest(3);
    const many = await cheapest(18);
    expect(many - few).toBeLessThanOrEqual(1);
  });

  it('a retried dispatch notifies rows left unnotified, exactly once', async () => {
    const a = area();
    const requester = await userAt(a.km(0));
    const sos = await createSos(requester, a.km(0));
    await sleep(100);
    const stranded = await createUser(t);
    await t.prisma.sosDispatch.create({ data: { sosId: sos.id, userId: stranded.id, distanceM: 1234, notifiedAt: null } });
    await t.app.get(SosDispatchService).dispatch(sos.id, 0);
    await t.app.get(SosDispatchService).dispatch(sos.id, 0);
    expect(await t.prisma.notification.count({ where: { userId: stranded.id, type: 'sos_nearby' } })).toBe(1);
    expect((await t.prisma.sosDispatch.findUniqueOrThrow({ where: { sosId_userId: { sosId: sos.id, userId: stranded.id } } })).notifiedAt).not.toBeNull();
  });
});

describe('sockets over polling', () => {
  async function connect(u: U): Promise<Socket> {
    const socket = io(`${baseUrl}/rt`, { path: '/socket.io', auth: { token: u.token }, transports: ['polling'], reconnection: false, forceNew: true });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    return socket;
  }
  const once = <T>(socket: Socket, event: string, match: (p: T) => boolean = () => true, timeoutMs = 5000) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
      const handler = (p: T) => {
        if (!match(p)) return;
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(p);
      };
      socket.on(event, handler);
    });

  it('sos:new to dispatched users (viewer view); sos:update per participant on transitions; rooms joined', async () => {
    const a = area();
    const requester = await userAt(a.km(0));
    const helper = await userAt(a.km(1));
    const sR = await connect(requester);
    const sH = await connect(helper);
    const nearby = once<NotificationDto>(sH, 'notification:new', (n) => n.type === 'sos_nearby');
    const created = once<SosDto>(sH, 'sos:new');
    const sos = await createSos(requester, a.km(0));
    const got = await created;
    expect(got).toMatchObject({ id: sos.id, myRole: 'viewer', responses: [], contactPhone: null, status: 'created' });
    expect(got.distanceM).toBeGreaterThan(900);
    expect((await nearby).payload).toMatchObject({ sosId: sos.id });

    const ns = (t.app.get(RealtimeService) as unknown as { ns: import('socket.io').Namespace }).ns;
    await waitFor(async () => (await ns.in(`sos:${sos.id}`).fetchSockets()).length === 2);

    const forRequester = once<SosDto>(sR, 'sos:update', (s) => s.id === sos.id && s.responses.length === 1);
    const forHelper = once<SosDto>(sH, 'sos:update', (s) => s.id === sos.id && s.myRole === 'helper');
    const r = (await request(t.http).post(`/api/v1/sos/${sos.id}/respond`).set(bearer(helper.token)).expect(200)).body as SosDto;
    expect((await forRequester).myRole).toBe('requester');
    expect((await forHelper).responses).toHaveLength(1);

    const accepted = once<SosDto>(sH, 'sos:update', (s) => s.status === 'accepted');
    await request(t.http).post(`/api/v1/sos/${sos.id}/responses/${r.responses[0]!.id}/accept`).set(bearer(requester.token)).expect(200);
    const view = await accepted;
    expect(view.contactPhone).not.toBeNull(); // accepted helper's own rendering
    expect(view.chatId).toEqual(expect.any(String));

    // A socket connecting later auto-joins the open SOS room.
    sH.disconnect();
    const again = await connect(helper);
    await waitFor(async () => (await ns.in(`sos:${sos.id}`).fetchSockets()).some((s) => s.id === again.id));
    const closed = once<SosDto>(again, 'sos:update', (s) => s.status === 'closed');
    await request(t.http).post(`/api/v1/sos/${sos.id}/close`).set(bearer(requester.token)).expect(200);
    expect((await closed).contactPhone).toBeNull();
  });
});
