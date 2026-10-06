import type { FriendRequestDto, NotificationDto, UserPublic } from '@autoc/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../src/common/ids';
import { FRIEND_REQUESTS_PER_HOUR } from '../src/modules/friends/friends.service';
import { bearer, createTestApp, createUser, makeFriends, type TestApp } from './support/app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const api = (token: string) => ({
  send: (userId: string) => request(t.http).post('/api/v1/friends/requests').set(bearer(token)).send({ userId }),
  accept: (id: string) => request(t.http).post(`/api/v1/friends/requests/${id}/accept`).set(bearer(token)),
  decline: (id: string) => request(t.http).post(`/api/v1/friends/requests/${id}/decline`).set(bearer(token)),
  cancel: (id: string) => request(t.http).delete(`/api/v1/friends/requests/${id}`).set(bearer(token)),
  unfriend: (userId: string) => request(t.http).delete(`/api/v1/friends/${userId}`).set(bearer(token)),
  friends: (q = '') => request(t.http).get(`/api/v1/friends${q}`).set(bearer(token)),
  requests: (direction: 'in' | 'out', q = '') => request(t.http).get(`/api/v1/friends/requests?direction=${direction}${q}`).set(bearer(token)),
  relation: async (userId: string) => (await request(t.http).get(`/api/v1/users/${userId}`).set(bearer(token)).expect(200)).body.relation as string,
});

const notificationsOf = (userId: string) => t.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });

describe('friend requests lifecycle', () => {
  it('request → listed both ways → accept → friends, with notifications', async () => {
    const a = await createUser(t, { nickname: 'fr_alice', name: 'Alice' });
    const b = await createUser(t, { nickname: 'fr_bob', name: 'Bob' });

    const sent = await api(a.token).send(b.id).expect(201);
    expect(sent.body).toEqual({ id: expect.any(String), status: 'pending' });
    const requestId = sent.body.id as string;

    const incoming = await api(b.token).requests('in').expect(200);
    expect(incoming.body.nextCursor).toBeNull();
    expect(incoming.body.items).toHaveLength(1);
    const item = incoming.body.items[0] as FriendRequestDto;
    expect(item).toMatchObject({ id: requestId, user: { id: a.id, nickname: 'fr_alice', relation: 'request_in' } });
    expect((await api(a.token).requests('out').expect(200)).body.items[0]).toMatchObject({ id: requestId, user: { id: b.id, relation: 'request_out' } });
    expect((await api(a.token).requests('in').expect(200)).body.items).toEqual([]);
    expect(await api(a.token).relation(b.id)).toBe('request_out');

    const [reqNotif] = await notificationsOf(b.id);
    expect(reqNotif).toMatchObject({ type: 'friend_request', readAt: null });
    expect(reqNotif!.payload).toEqual({ requestId, user: { id: a.id, nickname: 'fr_alice', name: 'Alice', avatarUrl: null, rating: 50, isPremium: false } });

    await api(b.token).accept(requestId).expect(204);
    expect(await api(a.token).relation(b.id)).toBe('friend');
    expect(await api(b.token).relation(a.id)).toBe('friend');
    const listA = (await api(a.token).friends().expect(200)).body.items as UserPublic[];
    expect(listA.map((u) => u.id)).toEqual([b.id]);
    expect(listA[0]!.relation).toBe('friend');
    expect(((await api(b.token).friends().expect(200)).body.items as UserPublic[]).map((u) => u.id)).toEqual([a.id]);
    expect((await api(b.token).requests('in').expect(200)).body.items).toEqual([]);

    // The accepted request's notification is removed for b.
    expect((await notificationsOf(b.id)).filter((n) => n.type === 'friend_request')).toEqual([]);
    const accepted = await notificationsOf(a.id);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ type: 'friend_accepted', payload: { user: { id: b.id, nickname: 'fr_bob' } } });
    // Accepting again → 404 (no longer pending).
    await api(b.token).accept(requestId).expect(404);
  });

  it('auto-accepts when the target already asked the caller', async () => {
    const a = await createUser(t);
    const b = await createUser(t);
    const first = await api(a.token).send(b.id).expect(201);
    const second = await api(b.token).send(a.id).expect(200);
    expect(second.body).toEqual({ id: first.body.id, status: 'accepted' });
    expect(await api(a.token).relation(b.id)).toBe('friend');
    expect(await t.prisma.friendship.count({ where: { OR: [{ requesterId: a.id }, { addresseeId: a.id }] } })).toBe(1);
    // a (the original requester) is told b accepted; b's notification about a's (now accepted) request is gone.
    expect((await notificationsOf(a.id)).map((n) => n.type)).toEqual(['friend_accepted']);
    expect(await notificationsOf(b.id)).toEqual([]);
  });

  it('settles simultaneous mutual requests into one friendship', async () => {
    const a = await createUser(t);
    const b = await createUser(t);
    const [r1, r2] = await Promise.all([api(a.token).send(b.id), api(b.token).send(a.id)]);
    expect([r1.status, r2.status].sort()).toEqual([200, 201]);
    const rows = await t.prisma.friendship.findMany({ where: { OR: [{ requesterId: a.id }, { addresseeId: a.id }] } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('accepted');
  });

  it('rejects duplicates and existing friendships', async () => {
    const a = await createUser(t);
    const b = await createUser(t);
    await api(a.token).send(b.id).expect(201);
    expect((await api(a.token).send(b.id).expect(409)).body.error.code).toBe('ALREADY_REQUESTED');
    const c = await createUser(t);
    await makeFriends(t, c.id, a.id);
    expect((await api(a.token).send(c.id).expect(409)).body.error.code).toBe('ALREADY_FRIENDS');
    expect((await api(c.token).send(a.id).expect(409)).body.error.code).toBe('ALREADY_FRIENDS');
  });

  it('rejects self, missing, blocked, deleted and un-onboarded targets', async () => {
    const a = await createUser(t);
    expect((await api(a.token).send(a.id).expect(400)).body.error.code).toBe('INVALID_TARGET');
    await api(a.token).send(newId()).expect(404);
    for (const data of [{ status: 'blocked' as const }, { status: 'deleted' as const }, { onboarded: false }]) {
      const target = await createUser(t, data);
      await api(a.token).send(target.id).expect(404);
    }
    const tempBlockedOver = await createUser(t, { status: 'blocked', blockedUntil: new Date(Date.now() - 1000) });
    await api(a.token).send(tempBlockedOver.id).expect(201);
    await api(a.token).send('nope').expect(400);
  });

  it('requires the caller to have completed onboarding', async () => {
    const fresh = await createUser(t, { onboarded: false, nickname: null });
    const b = await createUser(t);
    const res = await api(fresh.token).send(b.id).expect(403);
    expect(res.body.error).toMatchObject({ code: 'ONBOARDING_INCOMPLETE', details: { missing: ['nickname'] } });
  });

  it('only the addressee accepts/declines and only the requester cancels', async () => {
    const a = await createUser(t);
    const b = await createUser(t);
    const outsider = await createUser(t);
    const id = (await api(a.token).send(b.id).expect(201)).body.id as string;

    await api(a.token).accept(id).expect(404);
    await api(outsider.token).accept(id).expect(404);
    await api(a.token).decline(id).expect(404);
    await api(outsider.token).decline(id).expect(404);
    await api(b.token).cancel(id).expect(404);
    await api(outsider.token).cancel(id).expect(404);
    expect(await t.prisma.friendship.findUnique({ where: { id } })).toMatchObject({ status: 'pending' });

    await api(b.token).decline(id).expect(204);
    expect(await t.prisma.friendship.findUnique({ where: { id } })).toBeNull();
    expect(await api(a.token).relation(b.id)).toBe('none');
    await api(b.token).decline(id).expect(404);

    // After the cooldown a new request is possible; the requester may cancel it.
    await t.redis.del(`friend-cooldown:${a.id}:${b.id}`);
    const id2 = (await api(a.token).send(b.id).expect(201)).body.id as string;
    await api(a.token).cancel(id2).expect(204);
    await api(a.token).cancel(id2).expect(404);
    expect(await api(b.token).relation(a.id)).toBe('none');
    await api(a.token).accept(newId()).expect(404);
    await api(a.token).accept('bad').expect(400);
  });

  it('unfriends from either side', async () => {
    const a = await createUser(t);
    const b = await createUser(t);
    await makeFriends(t, a.id, b.id);
    await api(b.token).unfriend(a.id).expect(204);
    expect(await api(a.token).relation(b.id)).toBe('none');
    expect((await api(a.token).friends().expect(200)).body.items).toEqual([]);
    await api(b.token).unfriend(a.id).expect(404);
    // A pending request isn't a friendship.
    const c = await createUser(t);
    await makeFriends(t, a.id, c.id, 'pending');
    await api(a.token).unfriend(c.id).expect(404);
  });

  it(`rate limits sending to ${FRIEND_REQUESTS_PER_HOUR}/h`, async () => {
    const a = await createUser(t);
    await t.redis.del(`rl:friend-req:${a.id}`);
    const now = Date.now();
    // Pre-fill the sliding window instead of creating 50 users.
    await t.redis.zadd(`rl:friend-req:${a.id}`, ...Array.from({ length: FRIEND_REQUESTS_PER_HOUR }, (_, i) => [now - i, `m${i}`]).flat());
    const b = await createUser(t);
    const res = await api(a.token).send(b.id).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('friend request cooldown and cleanup', () => {
  it('blocks re-requesting the same person for 24 h after a decline or cancel, and removes stale notifications', async () => {
    const a = await createUser(t);
    const b = await createUser(t);
    const id = (await api(a.token).send(b.id).expect(201)).body.id as string;
    expect(await t.prisma.notification.count({ where: { userId: b.id, type: 'friend_request' } })).toBe(1);
    await api(b.token).decline(id).expect(204);
    expect(await t.prisma.notification.count({ where: { userId: b.id, type: 'friend_request' } })).toBe(0);
    const res = await api(a.token).send(b.id).expect(409);
    expect(res.body.error.code).toBe('FRIEND_REQUEST_COOLDOWN');
    expect(res.body.error.details.retryAfterSec).toBeGreaterThan(23 * 3600);
    expect(res.body.error.details.retryAfterSec).toBeLessThanOrEqual(24 * 3600);
    // Directional: the one who declined can still ask.
    const back = (await api(b.token).send(a.id).expect(201)).body.id as string;
    // Cancel → cooldown for the canceller, and the addressee's notification disappears.
    await api(b.token).cancel(back).expect(204);
    expect(await t.prisma.notification.count({ where: { userId: a.id, type: 'friend_request' } })).toBe(0);
    expect((await api(b.token).send(a.id).expect(409)).body.error.code).toBe('FRIEND_REQUEST_COOLDOWN');
    // Expired cooldown → allowed again.
    await t.redis.del(`friend-cooldown:${a.id}:${b.id}`);
    await api(a.token).send(b.id).expect(201);
  });

  it('accept re-checks that the requester is still active and onboarded', async () => {
    for (const change of [{ status: 'blocked' as const }, { status: 'deleted' as const }, { onboardedAt: null }]) {
      const requester = await createUser(t);
      const me = await createUser(t);
      const id = (await api(requester.token).send(me.id).expect(201)).body.id as string;
      await t.prisma.user.update({ where: { id: requester.id }, data: change });
      await api(me.token).accept(id).expect(404);
      expect(await t.prisma.friendship.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'pending' });
    }
  });
});

describe('friend lists pagination', () => {
  it('pages friends (most recently accepted first) and requests (newest first)', async () => {
    const me = await createUser(t);
    const friends: string[] = [];
    for (let i = 0; i < 5; i++) {
      const u = await createUser(t);
      friends.push(u.id);
      await t.prisma.friendship.create({
        data: {
          id: newId(),
          requesterId: i % 2 ? me.id : u.id,
          addresseeId: i % 2 ? u.id : me.id,
          pairKey: [me.id, u.id].sort().join(':'),
          status: 'accepted',
          acceptedAt: new Date(Date.now() - (5 - i) * 60_000),
        },
      });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res: request.Response = await api(me.token).friends(`?limit=2${cursor ? `&cursor=${cursor}` : ''}`).expect(200);
      seen.push(...(res.body.items as UserPublic[]).map((u) => u.id));
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual([...friends].reverse());

    const senders: string[] = [];
    for (let i = 0; i < 3; i++) {
      const u = await createUser(t);
      senders.push(u.id);
      await api(u.token).send(me.id).expect(201);
    }
    const p1 = await api(me.token).requests('in', '&limit=2').expect(200);
    const p2 = await api(me.token).requests('in', `&limit=2&cursor=${p1.body.nextCursor}`).expect(200);
    expect(p2.body.nextCursor).toBeNull();
    expect([...p1.body.items, ...p2.body.items].map((r: FriendRequestDto) => r.user.id)).toEqual([...senders].reverse());
    await api(me.token).requests('in', '&cursor=garbage').expect(400);
    await request(t.http).get('/api/v1/friends/requests').set(bearer(me.token)).expect(400);
  });
});

describe('notifications API', () => {
  it('paginates, counts, reads one and reads all', async () => {
    const me = await createUser(t);
    const other = await createUser(t);
    const senders = [];
    for (let i = 0; i < 5; i++) {
      const u = await createUser(t);
      senders.push(u);
      await api(u.token).send(me.id).expect(201);
    }
    await api(me.token).send(other.id).expect(201); // a notification for someone else
    const auth = bearer(me.token);
    expect((await request(t.http).get('/api/v1/notifications/unread-count').set(auth).expect(200)).body).toEqual({ count: 5 });

    const all: NotificationDto[] = [];
    let cursor: string | null = null;
    do {
      const res: request.Response = await request(t.http).get(`/api/v1/notifications?limit=2${cursor ? `&cursor=${cursor}` : ''}`).set(auth).expect(200);
      all.push(...res.body.items);
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(all).toHaveLength(5);
    expect(new Set(all.map((n) => n.id)).size).toBe(5);
    expect(all.map((n) => (n.payload.user as { id: string }).id)).toEqual(senders.map((s) => s.id).reverse());
    expect(all.every((n) => n.type === 'friend_request' && n.readAt === null)).toBe(true);

    await request(t.http).post(`/api/v1/notifications/${all[0]!.id}/read`).set(auth).expect(204);
    await request(t.http).post(`/api/v1/notifications/${all[0]!.id}/read`).set(auth).expect(204);
    expect((await request(t.http).get('/api/v1/notifications/unread-count').set(auth).expect(200)).body.count).toBe(4);
    const first = (await request(t.http).get('/api/v1/notifications?limit=1').set(auth).expect(200)).body.items[0];
    expect(first.readAt).not.toBeNull();

    // Someone else's notification / unknown id → 404.
    const foreign = await t.prisma.notification.findFirstOrThrow({ where: { userId: other.id } });
    await request(t.http).post(`/api/v1/notifications/${foreign.id}/read`).set(auth).expect(404);
    await request(t.http).post(`/api/v1/notifications/${newId()}/read`).set(auth).expect(404);
    await request(t.http).post('/api/v1/notifications/x/read').set(auth).expect(400);

    await request(t.http).post('/api/v1/notifications/read-all').set(auth).expect(204);
    expect((await request(t.http).get('/api/v1/notifications/unread-count').set(auth).expect(200)).body.count).toBe(0);
    expect(await t.prisma.notification.count({ where: { userId: other.id, readAt: null } })).toBe(1);
    await request(t.http).get('/api/v1/notifications').expect(401);
  });
});
