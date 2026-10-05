import type { AddressInfo } from 'node:net';
import type { NotificationDto } from '@autoc/shared';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SessionService } from '../src/common/auth/session.service';
import { UserStateService } from '../src/common/auth/user-state.service';
import { bearer, createTestApp, createUser, makeFriends, type TestApp } from './support/app';

let t: TestApp;
let baseUrl: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  t = await createTestApp();
  await t.app.listen(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${(t.app.getHttpServer().address() as AddressInfo).port}`;
});
afterEach(() => {
  for (const s of sockets.splice(0)) s.disconnect();
});
afterAll(async () => {
  await t.close();
});

function connect(token: string | undefined, opts: { transports?: ('polling' | 'websocket')[]; origin?: string } = {}): Socket {
  const socket = io(`${baseUrl}/rt`, {
    path: '/socket.io',
    auth: token === undefined ? {} : { token },
    transports: opts.transports ?? ['polling'],
    reconnection: false,
    forceNew: true,
    extraHeaders: opts.origin ? { Origin: opts.origin } : undefined,
  });
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

const connected = async (socket: Socket) => {
  if (!socket.connected) await once(socket, 'connect');
};

describe('Socket.IO /rt', () => {
  for (const transports of [['polling'], ['websocket']] as const) {
    it(`authenticates with the access token and delivers notifications (${transports[0]})`, async () => {
      const me = await createUser(t);
      const sender = await createUser(t, { nickname: `rt_sender_${transports[0]}` });
      const socket = connect(me.token, { transports: [...transports] });
      const count = once<{ count: number }>(socket, 'notification:count');
      await connected(socket);
      expect(await count).toEqual({ count: 0 });
      expect(socket.io.engine.transport.name).toBe(transports[0]);

      const notification = once<NotificationDto>(socket, 'notification:new');
      const newCount = once<{ count: number }>(socket, 'notification:count');
      const changed = once(socket, 'friends:changed');
      await request(t.http).post('/api/v1/friends/requests').set(bearer(sender.token)).send({ userId: me.id }).expect(201);
      const n = await notification;
      expect(n).toMatchObject({ type: 'friend_request', readAt: null, payload: { user: { id: sender.id, nickname: `rt_sender_${transports[0]}` } } });
      expect(await newCount).toEqual({ count: 1 });
      expect(await changed).toEqual({});

      const readCount = once<{ count: number }>(socket, 'notification:count');
      await request(t.http).post(`/api/v1/notifications/${n.id}/read`).set(bearer(me.token)).expect(204);
      expect(await readCount).toEqual({ count: 0 });
    });
  }

  it('sends friends:changed to both users on accept and unfriend', async () => {
    const a = await createUser(t);
    const b = await createUser(t);
    const sa = connect(a.token);
    const sb = connect(b.token);
    await Promise.all([connected(sa), connected(sb)]);
    const id = (await request(t.http).post('/api/v1/friends/requests').set(bearer(a.token)).send({ userId: b.id }).expect(201)).body.id;
    await new Promise((r) => setTimeout(r, 100));
    const changedA = once(sa, 'friends:changed');
    const changedB = once(sb, 'friends:changed');
    const accepted = once<NotificationDto>(sa, 'notification:new');
    await request(t.http).post(`/api/v1/friends/requests/${id}/accept`).set(bearer(b.token)).expect(204);
    await Promise.all([changedA, changedB]);
    expect((await accepted).type).toBe('friend_accepted');

    const unA = once(sa, 'friends:changed');
    const unB = once(sb, 'friends:changed');
    await request(t.http).delete(`/api/v1/friends/${a.id}`).set(bearer(b.token)).expect(204);
    await Promise.all([unA, unB]);
  });

  it('does not leak events to other users', async () => {
    const me = await createUser(t);
    const other = await createUser(t);
    const sender = await createUser(t);
    const mine = connect(me.token);
    const theirs = connect(other.token);
    await Promise.all([connected(mine), connected(theirs)]);
    let leaked = false;
    theirs.on('notification:new', () => (leaked = true));
    const got = once(mine, 'notification:new');
    await request(t.http).post('/api/v1/friends/requests').set(bearer(sender.token)).send({ userId: me.id }).expect(201);
    await got;
    await new Promise((r) => setTimeout(r, 200));
    expect(leaked).toBe(false);
  });

  it('rejects missing, invalid, revoked and blocked credentials with UNAUTHORIZED', async () => {
    const blocked = await createUser(t, { status: 'blocked' });
    const revoked = await createUser(t);
    await t.app.get(SessionService).markRevoked(revoked.id);
    for (const token of [undefined, 'garbage', `${revoked.token}x`, revoked.token, blocked.token]) {
      const socket = connect(token);
      const err = await once<Error & { data?: { code: string } }>(socket, 'connect_error');
      expect(err.message).toBe('UNAUTHORIZED');
      expect(socket.connected).toBe(false);
    }
  });

  it('rejects origins outside the allow-list and accepts the web origin', async () => {
    const u = await createUser(t);
    const bad = connect(u.token, { origin: 'https://evil.example' });
    await once(bad, 'connect_error');
    const good = connect(u.token, { origin: 'http://localhost:3000' });
    await connected(good);
  });

  it('emits session:revoked and disconnects every socket of the user on logout-all', async () => {
    const me = await createUser(t);
    const bystander = await createUser(t);
    await makeFriends(t, me.id, bystander.id);
    const s1 = connect(me.token);
    const s2 = connect(me.token, { transports: ['websocket'] });
    const other = connect(bystander.token);
    await Promise.all([connected(s1), connected(s2), connected(other)]);

    const revoked1 = once(s1, 'session:revoked');
    const revoked2 = once(s2, 'session:revoked');
    const disc1 = once<string>(s1, 'disconnect');
    const disc2 = once<string>(s2, 'disconnect');
    await request(t.http).post('/api/v1/auth/logout-all').set(bearer(me.token)).expect(204);
    expect(await revoked1).toEqual({});
    expect(await revoked2).toEqual({});
    expect(await disc1).toBe('io server disconnect');
    expect(await disc2).toBe('io server disconnect');
    await new Promise((r) => setTimeout(r, 100));
    expect(other.connected).toBe(true);

    // The old token can't reconnect.
    const again = connect(me.token);
    expect((await once<Error>(again, 'connect_error')).message).toBe('UNAUTHORIZED');
  });

  it('re-checks revocation after joining rooms (revocation racing the handshake)', async () => {
    const me = await createUser(t);
    const states = t.app.get(UserStateService);
    const original = states.getForAuth.bind(states);
    let calls = 0;
    // First check passes; the session is revoked before the second (post-join) check.
    states.getForAuth = async (userId: string) => {
      const r = await original(userId);
      if (userId === me.id && ++calls === 1) await t.app.get(SessionService).markRevoked(me.id);
      return r;
    };
    try {
      const socket = connect(me.token);
      expect((await once<Error>(socket, 'connect_error')).message).toBe('UNAUTHORIZED');
      expect(calls).toBeGreaterThanOrEqual(2);
    } finally {
      states.getForAuth = original;
    }
  });
});
