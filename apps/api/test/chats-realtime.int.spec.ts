import type { AddressInfo } from 'node:net';
import type { ChatReadEvent, ChatTypingEvent, MessageDeletedEvent, MessageDto } from '@autoc/shared';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../src/common/ids';
import { WebPushSender } from '../src/modules/push/web-push.sender';
import { bearer, createCommunity, createTestApp, createUser, waitFor, type TestApp } from './support/app';
import { FakePushSender } from './support/fake-push-sender';

const pushSender = new FakePushSender();
let t: TestApp;
let baseUrl: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  t = await createTestApp({}, [{ provide: WebPushSender, useValue: pushSender }]);
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

async function connect(u: U): Promise<Socket> {
  const socket = io(`${baseUrl}/rt`, { path: '/socket.io', auth: { token: u.token }, transports: ['polling'], reconnection: false, forceNew: true });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
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

/** Collects every event of a name until `ms` passes. */
const collect = async <T = unknown>(socket: Socket, event: string, ms: number): Promise<T[]> => {
  const got: T[] = [];
  const handler = (p: T) => got.push(p);
  socket.on(event, handler);
  await new Promise((r) => setTimeout(r, ms));
  socket.off(event, handler);
  return got;
};

const send = (u: U, chatId: string, text: string) =>
  request(t.http).post(`/api/v1/chats/${chatId}/messages`).set(bearer(u.token)).send({ type: 'text', text });
const chatIdOf = async (communityId: string) => (await t.prisma.chat.findUniqueOrThrow({ where: { refId: communityId } })).id;
const settle = () => new Promise((r) => setTimeout(r, 150));

describe('chat realtime over polling', () => {
  it('auto-joins every chat on connect and delivers message:new to members only', async () => {
    const owner = await createUser(t);
    const member = await createUser(t);
    const outsider = await createUser(t);
    const cid = await createCommunity(t, owner.id, [{ userId: member.id }]);
    const chatId = await chatIdOf(cid);
    const dm = (await request(t.http).post('/api/v1/chats/direct').set(bearer(owner.token)).send({ userId: member.id }).expect(200)).body.id as string;

    const sMember = await connect(member);
    const sOutsider = await connect(outsider);
    const leaked = collect(sOutsider, 'message:new', 600);
    const first = once<MessageDto>(sMember, 'message:new');
    await send(owner, chatId, 'в чате сообщества').expect(201);
    expect(await first).toMatchObject({ chatId, text: 'в чате сообщества', sender: { id: owner.id } });
    const second = once<MessageDto>(sMember, 'message:new');
    await send(owner, dm, 'лично').expect(201);
    expect(await second).toMatchObject({ chatId: dm, text: 'лично' });
    expect(await leaked).toEqual([]);
  });

  it('joins and leaves rooms on membership changes without reconnecting, with chats:changed', async () => {
    const owner = await createUser(t);
    const u = await createUser(t);
    const { body: com } = await request(t.http).post('/api/v1/communities').set(bearer(owner.token)).send({ name: `Live ${newId().slice(-8)}`, isPrivate: true }).expect(201);
    const s = await connect(u);

    const changedOnJoin = collect(s, 'chats:changed', 400);
    const notification = once<{ type: string }>(s, 'notification:new');
    await request(t.http).post(`/api/v1/communities/${com.id}/join`).set(bearer(u.token)).expect(200); // pending
    await request(t.http).post(`/api/v1/communities/${com.id}/requests/${u.id}/approve`).set(bearer(owner.token)).expect(204);
    expect((await changedOnJoin).length).toBeGreaterThanOrEqual(1);
    await settle();
    const msg = once<MessageDto>(s, 'message:new');
    await send(owner, com.chatId, 'welcome').expect(201);
    expect((await msg).text).toBe('welcome');
    expect((await notification).type).toBe('community_approved');

    const changedOnRemove = once(s, 'chats:changed');
    await request(t.http).delete(`/api/v1/communities/${com.id}/members/${u.id}`).set(bearer(owner.token)).expect(204);
    await changedOnRemove;
    await settle();
    const after = collect(s, 'message:new', 500);
    await send(owner, com.chatId, 'after removal').expect(201);
    expect(await after).toEqual([]);

    // chat:join is refused for chats the user isn't a member of.
    expect(await s.emitWithAck('chat:join', { chatId: com.chatId })).toEqual({ ok: false });
    expect(await s.emitWithAck('chat:join', { chatId: 'bad' })).toEqual({ ok: false });
  });

  it('chat:join re-joins a left room; soft delete removes everyone from the room', async () => {
    const owner = await createUser(t);
    const member = await createUser(t);
    const cid = await createCommunity(t, owner.id, [{ userId: member.id }]);
    const chatId = await chatIdOf(cid);
    const s = await connect(member);
    s.emit('chat:leave', { chatId });
    await settle();
    const none = collect(s, 'message:new', 400);
    await send(owner, chatId, 'not received').expect(201);
    expect(await none).toEqual([]);
    expect(await s.emitWithAck('chat:join', { chatId })).toEqual({ ok: true });
    const got = once<MessageDto>(s, 'message:new');
    await send(owner, chatId, 'received').expect(201);
    expect((await got).text).toBe('received');

    const changed = once(s, 'chats:changed');
    await request(t.http).delete(`/api/v1/communities/${cid}`).set(bearer(owner.token)).expect(204);
    await changed;
    expect(await s.emitWithAck('chat:join', { chatId })).toEqual({ ok: false });
  });

  it('relays typing to other members only, throttled to one per 3 s', async () => {
    const a = await createUser(t, { nickname: `typer_${newId().slice(-6)}` });
    const b = await createUser(t);
    const c = await createUser(t);
    const cid = await createCommunity(t, a.id, [{ userId: b.id }, { userId: c.id }]);
    const chatId = await chatIdOf(cid);
    const sA = await connect(a);
    const sA2 = await connect(a); // second tab of the typer
    const sB = await connect(b);
    const sC = await connect(c);
    const atB = collect<ChatTypingEvent>(sB, 'chat:typing', 700);
    const atC = collect<ChatTypingEvent>(sC, 'chat:typing', 700);
    const atSelf = collect<ChatTypingEvent>(sA2, 'chat:typing', 700);
    const atSelf1 = collect<ChatTypingEvent>(sA, 'chat:typing', 700);
    for (let i = 0; i < 5; i++) sA.emit('chat:typing', { chatId });
    const [b1, c1, self2, self1] = await Promise.all([atB, atC, atSelf, atSelf1]);
    expect(b1).toHaveLength(1);
    expect(b1[0]).toMatchObject({ chatId, user: { id: a.id } });
    expect(c1).toHaveLength(1);
    expect([...self1, ...self2]).toEqual([]);
    // After the throttle window it's relayed again.
    await t.redis.del(`typing:${chatId}:${a.id}`);
    const again = once<ChatTypingEvent>(sB, 'chat:typing');
    sA.emit('chat:typing', { chatId });
    expect((await again).user.id).toBe(a.id);
    // Typing into a chat you're not in is ignored.
    const outsider = await createUser(t);
    const sO = await connect(outsider);
    const quiet = collect(sB, 'chat:typing', 400);
    sO.emit('chat:typing', { chatId });
    expect(await quiet).toEqual([]);
  });

  it('emits chat:read and message:deleted to the room', async () => {
    const a = await createUser(t);
    const b = await createUser(t);
    const dm = (await request(t.http).post('/api/v1/chats/direct').set(bearer(a.token)).send({ userId: b.id }).expect(200)).body.id as string;
    const sA = await connect(a);
    const msg = (await send(a, dm, 'delete me').expect(201)).body as MessageDto;
    const read = once<ChatReadEvent>(sA, 'chat:read');
    await request(t.http).post(`/api/v1/chats/${dm}/read`).set(bearer(b.token)).expect(204);
    expect(await read).toMatchObject({ chatId: dm, userId: b.id, lastReadAt: expect.any(String) });
    const deleted = once<MessageDeletedEvent>(sA, 'message:deleted');
    await request(t.http).delete(`/api/v1/chats/${dm}/messages/${msg.id}`).set(bearer(a.token)).expect(204);
    expect(await deleted).toEqual({ chatId: dm, messageId: msg.id });
  });

  it('a new direct chat is joined live and skips Web Push while the recipient is connected', async () => {
    const a = await createUser(t);
    const b = await createUser(t);
    await request(t.http)
      .post('/api/v1/push/subscriptions')
      .set(bearer(b.token))
      .send({ endpoint: `https://fcm.googleapis.com/fcm/send/rt-${newId()}`, keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } })
      .expect(204);
    pushSender.reset();
    const sB = await connect(b);
    const changed = once(sB, 'chats:changed');
    const dm = (await request(t.http).post('/api/v1/chats/direct').set(bearer(a.token)).send({ userId: b.id }).expect(200)).body.id as string;
    await changed;
    await settle();
    const got = once<MessageDto>(sB, 'message:new');
    await send(a, dm, 'online').expect(201);
    expect((await got).text).toBe('online');
    await new Promise((r) => setTimeout(r, 300));
    expect(pushSender.sent).toEqual([]);

    sB.disconnect();
    await settle();
    await send(a, dm, 'offline').expect(201);
    await waitFor(() => pushSender.sent.length === 1);
    expect(pushSender.sent[0]!.payload.body).toBe('offline');
  });
});

describe('socket hardening (review M4 / L3)', () => {
  it('a removal racing the connect never leaves the socket in the chat room (25 iterations; under the 30/min message limit)', async () => {
    const owner = await createUser(t);
    const cid = await createCommunity(t, owner.id);
    const chatId = await chatIdOf(cid);
    for (let i = 0; i < 25; i++) {
      const m = await createUser(t);
      await request(t.http).post(`/api/v1/communities/${cid}/join`).set(bearer(m.token)).expect(200);
      const connecting = connect(m);
      // Spread the removal over the whole handshake (auth middleware → connection).
      await new Promise((r) => setTimeout(r, (i % 20) * 1.5));
      await request(t.http).delete(`/api/v1/communities/${cid}/members/${m.id}`).set(bearer(owner.token)).expect(204);
      const s = await connecting;
      await settle();
      const leaked = collect(s, 'message:new', 300);
      await send(owner, chatId, `after removal ${i}`).expect(201);
      expect(await leaked, `iteration ${i}`).toEqual([]);
      s.disconnect();
    }
  }, 90_000);

  it('disconnects a socket that floods client events', async () => {
    const u = await createUser(t);
    const s = await connect(u);
    const disconnected = once<string>(s, 'disconnect');
    for (let i = 0; i < 60; i++) s.emit('chat:join', { chatId: newId() }, () => undefined);
    expect(await disconnected).toBe('io server disconnect');
  });

  it('keeps at most 10 sockets per user, disconnecting the oldest', async () => {
    const u = await createUser(t);
    const first = await connect(u);
    const firstGone = once<string>(first, 'disconnect');
    const rest: Socket[] = [];
    for (let i = 0; i < 10; i++) rest.push(await connect(u));
    expect(await firstGone).toBe('io server disconnect');
    await settle();
    expect(rest.every((s) => s.connected)).toBe(true);
  });
});
