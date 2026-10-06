import { EVENT_LIMITS, type ChatDto, type EventDto, type EventMapResult, type Paginated } from '@autoc/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../src/common/ids';
import { EventsQueue as EventsQueueToken } from '../src/modules/events/events.queue';
import { WebPushSender } from '../src/modules/push/web-push.sender';
import { bearer, createCommunity, createTestApp, createUser, setLocation, waitFor, type TestApp } from './support/app';
import { FakePushSender } from './support/fake-push-sender';

/** Reminders go out 60 s before the start, so an event starting in 62 s is reminded after ~2 s. */
const LEAD_MS = 60_000;
const sender = new FakePushSender();
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ EVENT_REMINDER_LEAD_MS: String(LEAD_MS) }, [{ provide: WebPushSender, useValue: sender }]);
});
afterAll(async () => {
  await t.close();
});
beforeEach(() => sender.reset());

type U = { id: string; token: string };
const HOUR = 3600_000;
const inHours = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const ROUTE: [number, number][] = [
  [76.95, 43.24],
  [77.0, 43.2],
  [77.08, 43.15],
];

const body = (over: Record<string, unknown> = {}) => ({
  title: 'Встреча клуба',
  description: 'Пьём кофе, обсуждаем ТО',
  place: 'Парковка у Достык Плазы',
  lat: 43.2333,
  lng: 76.9566,
  startsAt: inHours(24),
  ...over,
});

const api = (u: U) => ({
  create: (communityId: string, b: object = body()) => request(t.http).post(`/api/v1/communities/${communityId}/events`).set(bearer(u.token)).send(b),
  get: (id: string) => request(t.http).get(`/api/v1/events/${id}`).set(bearer(u.token)),
  patch: (id: string, b: object) => request(t.http).patch(`/api/v1/events/${id}`).set(bearer(u.token)).send(b),
  del: (id: string) => request(t.http).delete(`/api/v1/events/${id}`).set(bearer(u.token)),
  rsvp: (id: string, status: string) => request(t.http).post(`/api/v1/events/${id}/rsvp`).set(bearer(u.token)).send({ status }),
  list: (q = '') => request(t.http).get(`/api/v1/events${q}`).set(bearer(u.token)),
  communityList: (cid: string, q = '') => request(t.http).get(`/api/v1/communities/${cid}/events${q}`).set(bearer(u.token)),
  participants: (id: string, q = '') => request(t.http).get(`/api/v1/events/${id}/participants${q}`).set(bearer(u.token)),
  map: (bbox: string) => request(t.http).get(`/api/v1/map/events?bbox=${bbox}`).set(bearer(u.token)),
  chats: () => request(t.http).get('/api/v1/chats').set(bearer(u.token)),
});

async function subscribe(u: U): Promise<string> {
  const endpoint = `https://fcm.googleapis.com/fcm/send/ev-${newId()}`;
  await request(t.http)
    .post('/api/v1/push/subscriptions')
    .set(bearer(u.token))
    .send({ endpoint, keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } })
    .expect(204);
  return endpoint;
}

/** An event row written directly (for past events and fixed timestamps). */
async function insertEvent(communityId: string, createdById: string, startsAt: Date, opts: { endsAt?: Date | null; lat?: number; lng?: number; title?: string } = {}) {
  const id = newId();
  await t.prisma.$executeRaw`
    INSERT INTO events (id, community_id, created_by_id, title, place, location, starts_at, ends_at, updated_at)
    VALUES (${id}::uuid, ${communityId}::uuid, ${createdById}::uuid, ${opts.title ?? 'Событие'}, 'Место',
            ST_SetSRID(ST_MakePoint(${opts.lng ?? 76.95}::float8, ${opts.lat ?? 43.24}::float8), 4326)::geography,
            ${startsAt}, ${opts.endsAt ?? null}, now())`;
  return id;
}

/** owner, moderator, member, outsider and a community with all of them (private or public). */
async function cast(isPrivate: boolean) {
  const [owner, mod, member, outsider] = await Promise.all([createUser(t), createUser(t), createUser(t), createUser(t)]);
  const communityId = await createCommunity(t, owner.id, [{ userId: mod.id, role: 'moderator' }, { userId: member.id }], { isPrivate });
  return { owner, mod, member, outsider, communityId };
}

describe('events: permissions matrix', () => {
  for (const isPrivate of [false, true]) {
    it(`${isPrivate ? 'private' : 'public'} community: create / read / edit / delete per role`, async () => {
      const { owner, mod, member, outsider, communityId } = await cast(isPrivate);

      // create: owner and moderators only
      const created = (await api(owner).create(communityId).expect(201)).body as EventDto;
      expect(created).toMatchObject({ title: 'Встреча клуба', goingCount: 0, interestedCount: 0, myRsvp: null, chatId: null, canManage: true, route: null, endsAt: null });
      expect(created.community).toMatchObject({ id: communityId, isPrivate });
      expect(created.createdBy.id).toBe(owner.id);
      const byMod = (await api(mod).create(communityId, body({ title: 'От модератора' })).expect(201)).body as EventDto;
      await api(member).create(communityId).expect(403);
      await api(outsider).create(communityId).expect(403);

      // read: public → everyone; private → active members only (404 otherwise)
      expect(((await api(member).get(created.id).expect(200)).body as EventDto).canManage).toBe(false);
      if (isPrivate) {
        await api(outsider).get(created.id).expect(404);
        await api(outsider).participants(created.id).expect(404);
        await api(outsider).rsvp(created.id, 'going').expect(404);
        await api(outsider).communityList(communityId).expect(403);
        await api(outsider).list(`?communityId=${communityId}`).expect(403);
        const all = (await api(outsider).list().expect(200)).body as Paginated<EventDto>;
        expect(all.items.map((e) => e.id)).not.toContain(created.id);
      } else {
        expect(((await api(outsider).get(created.id).expect(200)).body as EventDto).canManage).toBe(false);
        expect(((await api(outsider).communityList(communityId).expect(200)).body as Paginated<EventDto>).items).toHaveLength(2);
      }

      // edit: creator or community moderators; others 403 (404 when they can't see it)
      expect(((await api(mod).patch(created.id, { title: 'Правка модератора' }).expect(200)).body as EventDto).title).toBe('Правка модератора');
      expect(((await api(owner).patch(byMod.id, { place: 'Мега Парк' }).expect(200)).body as EventDto).place).toBe('Мега Парк');
      await api(member).patch(created.id, { title: 'Нельзя' }).expect(403);
      await api(outsider).patch(created.id, { title: 'Нельзя' }).expect(isPrivate ? 404 : 403);

      // a demoted creator keeps the right to manage their own event
      await t.prisma.communityMember.update({ where: { communityId_userId: { communityId, userId: mod.id } }, data: { role: 'member' } });
      expect(((await api(mod).get(byMod.id).expect(200)).body as EventDto).canManage).toBe(true);
      await api(mod).patch(created.id, { title: 'Уже не модератор' }).expect(403);

      // delete
      await api(member).del(created.id).expect(403);
      await api(outsider).del(created.id).expect(isPrivate ? 404 : 403);
      await api(mod).del(byMod.id).expect(204);
      await api(owner).del(created.id).expect(204);
      await api(owner).get(created.id).expect(404);
      await api(owner).del(created.id).expect(404);
    });
  }

  it('deleted community: events disappear; unknown ids → 404', async () => {
    const { owner, member, communityId } = await cast(false);
    const ev = (await api(owner).create(communityId).expect(201)).body as EventDto;
    await t.prisma.community.update({ where: { id: communityId }, data: { deletedAt: new Date() } });
    await api(member).get(ev.id).expect(404);
    await api(owner).create(communityId).expect(404);
    await api(owner).get(newId()).expect(404);
    await api(owner).get('nope').expect(400);
  });
});

describe('events: validation', () => {
  it('rejects bad fields and times', async () => {
    const { owner, communityId } = await cast(false);
    const bad = [
      body({ title: 'ab' }),
      body({ title: 'x'.repeat(101) }),
      body({ place: 'x' }),
      body({ description: 'x'.repeat(2001) }),
      body({ lat: 91 }),
      body({ lat: '43.2' }),
      body({ startsAt: new Date(Date.now() - 60_000).toISOString() }),
      body({ startsAt: new Date(Date.now() + 366 * 24 * HOUR).toISOString() }),
      body({ startsAt: 'tomorrow' }),
      body({ startsAt: inHours(5), endsAt: inHours(4) }),
      body({ route: [[76.9, 43.2]] }),
      body({ route: Array.from({ length: 201 }, (_, i) => [76.9 + i / 1000, 43.2]) }),
      body({ route: [[200, 43.2], [76.9, 43.2]] }),
    ];
    for (const b of bad) expect((await api(owner).create(communityId, b).expect(400)).body.error.code).toBe('VALIDATION_ERROR');

    const ok = (await api(owner).create(communityId, body({ endsAt: inHours(27), route: ROUTE })).expect(201)).body as EventDto;
    expect(ok.route).toEqual(ROUTE);
    // PATCH re-checks the merged times
    await api(owner).patch(ok.id, { endsAt: inHours(23) }).expect(400);
    await api(owner).patch(ok.id, { startsAt: new Date(Date.now() - 1000).toISOString() }).expect(400);
    await api(owner).patch(ok.id, { startsAt: inHours(30) }).expect(400); // after endsAt
    const moved = (await api(owner).patch(ok.id, { startsAt: inHours(30), endsAt: inHours(32), route: null, lat: 43.3, lng: 77.0 }).expect(200)).body as EventDto;
    expect(moved).toMatchObject({ route: null, lat: 43.3, lng: 77.0 });
    expect(new Date(moved.startsAt).getTime()).toBeGreaterThan(Date.now() + 29 * HOUR);
  });
});

describe('events: RSVP and the event chat', () => {
  it('going joins the lazily created event chat; interested / none leave it', async () => {
    const { owner, member, outsider, communityId } = await cast(false);
    const ev = (await api(owner).create(communityId).expect(201)).body as EventDto;
    expect(await t.prisma.chat.count({ where: { refId: ev.id } })).toBe(0);

    const going = (await api(member).rsvp(ev.id, 'going').expect(200)).body as EventDto;
    expect(going).toMatchObject({ myRsvp: 'going', goingCount: 1, interestedCount: 0 });
    expect(going.chatId).toBeTruthy();
    const chats = (await api(member).chats().expect(200)).body as Paginated<ChatDto>;
    expect(chats.items.find((c) => c.id === going.chatId)).toMatchObject({ type: 'event', refId: ev.id, title: 'Встреча клуба' });
    // the same chat for everyone; an outsider of a public community may join too
    const outsiderGoing = (await api(outsider).rsvp(ev.id, 'going').expect(200)).body as EventDto;
    expect(outsiderGoing.chatId).toBe(going.chatId);
    expect(outsiderGoing.goingCount).toBe(2);
    // repeated RSVP is a no-op
    expect(((await api(member).rsvp(ev.id, 'going').expect(200)).body as EventDto).goingCount).toBe(2);
    // others don't see the chat id
    expect(((await api(owner).get(ev.id).expect(200)).body as EventDto).chatId).toBeNull();

    // messages in the event chat; the community moderator may delete them
    const msg = (await request(t.http).post(`/api/v1/chats/${going.chatId}/messages`).set(bearer(member.token)).send({ type: 'text', text: 'Буду в 10' }).expect(201)).body;
    await request(t.http).post(`/api/v1/chats/${going.chatId}/messages`).set(bearer(owner.token)).send({ type: 'text', text: 'x' }).expect(404);
    await api(owner).rsvp(ev.id, 'going').expect(200);
    await request(t.http).delete(`/api/v1/chats/${going.chatId}/messages/${msg.id}`).set(bearer(outsider.token)).expect(403);
    await request(t.http).delete(`/api/v1/chats/${going.chatId}/messages/${msg.id}`).set(bearer(owner.token)).expect(204);

    const interested = (await api(member).rsvp(ev.id, 'interested').expect(200)).body as EventDto;
    expect(interested).toMatchObject({ myRsvp: 'interested', goingCount: 2, interestedCount: 1, chatId: null });
    await request(t.http).get(`/api/v1/chats/${going.chatId}`).set(bearer(member.token)).expect(404);
    const none = (await api(outsider).rsvp(ev.id, 'none').expect(200)).body as EventDto;
    expect(none).toMatchObject({ myRsvp: null, goingCount: 1 });
    expect(await t.prisma.chatMember.count({ where: { chatId: going.chatId! } })).toBe(1);

    const parts = (await api(outsider).participants(ev.id).expect(200)).body as Paginated<{ user: { id: string }; status: string }>;
    expect(parts.items.map((p) => [p.user.id, p.status])).toEqual([
      [member.id, 'interested'],
      [owner.id, 'going'],
    ]);
    const onlyGoing = (await api(outsider).participants(ev.id, '?status=going&limit=1').expect(200)).body as Paginated<{ user: { id: string } }>;
    expect(onlyGoing.items.map((p) => p.user.id)).toEqual([owner.id]);
    expect(onlyGoing.nextCursor).toBeNull();

    // deleting the event deletes its chat
    await api(owner).del(ev.id).expect(204);
    expect(await t.prisma.chat.count({ where: { id: going.chatId! } })).toBe(0);
    await api(member).rsvp(newId(), 'going').expect(404);
    await api(member).rsvp(ev.id, 'maybe').expect(400);
  });

  it('ended events refuse RSVP (409 EVENT_ENDED)', async () => {
    const { owner, member, communityId } = await cast(false);
    const ended = await insertEvent(communityId, owner.id, new Date(Date.now() - 5 * HOUR));
    const running = await insertEvent(communityId, owner.id, new Date(Date.now() - HOUR)); // default 3 h duration
    const endedExplicit = await insertEvent(communityId, owner.id, new Date(Date.now() - 2 * HOUR), { endsAt: new Date(Date.now() - 60_000) });
    expect((await api(member).rsvp(ended, 'going').expect(409)).body.error.code).toBe('EVENT_ENDED');
    expect((await api(member).rsvp(endedExplicit, 'interested').expect(409)).body.error.code).toBe('EVENT_ENDED');
    await api(member).rsvp(running, 'going').expect(200);
  });

  it(`caps going at ${EVENT_LIMITS.maxGoing} (409 EVENT_FULL), also under concurrency`, async () => {
    const { owner, communityId } = await cast(false);
    const ev = (await api(owner).create(communityId).expect(201)).body as EventDto;
    await t.prisma.event.update({ where: { id: ev.id }, data: { goingCount: EVENT_LIMITS.maxGoing - 1 } });
    const users = await Promise.all(Array.from({ length: 4 }, () => createUser(t)));
    const results = await Promise.all(users.map((u) => api(u).rsvp(ev.id, 'going')));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409]);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'EVENT_FULL')).toBe(true);
    expect((await t.prisma.event.findUniqueOrThrow({ where: { id: ev.id } })).goingCount).toBe(EVENT_LIMITS.maxGoing);
    // interested is still possible when full
    await api(users[1]!).rsvp(ev.id, 'interested').expect(200);
  });
});

describe('events: lists and the map', () => {
  it('upcoming asc / past desc with keyset pagination; private communities filtered', async () => {
    const viewer = await createUser(t);
    const owner = await createUser(t);
    const pub = await createCommunity(t, owner.id, [], { isPrivate: false });
    const priv = await createCommunity(t, owner.id, [], { isPrivate: true });
    const mine = await createCommunity(t, owner.id, [{ userId: viewer.id }], { isPrivate: true });
    const soon = await insertEvent(pub, owner.id, new Date(Date.now() + 2 * HOUR));
    const later = await insertEvent(mine, owner.id, new Date(Date.now() + 5 * HOUR));
    const hidden = await insertEvent(priv, owner.id, new Date(Date.now() + 3 * HOUR));
    const latest = await insertEvent(pub, owner.id, new Date(Date.now() + 50 * HOUR));
    const past1 = await insertEvent(pub, owner.id, new Date(Date.now() - 10 * HOUR));
    const past2 = await insertEvent(mine, owner.id, new Date(Date.now() - 30 * HOUR));

    const ids = async (q: string) => {
      const out: string[] = [];
      let cursor: string | null = null;
      do {
        const page = (await api(viewer).list(`${q}${q ? '&' : '?'}limit=2${cursor ? `&cursor=${cursor}` : ''}`).expect(200)).body as Paginated<EventDto>;
        out.push(...page.items.map((e) => e.id));
        cursor = page.nextCursor;
      } while (cursor);
      return out;
    };
    const upcoming = await ids('');
    expect(upcoming.filter((id) => [soon, later, hidden, latest].includes(id))).toEqual([soon, later, latest]);
    const past = await ids('?scope=past');
    expect(past.filter((id) => [past1, past2].includes(id))).toEqual([past1, past2]);
    expect(await ids(`?communityId=${mine}`)).toEqual([later]);
    expect(((await api(viewer).communityList(mine, '?scope=past').expect(200)).body as Paginated<EventDto>).items.map((e) => e.id)).toEqual([past2]);
    await api(viewer).list('?scope=soon').expect(400);
  });

  it('/map/events: visible, upcoming within 7 days, inside the bbox; distance from the stored position', async () => {
    const viewer = await createUser(t);
    const owner = await createUser(t);
    const pub = await createCommunity(t, owner.id, [], { isPrivate: false });
    const priv = await createCommunity(t, owner.id, [], { isPrivate: true });
    const inBox = await insertEvent(pub, owner.id, new Date(Date.now() + 24 * HOUR), { lat: 10.01, lng: 20.01, title: 'В рамке' });
    await insertEvent(pub, owner.id, new Date(Date.now() + 8 * 24 * HOUR), { lat: 10.02, lng: 20.02 }); // too far ahead
    await insertEvent(pub, owner.id, new Date(Date.now() - 5 * HOUR), { lat: 10.02, lng: 20.02 }); // over
    await insertEvent(priv, owner.id, new Date(Date.now() + 24 * HOUR), { lat: 10.03, lng: 20.03 }); // private
    await insertEvent(pub, owner.id, new Date(Date.now() + 24 * HOUR), { lat: 11, lng: 21 }); // outside
    const res = (await api(viewer).map('19.9,9.9,20.1,10.1').expect(200)).body as EventMapResult;
    expect(res.truncated).toBe(false);
    expect(res.items).toEqual([expect.objectContaining({ id: inBox, title: 'В рамке', lat: 10.01, lng: 20.01, goingCount: 0, myRsvp: null })]);
    await api(viewer).map('nope').expect(400);

    expect(((await api(viewer).get(inBox).expect(200)).body as EventDto).distanceM).toBeNull();
    await setLocation(t, viewer.id, 10.01, 20.02);
    const d = ((await api(viewer).get(inBox).expect(200)).body as EventDto).distanceM!;
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThan(1200);
  });
});

describe('events: notifications', () => {
  it('event_new to active members (push only to those who RSVPed in the community lately); change and cancel notices', async () => {
    const owner = await createUser(t);
    const engaged = await createUser(t, { locale: 'en' });
    const quiet = await createUser(t);
    const pending = await createUser(t);
    const communityId = await createCommunity(t, owner.id, [{ userId: engaged.id }, { userId: quiet.id }, { userId: pending.id, status: 'pending' }]);
    const engagedEp = await subscribe(engaged);
    await subscribe(quiet);
    // engaged RSVPed to an earlier event of this community
    const earlier = await insertEvent(communityId, owner.id, new Date(Date.now() + 10 * HOUR));
    await api(engaged).rsvp(earlier, 'interested').expect(200);

    const ev = (await api(owner).create(communityId, body({ title: 'Ночной заезд' })).expect(201)).body as EventDto;
    await waitFor(async () => (await t.prisma.notification.count({ where: { type: 'event_new', payload: { path: ['eventId'], equals: ev.id } } })) === 2);
    const rows = await t.prisma.notification.findMany({ where: { type: 'event_new', payload: { path: ['eventId'], equals: ev.id } }, select: { userId: true, payload: true } });
    expect(rows.map((r) => r.userId).sort()).toEqual([engaged.id, quiet.id].sort());
    expect(rows[0]!.payload).toMatchObject({ eventId: ev.id, communityId, title: 'Ночной заезд', place: 'Парковка у Достык Плазы' });
    await waitFor(() => sender.sent.length >= 1);
    await new Promise((r) => setTimeout(r, 300));
    expect(sender.sent.map((s) => s.endpoint)).toEqual([engagedEp]);
    expect(sender.sent[0]!.payload).toMatchObject({ title: 'New event', url: `/events/${ev.id}` });

    // participants get change notices; the actor doesn't
    await api(engaged).rsvp(ev.id, 'going').expect(200);
    await api(quiet).rsvp(ev.id, 'interested').expect(200);
    await t.prisma.notification.deleteMany({});
    sender.reset();
    await api(owner).patch(ev.id, { startsAt: inHours(48) }).expect(200);
    await waitFor(async () => (await t.prisma.notification.count({ where: { type: 'event_new' } })) === 2);
    const notices = await t.prisma.notification.findMany({ where: { type: 'event_new' } });
    expect(notices.every((n) => (n.payload as { change?: string }).change === 'updated')).toBe(true);
    // a PATCH that changes nothing sends nothing
    await api(owner).patch(ev.id, { title: 'Ночной заезд' }).expect(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(await t.prisma.notification.count({ where: { type: 'event_new' } })).toBe(2);

    await t.prisma.notification.deleteMany({});
    await api(engaged).del(ev.id).expect(403);
    await api(owner).del(ev.id).expect(204);
    const cancelled = await t.prisma.notification.findMany({ where: { type: 'event_new' } });
    expect(cancelled.map((n) => n.userId).sort()).toEqual([engaged.id, quiet.id].sort());
    expect(cancelled.every((n) => (n.payload as { change?: string }).change === 'cancelled')).toBe(true);
  });
});

describe('events: reminders (BullMQ delayed jobs)', () => {
  const remindersFor = (eventId: string) => t.prisma.notification.count({ where: { type: 'event_reminder', payload: { path: ['eventId'], equals: eventId } } });

  it('reminds going participants once, LEAD before the start', async () => {
    const { owner, member, mod, communityId } = await cast(false);
    const ev = (await api(owner).create(communityId, body({ startsAt: new Date(Date.now() + LEAD_MS + 2500).toISOString() })).expect(201)).body as EventDto;
    await api(member).rsvp(ev.id, 'going').expect(200);
    await api(mod).rsvp(ev.id, 'interested').expect(200);
    await waitFor(async () => (await remindersFor(ev.id)) === 1, 8000);
    const [n] = await t.prisma.notification.findMany({ where: { type: 'event_reminder' } });
    expect(n).toMatchObject({ userId: member.id, payload: expect.objectContaining({ eventId: ev.id, title: 'Встреча клуба' }) });
    expect((await t.prisma.event.findUniqueOrThrow({ where: { id: ev.id } })).reminderSentAt).not.toBeNull();
  });

  it('PATCH of startsAt reschedules: the old job is dropped, the new one fires', async () => {
    const { owner, member, communityId } = await cast(false);
    const ev = (await api(owner).create(communityId, body({ startsAt: new Date(Date.now() + LEAD_MS + 2000).toISOString() })).expect(201)).body as EventDto;
    await api(member).rsvp(ev.id, 'going').expect(200);
    // pushed far out: nothing at the old time
    await api(owner).patch(ev.id, { startsAt: inHours(5) }).expect(200);
    await new Promise((r) => setTimeout(r, 3500));
    expect(await remindersFor(ev.id)).toBe(0);
    const delayed = await t.app.get(EventsQueueToken).bullQueue.getDelayed();
    expect(delayed.filter((j) => j.data.eventId === ev.id).map((j) => j.data.startsAt)).toHaveLength(1);
    // pulled back in: fires again
    await api(owner).patch(ev.id, { startsAt: new Date(Date.now() + LEAD_MS + 1500).toISOString() }).expect(200);
    await waitFor(async () => (await remindersFor(ev.id)) === 1, 8000);
  });

  it('delete cancels the reminder', async () => {
    const { owner, member, communityId } = await cast(false);
    const ev = (await api(owner).create(communityId, body({ startsAt: new Date(Date.now() + LEAD_MS + 1500).toISOString() })).expect(201)).body as EventDto;
    await api(member).rsvp(ev.id, 'going').expect(200);
    await api(owner).del(ev.id).expect(204);
    const delayed = await t.app.get(EventsQueueToken).bullQueue.getDelayed();
    expect(delayed.some((j) => j.data.eventId === ev.id)).toBe(false);
    await new Promise((r) => setTimeout(r, 2500));
    expect(await remindersFor(ev.id)).toBe(0);
  });
});

