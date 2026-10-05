import { SOS_LIMITS, type MessageDto, type SosDto } from '@autoc/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../src/common/ids';
import { SosDispatchService } from '../src/modules/sos/sos-dispatch.service';
import { bearer, createTestApp, createUser, makeFriends, nextIp, setLocation, waitFor, type CreateUserData, type TestApp } from './support/app';
import { pngImage } from './support/images';

let t: TestApp;
beforeAll(async () => {
  // Expansions far in the future: these tests only see the immediate dispatch.
  t = await createTestApp({ SOS_EXPAND_DELAY_MS: '3600000' });
});
afterAll(async () => {
  await t.close();
});

type U = { id: string; token: string };

/** Each test works ~1° away from the others so dispatch/visibility never cross. */
let areaSeq = 0;
const area = () => {
  const lat = 40 + areaSeq * 1.0;
  const lng = 60 + areaSeq * 1.0;
  areaSeq++;
  return { lat, lng, near: (dLat: number, dLng = 0) => ({ lat: lat + dLat, lng: lng + dLng }) };
};

const sos = (u: U) => ({
  create: (body: object) => request(t.http).post('/api/v1/sos').set(bearer(u.token)).send(body),
  get: (id: string) => request(t.http).get(`/api/v1/sos/${id}`).set(bearer(u.token)),
  respond: (id: string) => request(t.http).post(`/api/v1/sos/${id}/respond`).set(bearer(u.token)),
  withdraw: (id: string) => request(t.http).post(`/api/v1/sos/${id}/withdraw`).set(bearer(u.token)),
  accept: (id: string, r: string) => request(t.http).post(`/api/v1/sos/${id}/responses/${r}/accept`).set(bearer(u.token)),
  decline: (id: string, r: string) => request(t.http).post(`/api/v1/sos/${id}/responses/${r}/decline`).set(bearer(u.token)),
  arrived: (id: string) => request(t.http).post(`/api/v1/sos/${id}/arrived`).set(bearer(u.token)),
  close: (id: string) => request(t.http).post(`/api/v1/sos/${id}/close`).set(bearer(u.token)),
  cancel: (id: string, reason?: string) => request(t.http).post(`/api/v1/sos/${id}/cancel`).set(bearer(u.token)).send(reason ? { reason } : {}),
  share: (id: string) => request(t.http).post(`/api/v1/sos/${id}/share`).set(bearer(u.token)),
  active: () => request(t.http).get('/api/v1/sos/active').set(bearer(u.token)),
  nearby: (lat?: number, lng?: number) =>
    request(t.http).get(`/api/v1/sos/nearby${lat === undefined ? '' : `?lat=${lat}&lng=${lng}`}`).set(bearer(u.token)),
  history: (q = '') => request(t.http).get(`/api/v1/sos/history${q}`).set(bearer(u.token)),
  map: (bbox: string) => request(t.http).get(`/api/v1/map/sos?bbox=${bbox}`).set(bearer(u.token)),
});

const body = (p: { lat: number; lng: number }, extra: object = {}) => ({ type: 'flat_tire', description: 'Пробил колесо', lat: p.lat, lng: p.lng, sharePhone: false, ...extra });

async function userAt(p: { lat: number; lng: number } | null, data: CreateUserData & { rating?: number } = {}): Promise<U> {
  const { rating, ...rest } = data;
  const u = await createUser(t, rest);
  if (rating !== undefined) await t.prisma.user.update({ where: { id: u.id }, data: { rating } });
  if (p) await setLocation(t, u.id, p.lat, p.lng, 1);
  return u;
}

/** An open SOS with a requester and helpers who already offered help. */
async function scenario(helpers = 1, extra: object = {}) {
  const a = area();
  const requester = await userAt(a.near(0), { name: 'Айгерим Касымова' });
  const hs: U[] = [];
  for (let i = 0; i < helpers; i++) hs.push(await userAt(a.near(0.01 * (i + 1))));
  const created = (await sos(requester).create(body(a.near(0), extra)).expect(201)).body as SosDto;
  const responses: string[] = [];
  for (const h of hs) {
    const r = (await sos(h).respond(created.id).expect(200)).body as SosDto;
    responses.push(r.responses[0]!.id);
  }
  return { a, requester, helpers: hs, id: created.id, responses };
}

describe('POST /sos gates', () => {
  it('creates an SOS, stores the requester position and returns the requester view', async () => {
    const a = area();
    const u = await userAt(null);
    const photo = (await request(t.http).post('/api/v1/uploads?purpose=sos').set(bearer(u.token)).attach('file', await pngImage(), { filename: 'p.png', contentType: 'image/png' }).expect(201)).body;
    const res = await sos(u).create(body(a.near(0), { photoUploadIds: [photo.id], sharePhone: true })).expect(201);
    const dto = res.body as SosDto;
    expect(dto).toMatchObject({
      type: 'flat_tire',
      description: 'Пробил колесо',
      status: 'created',
      lat: a.lat,
      lng: a.lng,
      radiusM: 5000,
      myRole: 'requester',
      responses: [],
      contactPhone: null,
      chatId: null,
      canReview: false,
      closedAt: null,
      distanceM: 0,
      requester: { id: u.id, relation: 'self' },
      photos: [{ id: photo.id }],
    });
    expect(new Date(dto.expiresAt).getTime() - new Date(dto.createdAt).getTime()).toBe(2 * 3600 * 1000);
    const loc = await t.prisma.userLocation.findUniqueOrThrow({ where: { userId: u.id } });
    expect(loc.source).toBe('client');
  });

  it('enforces every gate with its error code, in order', async () => {
    const a = area();
    const p = a.near(0);
    const unverified = await userAt(null);
    await t.prisma.user.update({ where: { id: unverified.id }, data: { phoneVerifiedAt: null } });
    expect((await sos(unverified).create(body(p)).expect(403)).body.error.code).toBe('PHONE_NOT_VERIFIED');

    const low = await userAt(null, { rating: 19 });
    expect((await sos(low).create(body(p)).expect(403)).body.error.code).toBe('RATING_TOO_LOW');
    const edge = await userAt(null, { rating: 20 });
    await sos(edge).create(body(p)).expect(201);

    const banned = await userAt(null);
    const until = new Date(Date.now() + 3600_000);
    await t.prisma.user.update({ where: { id: banned.id }, data: { sosBannedUntil: until } });
    const bannedRes = await sos(banned).create(body(p)).expect(403);
    expect(bannedRes.body.error).toMatchObject({ code: 'SOS_BANNED', details: { until: until.toISOString() } });
    await t.prisma.user.update({ where: { id: banned.id }, data: { sosBannedUntil: new Date(Date.now() - 1000) } });
    await sos(banned).create(body(p)).expect(201);

    const busy = await userAt(null);
    const first = (await sos(busy).create(body(p)).expect(201)).body as SosDto;
    expect((await sos(busy).create(body(p)).expect(409)).body.error.code).toBe('SOS_ALREADY_OPEN');
    await sos(busy).cancel(first.id).expect(200);
    const second = (await sos(busy).create(body(p)).expect(201)).body as SosDto;
    await sos(busy).cancel(second.id).expect(200);
    const third = (await sos(busy).create(body(p)).expect(201)).body as SosDto;
    await sos(busy).cancel(third.id).expect(200);
    const limited = await sos(busy).create(body(p)).expect(429);
    expect(limited.body.error.code).toBe('SOS_RATE_LIMIT');
    expect(limited.body.error.details.retryAfterSec).toBeGreaterThan(23 * 3600);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

    // Concurrent creates: exactly one open SOS.
    const racer = await userAt(null);
    const results = await Promise.all([1, 2, 3].map(() => request(t.http).post('/api/v1/sos').set(bearer(racer.token)).send(body(p))));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
  });

  it('validates the body and photo uploads', async () => {
    const a = area();
    const u = await userAt(null);
    for (const b of [
      { ...body(a.near(0)), type: 'zombies' },
      { ...body(a.near(0)), description: 'x'.repeat(501) },
      { ...body(a.near(0)), lat: '43.2' },
      { ...body(a.near(0)), lat: 91 },
      { ...body(a.near(0)), sharePhone: undefined },
      { ...body(a.near(0)), photoUploadIds: Array.from({ length: 5 }, () => newId()) },
    ]) {
      expect((await sos(u).create(b).expect(400)).body.error.code).toBe('VALIDATION_ERROR');
    }
    const avatar = (await request(t.http).post('/api/v1/uploads?purpose=avatar').set(bearer(u.token)).attach('file', await pngImage(), { filename: 'p.png', contentType: 'image/png' }).expect(201)).body;
    expect((await sos(u).create(body(a.near(0), { photoUploadIds: [avatar.id] })).expect(400)).body.error.code).toBe('INVALID_UPLOAD');
    const other = await userAt(null);
    const theirs = (await request(t.http).post('/api/v1/uploads?purpose=sos').set(bearer(other.token)).attach('file', await pngImage(), { filename: 'p.png', contentType: 'image/png' }).expect(201)).body;
    expect((await sos(u).create(body(a.near(0), { photoUploadIds: [theirs.id] })).expect(400)).body.error.code).toBe('INVALID_UPLOAD');
  });
});

describe('GET /sos/:id visibility', () => {
  it('requester, responders, dispatched users and users within 20 km see it; others get 404', async () => {
    const a = area();
    const requester = await userAt(a.near(0));
    const dispatched = await userAt(a.near(0.02)); // ~2 km, fresh, eligible → dispatched
    const within20 = await userAt(a.near(0.15), { rating: 10 }); // ~17 km, not eligible for dispatch
    const far = await userAt(a.near(0.3)); // ~33 km
    const noLocation = await userAt(null);
    const id = ((await sos(requester).create(body(a.near(0))).expect(201)).body as SosDto).id;
    await waitFor(async () => (await t.prisma.sosDispatch.count({ where: { sosId: id, userId: dispatched.id } })) === 1);

    for (const u of [requester, dispatched, within20]) await sos(u).get(id).expect(200);
    for (const u of [far, noLocation]) await sos(u).get(id).expect(404);
    // A dispatched user who moved away still sees it; a responder too.
    await setLocation(t, dispatched.id, 10, 10, 1);
    await sos(dispatched).get(id).expect(200);
    expect((await sos(within20).get(id).expect(200)).body).toMatchObject({ myRole: 'viewer', responses: [], distanceM: expect.any(Number) });
    // Unknown id / far users can't act either.
    await sos(far).respond(id).expect(404);
    await sos(far).get(newId()).expect(404);
  });
});

describe('lifecycle', () => {
  it('offer → accept → arrived → close, with notifications and the SOS chat', async () => {
    const { requester, helpers, id, responses } = await scenario(1);
    const [helper] = helpers as [U];
    const offered = await t.prisma.notification.findFirstOrThrow({ where: { userId: requester.id, type: 'sos_response' } });
    expect(offered.payload).toMatchObject({ sosId: id, responseId: responses[0], helper: { id: helper.id } });

    const accepted = (await sos(requester).accept(id, responses[0]!).expect(200)).body as SosDto;
    expect(accepted).toMatchObject({ status: 'accepted', responses: [{ id: responses[0], status: 'accepted' }] });
    expect(accepted.chatId).toEqual(expect.any(String));
    const sosRow = await t.prisma.sosRequest.findUniqueOrThrow({ where: { id } });
    expect(sosRow.acceptedAt).not.toBeNull();
    expect(await t.prisma.notification.count({ where: { userId: helper.id, type: 'sos_accepted' } })).toBe(1);

    // The chat: type sos, requester + accepted helper, system messages.
    const chat = await t.prisma.chat.findUniqueOrThrow({ where: { refId: id }, include: { members: true } });
    expect(chat.type).toBe('sos');
    expect(chat.members.map((m) => m.userId).sort()).toEqual([requester.id, helper.id].sort());
    const msgs = (await request(t.http).get(`/api/v1/chats/${chat.id}/messages`).set(bearer(helper.token)).expect(200)).body.items as MessageDto[];
    expect(msgs.map((m) => [m.type, m.text]).reverse()).toEqual([
      ['system', 'sos.chat_created'],
      ['system', expect.stringMatching(/^sos\.helper_accepted:/)],
    ]);
    const chatDto = (await request(t.http).get(`/api/v1/chats/${chat.id}`).set(bearer(helper.token)).expect(200)).body;
    expect(chatDto).toMatchObject({ type: 'sos', refId: id, title: 'SOS · Айгерим Касымова' });
    expect((await sos(helper).get(id).expect(200)).body.chatId).toBe(chat.id);

    const arrived = (await sos(helper).arrived(id).expect(200)).body as SosDto;
    expect(arrived).toMatchObject({ status: 'in_progress', responses: [{ status: 'arrived' }] });
    expect(await t.prisma.notification.count({ where: { userId: requester.id, type: 'sos_status' } })).toBe(1);

    const closed = (await sos(requester).close(id).expect(200)).body as SosDto;
    expect(closed).toMatchObject({ status: 'closed', closedAt: expect.any(String), canReview: true, reviewTargets: [{ id: helper.id }] });
    const statusNote = await t.prisma.notification.findFirstOrThrow({ where: { userId: helper.id, type: 'sos_status' } });
    expect(statusNote.payload).toMatchObject({ sosId: id, status: 'closed' });
    const last = (await request(t.http).get(`/api/v1/chats/${chat.id}/messages?limit=1`).set(bearer(helper.token)).expect(200)).body.items[0];
    expect(last).toMatchObject({ type: 'system', text: 'sos.closed' });

    // Terminal: nothing else is possible.
    for (const call of [() => sos(requester).close(id), () => sos(requester).cancel(id), () => sos(helper).withdraw(id), () => sos(helper).arrived(id), () => sos(helper).respond(id)]) {
      expect((await call().expect(409)).body.error.code).toBe('SOS_INVALID_STATE');
    }
  });

  it('withdraw of the only accepted helper reverts to created; offers stay offered; decline is final', async () => {
    const { requester, helpers, id, responses } = await scenario(3);
    const [h1, h2, h3] = helpers as [U, U, U];
    await sos(requester).accept(id, responses[0]!).expect(200);
    const view = (await sos(requester).get(id).expect(200)).body as SosDto;
    expect(view.responses.map((r) => r.status)).toEqual(['accepted', 'offered', 'offered']);
    const chatId = view.chatId!;

    const w = (await sos(h1).withdraw(id).expect(200)).body as SosDto;
    expect(w).toMatchObject({ status: 'created', responses: [{ status: 'withdrawn' }], chatId: null });
    expect(await t.prisma.chatMember.count({ where: { chatId, userId: h1.id } })).toBe(0);
    const note = await t.prisma.notification.findFirstOrThrow({ where: { userId: requester.id, type: 'sos_status' } });
    expect(note.payload).toMatchObject({ event: 'withdrawn', status: 'created', actor: { id: h1.id } });
    // Dispatch doesn't restart.
    expect(await t.prisma.sosRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'created' });

    await sos(requester).decline(id, responses[1]!).expect(200);
    expect(await t.prisma.notification.count({ where: { userId: h2.id, type: 'sos_status' } })).toBe(1);
    expect((await sos(h2).respond(id).expect(409)).body.error.code).toBe('SOS_INVALID_STATE'); // declined can't re-offer
    expect((await sos(requester).accept(id, responses[1]!).expect(409)).body.error.code).toBe('SOS_INVALID_STATE');
    // Withdrawn can offer again.
    await sos(h1).respond(id).expect(200);
    await sos(requester).accept(id, responses[2]!).expect(200);
    await sos(h3).withdraw(id).expect(200);
    await sos(h3).withdraw(id).expect(409);
    // arrived requires an accepted response
    expect((await sos(requester).arrived(id).expect(409)).body.error.code).toBe('SOS_INVALID_STATE');
    expect((await sos(h1).arrived(id).expect(409)).body.error.code).toBe('SOS_INVALID_STATE'); // only offered
    expect((await sos(requester).close(id).expect(409)).body.error.code).toBe('SOS_INVALID_STATE'); // created
  });

  it('allows up to 3 accepted helpers; the requester marking arrived covers all of them', async () => {
    const { requester, helpers, id, responses } = await scenario(4);
    for (const r of responses.slice(0, 3)) await sos(requester).accept(id, r).expect(200);
    expect((await sos(requester).accept(id, responses[3]!).expect(409)).body.error.code).toBe('SOS_HELPER_LIMIT');
    const chat = await t.prisma.chat.findUniqueOrThrow({ where: { refId: id }, include: { members: true } });
    expect(chat.members).toHaveLength(4);
    const arrived = (await sos(requester).arrived(id).expect(200)).body as SosDto;
    expect(arrived.status).toBe('in_progress');
    expect(arrived.responses.map((r) => r.status)).toEqual(['arrived', 'arrived', 'arrived', 'offered']);
    for (const h of helpers.slice(0, 3)) {
      expect(await t.prisma.notification.count({ where: { userId: h.id, type: 'sos_status', payload: { path: ['event'], equals: 'in_progress' } } })).toBe(1);
    }
    // An arrived helper can't withdraw; cancel still works.
    expect((await sos(helpers[0]!).withdraw(id).expect(409)).body.error.code).toBe('SOS_INVALID_STATE');
    expect((await sos(requester).cancel(id, 'Справился сам').expect(200)).body).toMatchObject({ status: 'cancelled' });
    expect((await t.prisma.sosRequest.findUniqueOrThrow({ where: { id } })).cancelReason).toBe('Справился сам');
  });

  it('a helper can be in at most one active help at a time', async () => {
    const s1 = await scenario(1);
    const helper = s1.helpers[0]!;
    await sos(s1.requester).accept(s1.id, s1.responses[0]!).expect(200);
    // The same helper offers help elsewhere (allowed) but can't be accepted there.
    const requester2 = await userAt(s1.a.near(0.05));
    const id2 = ((await sos(requester2).create(body(s1.a.near(0.05))).expect(201)).body as SosDto).id;
    const r2 = ((await sos(helper).respond(id2).expect(200)).body as SosDto).responses[0]!.id;
    expect((await sos(requester2).accept(id2, r2).expect(409)).body.error.code).toBe('SOS_HELPER_BUSY');
    // Once the first help ends, the helper can be accepted elsewhere.
    await sos(s1.requester).close(s1.id).expect(200);
    await sos(requester2).accept(id2, r2).expect(200);
  });

  it('caps live offers at 10 per SOS and checks helper rating and roles', async () => {
    const a = area();
    const requester = await userAt(a.near(0));
    const id = ((await sos(requester).create(body(a.near(0))).expect(201)).body as SosDto).id;
    const helpers: U[] = [];
    for (let i = 0; i < SOS_LIMITS.maxActiveOffers; i++) {
      const h = await userAt(a.near(0.001 * (i + 1)));
      helpers.push(h);
      await sos(h).respond(id).expect(200);
    }
    const extra = await userAt(a.near(0.02));
    expect((await sos(extra).respond(id).expect(409)).body.error.code).toBe('SOS_OFFER_LIMIT');
    await sos(helpers[0]!).withdraw(id).expect(200);
    await sos(extra).respond(id).expect(200);

    const lowRated = await userAt(a.near(0.02), { rating: 29 });
    expect((await sos(lowRated).respond(id).expect(403)).body.error.code).toBe('RATING_TOO_LOW');
    expect((await sos(requester).respond(id).expect(400)).body.error.code).toBe('INVALID_TARGET');
    expect((await sos(helpers[1]!).respond(id).expect(409)).body.error.code).toBe('SOS_INVALID_STATE'); // already offered
    // Requester-only actions by a helper → 403; unknown response → 404.
    const r = (await sos(helpers[1]!).get(id).expect(200)).body.responses[0].id as string;
    const h = helpers[1]!;
    for (const call of [() => sos(h).accept(id, r), () => sos(h).decline(id, r), () => sos(h).close(id), () => sos(h).cancel(id), () => sos(h).share(id)]) {
      expect((await call().expect(403)).body.error.code).toBe('FORBIDDEN');
    }
    await sos(requester).accept(id, newId()).expect(404);
    // Someone who never offered can't withdraw or mark arrived.
    const stranger = await userAt(a.near(0.03));
    expect((await sos(stranger).withdraw(id).expect(409)).body.error.code).toBe('SOS_INVALID_STATE');
    expect((await sos(stranger).arrived(id).expect(403)).body.error.code).toBe('FORBIDDEN');
  });

  it('cancel from created / accepted, and responders are told', async () => {
    const { requester, helpers, id } = await scenario(2);
    await sos(requester).cancel(id).expect(200);
    for (const h of helpers) {
      expect((await t.prisma.notification.findFirstOrThrow({ where: { userId: h.id, type: 'sos_status' } })).payload).toMatchObject({ status: 'cancelled' });
    }
    expect((await sos(requester).cancel(id).expect(409)).body.error.code).toBe('SOS_INVALID_STATE');
  });
});

describe('contact phone exposure', () => {
  it('follows sharePhone, accepted-helper status and the requester-only helperPhone', async () => {
    for (const sharePhone of [false, true]) {
      const { a, requester, helpers, id, responses } = await scenario(2, { sharePhone });
      const [accepted, offered] = helpers as [U, U];
      const viewer = await userAt(a.near(0.1), { rating: 10 }); // can open the SOS, never dispatched
      const dispatchedOnly = await userAt(a.near(0.004)); // eligible: will be dispatched, never responds
      await t.app.get(SosDispatchService).dispatch(id, 0); // created after the SOS: run a dispatch step again
      expect(await t.prisma.sosDispatch.count({ where: { sosId: id, userId: dispatchedOnly.id } })).toBe(1);
      const requesterPhone = (await t.prisma.user.findUniqueOrThrow({ where: { id: requester.id } })).phone;
      const acceptedPhone = (await t.prisma.user.findUniqueOrThrow({ where: { id: accepted.id } })).phone;
      await sos(requester).accept(id, responses[0]!).expect(200);

      const asViewer = (await sos(viewer).get(id).expect(200)).body as SosDto;
      const asOffered = (await sos(offered).get(id).expect(200)).body as SosDto;
      const asAccepted = (await sos(accepted).get(id).expect(200)).body as SosDto;
      const asRequester = (await sos(requester).get(id).expect(200)).body as SosDto;
      const asDispatched = (await sos(dispatchedOnly).get(id).expect(200)).body as SosDto;
      // sharePhone reaches people asked to help (dispatched) and responders — not every viewer within 20 km.
      expect(asViewer.contactPhone).toBeNull();
      expect(asDispatched.contactPhone).toBe(sharePhone ? requesterPhone : null);
      expect(asOffered.contactPhone).toBe(sharePhone ? requesterPhone : null);
      expect(asAccepted.contactPhone).toBe(requesterPhone);
      expect(asRequester.contactPhone).toBeNull();
      expect(asRequester.responses.map((r) => r.helperPhone)).toEqual([acceptedPhone, null]);
      // Helpers only see their own response, never phones in responses.
      expect(asAccepted.responses).toHaveLength(1);
      expect(asAccepted.responses[0]!.helperPhone).toBeNull();
      expect(asViewer.responses).toEqual([]);
      expect(JSON.stringify(asViewer)).not.toContain(acceptedPhone!);
      expect(JSON.stringify(asViewer)).not.toContain(requesterPhone!);
      if (!sharePhone) expect(JSON.stringify(asOffered)).not.toContain(requesterPhone!);

      // After the end nobody gets a phone.
      await sos(requester).cancel(id).expect(200);
      expect((await sos(accepted).get(id).expect(200)).body.contactPhone).toBeNull();
      expect((await sos(requester).get(id).expect(200)).body.responses.every((r: { helperPhone: string | null }) => r.helperPhone === null)).toBe(true);
    }
  });

  it("hides a hidden-mode helper's distance and shows others' rounded to 100 m", async () => {
    const a = area();
    const requester = await userAt(a.near(0));
    const hidden = await userAt(a.near(0.0123), { privacyMode: 'hidden' });
    const visible = await userAt(a.near(0.0123, 0.001));
    const id = ((await sos(requester).create(body(a.near(0))).expect(201)).body as SosDto).id;
    await sos(hidden).respond(id).expect(200);
    await sos(visible).respond(id).expect(200);
    const view = (await sos(requester).get(id).expect(200)).body as SosDto;
    const byHelper = new Map(view.responses.map((r) => [r.helper.id, r.distanceM]));
    expect(byHelper.get(hidden.id)).toBeNull();
    expect(byHelper.get(visible.id)! % 100).toBe(0);
    expect(byHelper.get(visible.id)).toBeGreaterThan(1000);
  });
});

describe('lists', () => {
  it('active, nearby, map and history', async () => {
    const a = area();
    const me = await userAt(a.near(0));
    const other = await userAt(a.near(0.05));
    const far = await userAt(a.near(0.5));
    const mine = ((await sos(me).create(body(a.near(0))).expect(201)).body as SosDto).id;
    const theirs = ((await sos(other).create(body(a.near(0.05), { type: 'battery' })).expect(201)).body as SosDto).id;
    const farSos = ((await sos(far).create(body(a.near(0.5))).expect(201)).body as SosDto).id;
    await sos(me).respond(theirs).expect(200);

    expect(((await sos(me).active().expect(200)).body as SosDto[]).map((s) => s.id).sort()).toEqual([mine, theirs].sort());
    const near = (await sos(me).nearby(a.lat, a.lng).expect(200)).body as SosDto[]; // hint = stored location
    expect(near.map((s) => s.id)).toEqual([theirs]); // not mine, not >20 km
    expect(near[0]!.distanceM).toBeGreaterThan(5000);
    await request(t.http).get('/api/v1/sos/nearby?lat=x&lng=1').set(bearer(me.token)).expect(400);

    // map/sos: bbox semantics, but only SOS within 20 km of my stored location (farSos is ~60 km away).
    const bbox = `${a.lng - 0.1},${a.lat - 0.1},${a.lng + 0.6},${a.lat + 0.6}`;
    const map = (await sos(me).map(bbox).expect(200)).body.items as { id: string; type: string }[];
    expect(map.map((i) => i.id)).toEqual([theirs]);
    expect(Object.keys(map[0]!).sort()).toEqual(['createdAt', 'id', 'lat', 'lng', 'status', 'type']);
    expect((await sos(me).map('0,0,3,3').expect(400)).body.error.code).toBe('BBOX_TOO_LARGE');
    expect(((await sos(far).map(bbox).expect(200)).body.items as { id: string }[]).map((i) => i.id)).toEqual([]); // far's own is excluded, others > 20 km
    await sos(other).cancel(theirs).expect(200);
    expect((await sos(me).map(bbox).expect(200)).body.items).toEqual([]);

    const hist = await sos(me).history('?limit=1').expect(200);
    const hist2 = await sos(me).history(`?limit=1&cursor=${hist.body.nextCursor}`).expect(200);
    expect([...hist.body.items, ...hist2.body.items].map((s: SosDto) => s.id).sort()).toEqual([mine, theirs].sort());
    expect(hist2.body.nextCursor).toBeNull();
  });
});

describe('share link', () => {
  it('works while open and until 1 h after the end, then 404; rotates; rate limited per IP', async () => {
    const { requester, helpers, id, responses } = await scenario(1);
    await sos(requester).accept(id, responses[0]!).expect(200);
    const first = (await sos(requester).share(id).expect(200)).body.url as string;
    expect(first).toMatch(/^http:\/\/localhost:3000\/s\/[A-Za-z0-9_-]{43}$/);
    const token = first.split('/s/')[1]!;
    const stored = await t.prisma.sosRequest.findUniqueOrThrow({ where: { id } });
    expect(stored.shareToken).not.toContain(token); // hashed

    const ip = nextIp();
    const pub = await request(t.http).get(`/api/v1/public/sos/${token}`).set('X-Forwarded-For', ip).expect(200);
    const helperNick = (await t.prisma.user.findUniqueOrThrow({ where: { id: helpers[0]!.id } })).nickname;
    expect(pub.body).toEqual({
      type: 'flat_tire',
      status: 'accepted',
      lat: expect.any(Number),
      lng: expect.any(Number),
      requesterName: 'Айгерим',
      helperNickname: helperNick,
      helperNicknames: [helperNick],
      updatedAt: expect.any(String),
    });
    expect(JSON.stringify(pub.body)).not.toContain('Касымова');

    // Rotation: a new link invalidates the old one.
    const second = (await sos(requester).share(id).expect(200)).body.url as string;
    await request(t.http).get(`/api/v1/public/sos/${token}`).set('X-Forwarded-For', ip).expect(404);
    const token2 = second.split('/s/')[1]!;

    await sos(requester).close(id).expect(200);
    await request(t.http).get(`/api/v1/public/sos/${token2}`).set('X-Forwarded-For', ip).expect(200);
    expect((await sos(requester).share(id).expect(409)).body.error.code).toBe('SOS_INVALID_STATE');
    await t.prisma.sosRequest.update({ where: { id }, data: { closedAt: new Date(Date.now() - 61 * 60_000) } });
    await request(t.http).get(`/api/v1/public/sos/${token2}`).set('X-Forwarded-For', ip).expect(404);
    await request(t.http).get('/api/v1/public/sos/not-a-token').set('X-Forwarded-For', ip).expect(404);

    const flood = nextIp();
    for (let i = 0; i < SOS_LIMITS.publicPerMinute; i++) await request(t.http).get(`/api/v1/public/sos/${'a'.repeat(43)}`).set('X-Forwarded-For', flood).expect(404);
    const limited = await request(t.http).get(`/api/v1/public/sos/${token2}`).set('X-Forwarded-For', flood).expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('friendship and SosDto', () => {
  it('renders the requester with the viewer relation (plate only for friends)', async () => {
    const a = area();
    const requester = await userAt(a.near(0));
    await t.prisma.vehicle.create({ data: { id: newId(), userId: requester.id, brand: 'Kia', model: 'Rio', year: 2018, plate: '123ABC02', isPrimary: true } });
    const friend = await userAt(a.near(0.01));
    const stranger = await userAt(a.near(0.01));
    await makeFriends(t, requester.id, friend.id);
    const id = ((await sos(requester).create(body(a.near(0))).expect(201)).body as SosDto).id;
    expect((await sos(friend).get(id).expect(200)).body.requester).toMatchObject({ relation: 'friend', primaryVehicle: { plate: '123ABC02' } });
    expect((await sos(stranger).get(id).expect(200)).body.requester).toMatchObject({ relation: 'none', primaryVehicle: { plate: null } });
  });
});

describe('SOS hardening (Phase 5)', () => {
  it('nearby uses the stored fresh location; hints only within 1 km; 409 LOCATION_REQUIRED otherwise', async () => {
    const a = area();
    const requester = await userAt(a.near(0));
    const id = ((await sos(requester).create(body(a.near(0))).expect(201)).body as SosDto).id;
    const noLoc = await userAt(null);
    expect((await request(t.http).get('/api/v1/sos/nearby').set(bearer(noLoc.token)).expect(409)).body.error.code).toBe('LOCATION_REQUIRED');
    const stale = await userAt(null);
    await setLocation(t, stale.id, a.lat, a.lng, 16);
    expect((await sos(stale).nearby(a.lat, a.lng).expect(409)).body.error.code).toBe('LOCATION_REQUIRED');

    const viewer = await userAt(a.near(0.05)); // ~5.6 km away
    const plain = (await request(t.http).get('/api/v1/sos/nearby').set(bearer(viewer.token)).expect(200)).body as SosDto[];
    expect(plain.map((x) => x.id)).toEqual([id]);
    const fromStored = plain[0]!.distanceM!;
    // A hint 500 m from the stored location is used as the origin.
    const hint = a.near(0.0545);
    const hinted = (await sos(viewer).nearby(hint.lat, hint.lng).expect(200)).body as SosDto[];
    expect(hinted[0]!.distanceM).toBeGreaterThan(fromStored + 400);
    // A far hint (right next to another SOS 100 km away) is ignored.
    const elsewhere = await userAt(a.near(0.9));
    await sos(elsewhere).create(body(a.near(0.9))).expect(201);
    const far = a.near(0.9);
    const spoofed = (await sos(viewer).nearby(far.lat, far.lng).expect(200)).body as SosDto[];
    expect(spoofed.map((x) => x.id)).toEqual([id]);
    expect(spoofed[0]!.distanceM).toBe(fromStored);
  });

  it('map/sos is empty without a stored location', async () => {
    const a = area();
    const requester = await userAt(a.near(0));
    await sos(requester).create(body(a.near(0))).expect(201);
    const noLoc = await userAt(null);
    expect((await sos(noLoc).map(`${a.lng - 0.5},${a.lat - 0.5},${a.lng + 0.5},${a.lat + 0.5}`).expect(200)).body.items).toEqual([]);
  });
});

describe('location trust and SOS visibility (review H1)', () => {
  const put = (u: U, p: { lat: number; lng: number }) => request(t.http).put('/api/v1/me/location').set(bearer(u.token)).send(p);
  /** Pretend the previous update happened `sec` seconds ago and lift the 10 s throttle. */
  const age = async (u: U, sec: number) => {
    await t.prisma.$executeRaw`UPDATE user_locations SET updated_at = now() - make_interval(secs => ${sec}::float8) WHERE user_id = ${u.id}::uuid`;
    await t.redis.del(`loc:throttle:${u.id}`);
  };

  it('marks implausible jumps (> 300 km/h) untrusted for 10 min; untrusted positions see and get nothing', async () => {
    const a = area();
    const requester = await userAt(a.near(0));
    const id = ((await sos(requester).create(body(a.near(0))).expect(201)).body as SosDto).id;

    const driver = await userAt(null);
    await put(driver, a.near(0.5)).expect(204); // ~55 km away
    await age(driver, 60);
    await put(driver, a.near(0.6)).expect(204); // 11 km in 60 s ≈ 667 km/h → untrusted
    const row = await t.prisma.userLocation.findUniqueOrThrow({ where: { userId: driver.id } });
    expect(row.untrustedUntil!.getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);

    const teleporter = await userAt(null);
    await put(teleporter, a.near(5)).expect(204); // far away
    await age(teleporter, 30);
    await put(teleporter, a.near(0.01)).expect(204); // ~550 km in 30 s: right next to the SOS, untrusted
    expect((await sos(teleporter).nearby().expect(409)).body.error.code).toBe('LOCATION_REQUIRED');
    await sos(teleporter).get(id).expect(404);
    expect((await sos(teleporter).map(`${a.lng - 0.1},${a.lat - 0.1},${a.lng + 0.1},${a.lat + 0.1}`).expect(200)).body.items).toEqual([]);
    expect(await t.app.get(SosDispatchService).dispatch(id, 2)).not.toContain(teleporter.id);

    // A plausible move (5.5 km in 10 min ≈ 33 km/h) stays trusted; once the mark expires the position counts.
    const commuter = await userAt(null);
    await put(commuter, a.near(0.06)).expect(204);
    await age(commuter, 600);
    await put(commuter, a.near(0.01)).expect(204);
    expect((await t.prisma.userLocation.findUniqueOrThrow({ where: { userId: commuter.id } })).untrustedUntil).toBeNull();
    await sos(commuter).get(id).expect(200);
    await t.prisma.userLocation.update({ where: { userId: teleporter.id }, data: { untrustedUntil: new Date(Date.now() - 1000) } });
    await sos(teleporter).get(id).expect(200);
  });

  it('non-participants see only open SOS near a fresh position; participants keep access', async () => {
    const { requester, helpers, id, responses } = await scenario(1);
    const bystander = await userAt(null);
    const p = await t.prisma.$queryRaw<{ lat: number; lng: number }[]>`SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng FROM sos_requests WHERE id = ${id}::uuid`;
    await setLocation(t, bystander.id, p[0]!.lat + 0.05, p[0]!.lng, 16); // stale
    await sos(bystander).get(id).expect(404);
    await setLocation(t, bystander.id, p[0]!.lat + 0.05, p[0]!.lng, 1); // fresh
    await sos(bystander).get(id).expect(200);
    await sos(requester).accept(id, responses[0]!).expect(200);
    await sos(requester).close(id).expect(200);
    await sos(bystander).get(id).expect(404); // closed: participants only
    await sos(helpers[0]!).get(id).expect(200);
    await sos(requester).get(id).expect(200);
  });

  it('rate limits /sos/nearby and /map/sos to 60/min per user', async () => {
    const a = area();
    const u = await userAt(a.near(0));
    const now = Date.now();
    for (const key of [`rl:sos-nearby:${u.id}`, `rl:sos-map:${u.id}`]) {
      await t.redis.zadd(key, ...Array.from({ length: 60 }, (_, i) => [now - i, `m${i}`]).flat());
    }
    expect((await sos(u).nearby().expect(429)).body.error.code).toBe('RATE_LIMITED');
    expect((await sos(u).map(`${a.lng},${a.lat},${a.lng + 0.1},${a.lat + 0.1}`).expect(429)).body.error.code).toBe('RATE_LIMITED');
  });
});

describe('account deletion and SOS (review M2)', () => {
  it('cancels the open SOS, withdraws live helps and anonymizes the user in every notification', async () => {
    const s1 = await scenario(1); // the leaver is s1's accepted helper
    const leaver = s1.helpers[0]!;
    await t.prisma.user.update({ where: { id: leaver.id }, data: { name: 'Secret Helpername' } });
    await sos(s1.requester).accept(s1.id, s1.responses[0]!).expect(200);
    // The leaver's own open SOS, with someone offering help.
    const helperOfLeaver = await userAt(s1.a.near(0.03));
    const own = ((await sos(leaver).create(body(s1.a.near(0.02))).expect(201)).body as SosDto).id;
    await sos(helperOfLeaver).respond(own).expect(200);

    await request(t.http).delete('/api/v1/me').set(bearer(leaver.token)).send({ confirm: 'DELETE' }).expect(204);

    expect(await t.prisma.sosRequest.findUniqueOrThrow({ where: { id: own } })).toMatchObject({ status: 'cancelled', cancelReason: 'account_deleted' });
    expect((await t.prisma.notification.findFirstOrThrow({ where: { userId: helperOfLeaver.id, type: 'sos_status' } })).payload).toMatchObject({ status: 'cancelled' });
    expect(await t.prisma.sosRequest.findUniqueOrThrow({ where: { id: s1.id } })).toMatchObject({ status: 'created' });
    const resp = await t.prisma.sosResponse.findFirstOrThrow({ where: { sosId: s1.id, helperId: leaver.id } });
    expect(resp.status).toBe('withdrawn');
    const toRequester = await t.prisma.notification.findMany({ where: { userId: s1.requester.id } });
    // s1's requester was also dispatched to the leaver's own SOS (sos_nearby, actor under `requester`).
    expect(toRequester.map((n) => n.type).sort()).toEqual(['sos_nearby', 'sos_response', 'sos_status']);
    expect(JSON.stringify(await t.prisma.notification.findMany())).not.toContain('Secret Helpername');
    for (const n of toRequester) {
      const p = n.payload as { helper?: { name: string }; actor?: { name: string }; requester?: { name: string } };
      expect((p.helper ?? p.actor ?? p.requester)!.name).toBe('Deleted user');
    }
  });
});

describe('review nits', () => {
  it('an SOS ban also blocks responding', async () => {
    const { a, id } = await scenario(0);
    const banned = await userAt(a.near(0.01));
    const until = new Date(Date.now() + 3600_000);
    await t.prisma.user.update({ where: { id: banned.id }, data: { sosBannedUntil: until } });
    expect((await sos(banned).respond(id).expect(403)).body.error).toMatchObject({ code: 'SOS_BANNED', details: { until: until.toISOString() } });
  });

  it('system messages cannot be deleted; the SOS chat turns read-only 24 h after the end', async () => {
    const { requester, helpers, id, responses } = await scenario(1);
    const chatId = ((await sos(requester).accept(id, responses[0]!).expect(200)).body as SosDto).chatId!;
    const sys = await t.prisma.message.findFirstOrThrow({ where: { chatId, type: 'system' } });
    expect((await request(t.http).delete(`/api/v1/chats/${chatId}/messages/${sys.id}`).set(bearer(requester.token)).expect(403)).body.error.code).toBe('FORBIDDEN');
    await sos(requester).close(id).expect(200);
    const say = (u: U) => request(t.http).post(`/api/v1/chats/${chatId}/messages`).set(bearer(u.token)).send({ type: 'text', text: 'спасибо' });
    await say(helpers[0]!).expect(201); // still within 24 h of the end
    await t.prisma.sosRequest.update({ where: { id }, data: { closedAt: new Date(Date.now() - 25 * 3600_000) } });
    expect((await say(requester).expect(403)).body.error.code).toBe('CHAT_READ_ONLY');
    await request(t.http).get(`/api/v1/chats/${chatId}/messages`).set(bearer(requester.token)).expect(200); // still readable
  });
});
