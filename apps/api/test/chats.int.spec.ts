import { CHAT_LIMITS, type ChatDto, type MessageDto } from '@autoc/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../src/common/ids';
import { WebPushSender } from '../src/modules/push/web-push.sender';
import { bearer, createCommunity, createTestApp, createUser, waitFor, type TestApp } from './support/app';
import { FakePushSender } from './support/fake-push-sender';
import { oggOpus, pngImage } from './support/images';

const sender = new FakePushSender();
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({}, [{ provide: WebPushSender, useValue: sender }]);
});
afterAll(async () => {
  await t.close();
});
beforeEach(() => sender.reset());

type U = { id: string; token: string };
const api = (u: U) => ({
  direct: (userId: string) => request(t.http).post('/api/v1/chats/direct').set(bearer(u.token)).send({ userId }),
  list: (q = '') => request(t.http).get(`/api/v1/chats${q}`).set(bearer(u.token)),
  get: (id: string) => request(t.http).get(`/api/v1/chats/${id}`).set(bearer(u.token)),
  messages: (id: string, q = '') => request(t.http).get(`/api/v1/chats/${id}/messages${q}`).set(bearer(u.token)),
  send: (id: string, body: object) => request(t.http).post(`/api/v1/chats/${id}/messages`).set(bearer(u.token)).send(body),
  text: (id: string, text: string) => request(t.http).post(`/api/v1/chats/${id}/messages`).set(bearer(u.token)).send({ type: 'text', text }),
  read: (id: string) => request(t.http).post(`/api/v1/chats/${id}/read`).set(bearer(u.token)),
  del: (id: string, messageId: string) => request(t.http).delete(`/api/v1/chats/${id}/messages/${messageId}`).set(bearer(u.token)),
});
const chatIdOf = async (communityId: string) => (await t.prisma.chat.findUniqueOrThrow({ where: { refId: communityId } })).id;
const upload = async (u: U, purpose: string, file: Buffer, name: string, type: string) =>
  (await request(t.http).post(`/api/v1/uploads?purpose=${purpose}`).set(bearer(u.token)).attach('file', file, { filename: name, contentType: type }).expect(201)).body;
const clearRate = (u: U) => t.redis.del(`rl:chat-msg:${u.id}`);

describe('direct chats', () => {
  it('gets or creates one chat per pair, titled with the peer', async () => {
    const a = await createUser(t, { name: 'Alice', nickname: `al_${newId().slice(-6)}` });
    const b = await createUser(t, { name: 'Bob', nickname: `bob_${newId().slice(-6)}` });
    const first = (await api(a).direct(b.id).expect(200)).body as ChatDto;
    expect(first).toMatchObject({ type: 'direct', refId: null, title: 'Bob', avatarUrl: null, lastMessage: null, unreadCount: 0, peer: { id: b.id, name: 'Bob' } });
    expect((await api(a).direct(b.id).expect(200)).body.id).toBe(first.id);
    const fromB = (await api(b).direct(a.id).expect(200)).body as ChatDto;
    expect(fromB).toMatchObject({ id: first.id, title: 'Alice', peer: { id: a.id } });
    // Concurrent creation by both sides still yields one chat.
    const c = await createUser(t);
    const d = await createUser(t);
    const [r1, r2] = await Promise.all([api(c).direct(d.id), api(d).direct(c.id)]);
    expect(r1.body.id).toBe(r2.body.id);
    expect(await t.prisma.chat.count({ where: { type: 'direct', members: { some: { userId: c.id } } } })).toBe(1);
  });

  it('rejects self, missing, blocked, deleted and un-onboarded peers', async () => {
    const a = await createUser(t);
    expect((await api(a).direct(a.id).expect(400)).body.error.code).toBe('INVALID_TARGET');
    await api(a).direct(newId()).expect(404);
    for (const data of [{ status: 'blocked' as const }, { status: 'deleted' as const }, { onboarded: false }]) {
      await api(a).direct((await createUser(t, data)).id).expect(404);
    }
  });

  it('is private to its two members', async () => {
    const a = await createUser(t);
    const b = await createUser(t);
    const outsider = await createUser(t);
    const chat = (await api(a).direct(b.id).expect(200)).body as ChatDto;
    await api(a).text(chat.id, 'hello').expect(201);
    await api(outsider).get(chat.id).expect(404);
    await api(outsider).messages(chat.id).expect(404);
    await api(outsider).text(chat.id, 'x').expect(404);
    await api(outsider).read(chat.id).expect(404);
    await api(outsider).get(newId()).expect(404);
  });
});

describe('messages', () => {
  it('sends all four types and validates them', async () => {
    const a = await createUser(t);
    const b = await createUser(t);
    const chat = (await api(a).direct(b.id).expect(200)).body as ChatDto;
    const text = (await api(a).text(chat.id, '  Привет!  ').expect(201)).body as MessageDto;
    expect(text).toMatchObject({ chatId: chat.id, type: 'text', text: 'Привет!', upload: null, lat: null, lng: null, deletedAt: null, sender: { id: a.id } });

    const photo = await upload(a, 'message', await pngImage(), 'p.png', 'image/png');
    const p = (await api(a).send(chat.id, { type: 'photo', uploadId: photo.id, text: 'look' }).expect(201)).body as MessageDto;
    expect(p).toMatchObject({ type: 'photo', text: 'look', upload: { id: photo.id, url: photo.url } });

    const voice = await upload(a, 'voice', oggOpus(), 'v.ogg', 'audio/ogg');
    expect((await api(a).send(chat.id, { type: 'voice', uploadId: voice.id }).expect(201)).body).toMatchObject({ type: 'voice', upload: { id: voice.id }, text: null });
    expect((await api(a).send(chat.id, { type: 'location', lat: 43.25, lng: 76.95 }).expect(201)).body).toMatchObject({ type: 'location', lat: 43.25, lng: 76.95, text: null });

    for (const body of [
      { type: 'text', text: '' },
      { type: 'text', text: '   ' },
      { type: 'text', text: 'x'.repeat(CHAT_LIMITS.textMax + 1) },
      { type: 'location', lat: 91, lng: 0 },
      { type: 'location', lat: 1 },
      { type: 'location', lat: '43.2', lng: '76.9' },
      { type: 'photo' },
      { type: 'system', text: 'nope' },
      { type: 'sticker' },
    ]) {
      expect((await api(a).send(chat.id, body).expect(400)).body.error.code).toBe('VALIDATION_ERROR');
    }
    await api(a).text(chat.id, 'x'.repeat(CHAT_LIMITS.textMax)).expect(201);
    // Wrong purpose, someone else's upload.
    expect((await api(a).send(chat.id, { type: 'photo', uploadId: voice.id }).expect(400)).body.error.code).toBe('INVALID_UPLOAD');
    expect((await api(a).send(chat.id, { type: 'voice', uploadId: photo.id }).expect(400)).body.error.code).toBe('INVALID_UPLOAD');
    const bPhoto = await upload(b, 'message', await pngImage(), 'p.png', 'image/png');
    expect((await api(a).send(chat.id, { type: 'photo', uploadId: bPhoto.id }).expect(400)).body.error.code).toBe('INVALID_UPLOAD');
  });

  it('paginates newest first with a keyset cursor', async () => {
    const a = await createUser(t);
    const b = await createUser(t);
    const chat = (await api(a).direct(b.id).expect(200)).body as ChatDto;
    const sent: string[] = [];
    for (let i = 0; i < 7; i++) sent.push((await api(i % 2 ? b : a).text(chat.id, `m${i}`).expect(201)).body.id);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res: request.Response = await api(a).messages(chat.id, `?limit=3${cursor ? `&cursor=${cursor}` : ''}`).expect(200);
      seen.push(...(res.body.items as MessageDto[]).map((m) => m.id));
      cursor = res.body.nextCursor;
      // A new message arriving between pages doesn't shift the keyset.
      if (seen.length === 3) await api(b).text(chat.id, 'late').expect(201);
    } while (cursor);
    expect(seen).toEqual([...sent].reverse());
    await api(a).messages(chat.id, '?cursor=garbage').expect(400);
  });

  it('deletion: sender or community moderator; content withheld afterwards', async () => {
    const owner = await createUser(t);
    const mod = await createUser(t);
    const member = await createUser(t);
    const other = await createUser(t);
    const cid = await createCommunity(t, owner.id, [{ userId: mod.id, role: 'moderator' }, { userId: member.id }, { userId: other.id }]);
    const chatId = await chatIdOf(cid);
    const photo = await upload(member, 'message', await pngImage(), 'p.png', 'image/png');
    const m1 = (await api(member).send(chatId, { type: 'photo', uploadId: photo.id, text: 'secret' }).expect(201)).body as MessageDto;
    const m2 = (await api(member).text(chatId, 'by member')).body as MessageDto;
    const m3 = (await api(other).text(chatId, 'by other')).body as MessageDto;

    await api(other).del(chatId, m1.id).expect(403);
    await api(member).del(chatId, m1.id).expect(204);
    await api(member).del(chatId, m1.id).expect(204); // idempotent
    await api(mod).del(chatId, m2.id).expect(204);
    await api(owner).del(chatId, m3.id).expect(204);
    await api(member).del(chatId, newId()).expect(404);

    const items = (await api(other).messages(chatId).expect(200)).body.items as MessageDto[];
    const deleted = items.find((m) => m.id === m1.id)!;
    expect(deleted).toMatchObject({ type: 'photo', text: null, upload: null, deletedAt: expect.any(String), sender: { id: member.id } });
    expect(items.every((m) => m.deletedAt && m.text === null)).toBe(true);
    // The photo file is gone too.
    expect(await t.prisma.upload.count({ where: { id: photo.id } })).toBe(0);
    await request(t.http).get(new URL(photo.url).pathname).expect(404);
    // Chat list shows the deleted last message without content.
    const listed = ((await api(other).list().expect(200)).body.items as ChatDto[]).find((c) => c.id === chatId)!;
    expect(listed.lastMessage).toMatchObject({ id: m3.id, text: null, deletedAt: expect.any(String) });

    // In a direct chat only the sender may delete.
    const dm = (await api(mod).direct(member.id).expect(200)).body as ChatDto;
    const dmMsg = (await api(member).text(dm.id, 'dm')).body as MessageDto;
    await api(mod).del(dm.id, dmMsg.id).expect(403);
    // A moderator who left loses the right (and access).
    await request(t.http).post(`/api/v1/communities/${cid}/leave`).set(bearer(mod.token)).expect(204);
    const m4 = (await api(other).text(chatId, 'later')).body as MessageDto;
    await api(mod).del(chatId, m4.id).expect(404);
  });

  it(`rate limits to ${CHAT_LIMITS.messagesPerMinute} messages per minute per user`, async () => {
    const a = await createUser(t);
    const b = await createUser(t);
    const chat = (await api(a).direct(b.id).expect(200)).body as ChatDto;
    await clearRate(a);
    for (let i = 0; i < CHAT_LIMITS.messagesPerMinute; i++) await api(a).text(chat.id, `n${i}`).expect(201);
    const res = await api(a).text(chat.id, 'one too many').expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    await api(b).text(chat.id, 'b is fine').expect(201);
  });
});

describe('chat list and unread counts', () => {
  it('orders by last message, counts unread messages of others since lastReadAt, excludes deleted', async () => {
    const me = await createUser(t);
    const a = await createUser(t);
    const b = await createUser(t);
    const owner = await createUser(t);
    const cid = await createCommunity(t, owner.id, [{ userId: me.id }, { userId: a.id }], { name: `Unread ${newId().slice(-8)}` });
    const communityChat = await chatIdOf(cid);
    const dmA = (await api(me).direct(a.id).expect(200)).body as ChatDto;
    const dmB = (await api(me).direct(b.id).expect(200)).body as ChatDto;

    await api(a).text(dmA.id, 'a1').expect(201);
    await api(a).text(dmA.id, 'a2').expect(201);
    await api(me).text(dmA.id, 'mine').expect(201); // own messages never unread
    await api(owner).text(communityChat, 'c1').expect(201);
    const toDelete = (await api(owner).text(communityChat, 'c2')).body as MessageDto;
    await api(owner).del(communityChat, toDelete.id).expect(204);
    await api(b).text(dmB.id, 'b1').expect(201);

    const list = (await api(me).list().expect(200)).body.items as ChatDto[];
    expect(list.map((c) => c.id)).toEqual([dmB.id, communityChat, dmA.id]);
    const byId = new Map(list.map((c) => [c.id, c]));
    // Reading the chat moved my lastReadAt when I sent "mine", so a1/a2 (earlier) are read.
    expect(byId.get(dmA.id)).toMatchObject({ unreadCount: 0, lastMessage: { text: 'mine' } });
    expect(byId.get(communityChat)).toMatchObject({ unreadCount: 1, type: 'community', refId: cid, title: expect.stringMatching(/^Unread/) });
    expect(byId.get(dmB.id)).toMatchObject({ unreadCount: 1, lastMessage: { text: 'b1', sender: { id: b.id } } });

    await api(me).read(communityChat).expect(204);
    expect((await api(me).get(communityChat).expect(200)).body.unreadCount).toBe(0);
    await api(a).text(dmA.id, 'a3').expect(201);
    expect((await api(me).get(dmA.id).expect(200)).body.unreadCount).toBe(1);

    // Pagination over chats.
    const p1 = await api(me).list('?limit=2').expect(200);
    const p2 = await api(me).list(`?limit=2&cursor=${p1.body.nextCursor}`).expect(200);
    expect([...p1.body.items, ...p2.body.items].map((c: ChatDto) => c.id)).toEqual([dmA.id, dmB.id, communityChat]);
    expect(p2.body.nextCursor).toBeNull();
  });

  it('joining a community does not make its history unread', async () => {
    const owner = await createUser(t);
    const cid = await createCommunity(t, owner.id);
    const chatId = await chatIdOf(cid);
    await api(owner).text(chatId, 'before').expect(201);
    const late = await createUser(t);
    await request(t.http).post(`/api/v1/communities/${cid}/join`).set(bearer(late.token)).expect(200);
    expect((await api(late).get(chatId).expect(200)).body.unreadCount).toBe(0);
    expect((await api(late).messages(chatId).expect(200)).body.items).toHaveLength(1);
  });

  it('removal and soft delete revoke access, and the chat leaves the list', async () => {
    const owner = await createUser(t);
    const member = await createUser(t);
    const cid = await createCommunity(t, owner.id, [{ userId: member.id }]);
    const chatId = await chatIdOf(cid);
    await api(member).text(chatId, 'hi').expect(201);
    await request(t.http).delete(`/api/v1/communities/${cid}/members/${member.id}`).set(bearer(owner.token)).expect(204);
    await api(member).messages(chatId).expect(404);
    expect(((await api(member).list().expect(200)).body.items as ChatDto[]).some((c) => c.id === chatId)).toBe(false);
    await request(t.http).delete(`/api/v1/communities/${cid}`).set(bearer(owner.token)).expect(204);
    await api(owner).messages(chatId).expect(404);
    await api(owner).text(chatId, 'x').expect(404);
  });
});

describe('direct message push', () => {
  it('pushes a localized preview to the offline recipient only, never for community chats', async () => {
    const a = await createUser(t, { name: 'Алия' });
    const b = await createUser(t, { locale: 'en' });
    const ep = `https://fcm.googleapis.com/fcm/send/dm-${newId()}`;
    await request(t.http)
      .post('/api/v1/push/subscriptions')
      .set(bearer(b.token))
      .send({ endpoint: ep, keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } })
      .expect(204);
    const chat = (await api(a).direct(b.id).expect(200)).body as ChatDto;
    await api(a).send(chat.id, { type: 'location', lat: 43.2, lng: 76.9 }).expect(201);
    await waitFor(() => sender.sent.length >= 1);
    expect(sender.sent[0]).toMatchObject({ endpoint: ep, payload: { title: 'Алия', body: '📍 Location', url: `/chats/${chat.id}`, tag: `chat:${chat.id}` } });
    expect(await t.prisma.notification.count({ where: { userId: b.id } })).toBe(0);

    sender.reset();
    const cid = await createCommunity(t, a.id, [{ userId: b.id }]);
    await api(a).text(await chatIdOf(cid), 'community message').expect(201);
    await api(a).text(chat.id, 'direct again').expect(201);
    await waitFor(() => sender.sent.length >= 1);
    await new Promise((r) => setTimeout(r, 200));
    expect(sender.sent.map((s) => s.payload.body)).toEqual(['direct again']);
  });
});

describe('exclusive attachments (review M5)', () => {
  it('an upload can be attached once: messages (also concurrently), community avatars, SOS photos', async () => {
    const a = await createUser(t);
    const b = await createUser(t);
    const chat = (await api(a).direct(b.id).expect(200)).body as ChatDto;
    const photo = await upload(a, 'message', await pngImage(), 'p.png', 'image/png');
    await clearRate(a);
    await api(a).send(chat.id, { type: 'photo', uploadId: photo.id }).expect(201);
    expect((await api(a).send(chat.id, { type: 'photo', uploadId: photo.id }).expect(400)).body.error.code).toBe('INVALID_UPLOAD');
    const p2 = await upload(a, 'message', await pngImage(), 'p.png', 'image/png');
    const both = await Promise.all([1, 2].map(() => request(t.http).post(`/api/v1/chats/${chat.id}/messages`).set(bearer(a.token)).send({ type: 'photo', uploadId: p2.id })));
    expect(both.map((r) => r.status).sort()).toEqual([201, 400]);

    const avatar = await upload(a, 'community', await pngImage(), 'c.png', 'image/png');
    await request(t.http).post('/api/v1/communities').set(bearer(a.token)).send({ name: `Avatar A ${newId().slice(-6)}`, isPrivate: false, avatarUploadId: avatar.id }).expect(201);
    const second = await request(t.http).post('/api/v1/communities').set(bearer(a.token)).send({ name: `Avatar B ${newId().slice(-6)}`, isPrivate: false, avatarUploadId: avatar.id }).expect(400);
    expect(second.body.error.code).toBe('INVALID_UPLOAD');

    const sosPhoto = await upload(a, 'sos', await pngImage(), 's.png', 'image/png');
    const first = await request(t.http).post('/api/v1/sos').set(bearer(a.token)).send({ type: 'other', lat: 43.2, lng: 76.9, sharePhone: false, photoUploadIds: [sosPhoto.id] }).expect(201);
    await request(t.http).post(`/api/v1/sos/${first.body.id}/cancel`).set(bearer(a.token)).send({}).expect(200);
    const reuse = await request(t.http).post('/api/v1/sos').set(bearer(a.token)).send({ type: 'other', lat: 43.2, lng: 76.9, sharePhone: false, photoUploadIds: [sosPhoto.id] }).expect(400);
    expect(reuse.body.error.code).toBe('INVALID_UPLOAD');
  });
});

describe('review fixes for chats', () => {
  it('direct messages re-check the peer (blocked / deleted / un-onboarded → 404)', async () => {
    for (const change of [{ status: 'blocked' as const }, { status: 'deleted' as const }, { onboardedAt: null }]) {
      const a = await createUser(t);
      const b = await createUser(t);
      const chat = (await api(a).direct(b.id).expect(200)).body as ChatDto;
      await api(a).text(chat.id, 'hi').expect(201);
      await t.prisma.user.update({ where: { id: b.id }, data: change });
      await api(a).text(chat.id, 'still there?').expect(404);
      await api(a).messages(chat.id).expect(200); // history stays readable
    }
  });

  it('caps unreadCount at 99 ("99+")', async () => {
    const a = await createUser(t);
    const b = await createUser(t);
    const chat = (await api(a).direct(b.id).expect(200)).body as ChatDto;
    const base = Date.now() + 1000;
    await t.prisma.message.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({ id: newId(), chatId: chat.id, senderId: a.id, type: 'text' as const, text: `m${i}`, createdAt: new Date(base + i) })),
    });
    expect((await api(b).get(chat.id).expect(200)).body.unreadCount).toBe(99);
    await t.prisma.message.deleteMany({ where: { chatId: chat.id, text: { not: 'm0' } } });
    expect((await api(b).get(chat.id).expect(200)).body.unreadCount).toBe(1);
  });
});
