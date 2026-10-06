import type { ChatDto, MessageDto, NotificationDto, Paginated } from '@autoc/shared';
import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { chatKeys } from '@/features/chats/cache';
import { readStore, typingStore } from '@/features/chats/live-stores';
import { notificationKeys } from '@/features/notifications/queries';
import { bindRealtimeHandlers, createRealtimeConnection, realtimeUrl, type IoFactory, type RealtimeSocket } from './client';
import { createAppRealtimeHandlers } from './handlers';

type Listener = (...args: unknown[]) => void;

/** Minimal stand-in for a socket.io-client Socket. */
class FakeSocket {
  listeners = new Map<string, Set<Listener>>();
  connected = false;
  connect = vi.fn(() => {
    this.connected = true;
    return this;
  });
  disconnect = vi.fn(() => {
    this.connected = false;
    return this;
  });
  on(event: string, listener: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return this;
  }
  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    for (const l of this.listeners.get(event) ?? []) l(...args);
  }
  count(event: string) {
    return this.listeners.get(event)?.size ?? 0;
  }
}

function fakeIo() {
  const socket = new FakeSocket();
  let options: Record<string, unknown> = {};
  let url = '';
  const io = ((u: string, o: Record<string, unknown>) => {
    url = u;
    options = o;
    return socket as unknown as RealtimeSocket;
  }) as unknown as IoFactory;
  return { io, socket, getUrl: () => url, getOptions: () => options };
}

const notification = (id: string, type: NotificationDto['type'] = 'friend_request'): NotificationDto => ({
  id,
  type,
  payload: { requestId: 'r1', user: { id: 'u1', nickname: 'aidar', name: 'Aidar', avatarUrl: null, rating: 60, isPremium: false } },
  readAt: null,
  createdAt: '2026-10-05T10:00:00Z',
});

describe('realtimeUrl', () => {
  it('uses the API origin, or the page origin when same-origin', () => {
    expect(realtimeUrl('http://localhost:4000')).toBe('http://localhost:4000/rt');
    expect(realtimeUrl('https://api.example.com/')).toBe('https://api.example.com/rt');
    expect(realtimeUrl('')).toBe('/rt');
  });
});

describe('createRealtimeConnection', () => {
  it('handshakes on /socket.io with polling first and the current token', () => {
    const { io, getUrl, getOptions } = fakeIo();
    let token = 'a';
    createRealtimeConnection({ io, origin: 'http://api', getToken: () => token, refresh: vi.fn() });
    expect(getUrl()).toBe('http://api/rt');
    const options = getOptions();
    expect(options.path).toBe('/socket.io');
    expect(options.transports).toEqual(['polling', 'websocket']);
    expect(options.autoConnect).toBe(false);
    const auth = options.auth as (cb: (data: object) => void) => void;
    const seen: object[] = [];
    auth((d) => seen.push(d));
    token = 'b';
    auth((d) => seen.push(d));
    expect(seen).toEqual([{ token: 'a' }, { token: 'b' }]);
  });

  it('does not connect without a token', () => {
    const { io, socket } = fakeIo();
    const conn = createRealtimeConnection({ io, origin: '', getToken: () => null, refresh: vi.fn() });
    conn.connect();
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('refreshes the token and reconnects after an UNAUTHORIZED handshake', async () => {
    const { io, socket, getOptions } = fakeIo();
    let token = 'old';
    const refresh = vi.fn(async (stale: string | null) => {
      expect(stale).toBe('old');
      token = 'new';
      return token;
    });
    const conn = createRealtimeConnection({ io, origin: '', getToken: () => token, refresh });
    conn.connect();
    expect(socket.connect).toHaveBeenCalledTimes(1);
    (getOptions().auth as (cb: (d: object) => void) => void)(() => undefined); // handshake with "old"
    socket.connected = false;
    socket.emit('connect_error', new Error('UNAUTHORIZED'));
    await vi.waitFor(() => expect(socket.connect).toHaveBeenCalledTimes(2));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('gives up after repeated auth failures and ignores other errors', async () => {
    const { io, socket } = fakeIo();
    const refresh = vi.fn(async () => 'tok');
    const conn = createRealtimeConnection({ io, origin: '', getToken: () => 'tok', refresh, maxAuthRetries: 2 });
    conn.connect();
    socket.connected = false;
    socket.emit('connect_error', new Error('xhr poll error'));
    expect(refresh).not.toHaveBeenCalled();
    for (let i = 0; i < 4; i += 1) socket.emit('connect_error', Object.assign(new Error('x'), { data: { code: 'UNAUTHORIZED' } }));
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('stops reconnecting after disconnect()', async () => {
    const { io, socket } = fakeIo();
    const refresh = vi.fn(async () => 'tok');
    const conn = createRealtimeConnection({ io, origin: '', getToken: () => 'tok', refresh });
    conn.connect();
    conn.disconnect();
    expect(socket.disconnect).toHaveBeenCalled();
    socket.emit('connect_error', new Error('UNAUTHORIZED'));
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('bindRealtimeHandlers', () => {
  it('dispatches each server event and unbinds cleanly', () => {
    const socket = new FakeSocket();
    const handlers = {
      onNotification: vi.fn(),
      onCount: vi.fn(),
      onFriendsChanged: vi.fn(),
      onRevoked: vi.fn(),
      onMessage: vi.fn(),
      onMessageDeleted: vi.fn(),
      onTyping: vi.fn(),
      onRead: vi.fn(),
      onChatsChanged: vi.fn(),
      onSosNew: vi.fn(),
      onSosUpdate: vi.fn(),
    };
    const unbind = bindRealtimeHandlers(socket as unknown as RealtimeSocket, handlers);
    socket.emit('notification:new', notification('n1'));
    socket.emit('notification:count', { count: 3 });
    socket.emit('notification:count', {}); // malformed: ignored
    socket.emit('friends:changed', {});
    socket.emit('session:revoked', {});
    expect(handlers.onNotification).toHaveBeenCalledWith(notification('n1'));
    expect(handlers.onCount).toHaveBeenCalledTimes(1);
    expect(handlers.onCount).toHaveBeenCalledWith(3);
    expect(handlers.onFriendsChanged).toHaveBeenCalledTimes(1);
    expect(handlers.onRevoked).toHaveBeenCalledTimes(1);
    unbind();
    for (const e of ['notification:new', 'notification:count', 'friends:changed', 'session:revoked', 'message:new', 'chat:typing'])
      expect(socket.count(e)).toBe(0);
  });
});

describe('createAppRealtimeHandlers', () => {
  function setup() {
    const queryClient = new QueryClient();
    const toast = vi.fn();
    const logout = vi.fn();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const handlers = createAppRealtimeHandlers({ queryClient, toast, logout });
    return { queryClient, toast, logout, invalidate, handlers };
  }
  const invalidatedKeys = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.map((call) => JSON.stringify((call[0] as { queryKey: unknown }).queryKey));

  it('notification:new prepends to the cached list once, refreshes counts and friends, and toasts', () => {
    const { queryClient, toast, invalidate, handlers } = setup();
    const page: Paginated<NotificationDto> = { items: [notification('old', 'friend_accepted')], nextCursor: null };
    queryClient.setQueryData<InfiniteData<Paginated<NotificationDto>>>(notificationKeys.list, { pages: [page], pageParams: [null] });

    handlers.onNotification(notification('n1'));
    handlers.onNotification(notification('n1'));

    const data = queryClient.getQueryData<InfiniteData<Paginated<NotificationDto>>>(notificationKeys.list)!;
    expect(data.pages[0]!.items.map((n) => n.id)).toEqual(['n1', 'old']);
    expect(toast).toHaveBeenCalledTimes(2);
    const keys = invalidatedKeys(invalidate);
    expect(keys).toContain(JSON.stringify(notificationKeys.unread));
    expect(keys).toContain('["friends"]');
  });

  it('unknown notification types toast but leave friend data alone', () => {
    const { invalidate, toast, handlers } = setup();
    handlers.onNotification(notification('n2', 'event_new'));
    expect(toast).toHaveBeenCalled();
    expect(invalidatedKeys(invalidate)).not.toContain('["friends"]');
  });

  it('notification:count sets the unread badge', () => {
    const { queryClient, handlers } = setup();
    handlers.onCount(7);
    expect(queryClient.getQueryData(notificationKeys.unread)).toEqual({ count: 7 });
  });

  it('friends:changed invalidates friends, users and the map', () => {
    const { invalidate, handlers } = setup();
    handlers.onFriendsChanged();
    expect(invalidatedKeys(invalidate)).toEqual(expect.arrayContaining(['["friends"]', '["users"]', '["map"]']));
  });

  it('session:revoked logs out', () => {
    const { logout, handlers } = setup();
    handlers.onRevoked();
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('community notifications refresh community data', () => {
    const { invalidate, handlers } = setup();
    handlers.onNotification(notification('n5', 'community_approved'));
    expect(invalidatedKeys(invalidate)).toContain('["communities"]');
  });
});

describe('createAppRealtimeHandlers — chats', () => {
  const peer = { id: 'peer', nickname: 'peer', name: 'Peer', avatarUrl: null, rating: 50, isPremium: false };
  const message = (id: string, chatId = 'c1'): MessageDto => ({
    id,
    chatId,
    sender: peer,
    type: 'text',
    text: id,
    upload: null,
    lat: null,
    lng: null,
    createdAt: '2026-10-05T10:00:00Z',
    deletedAt: null,
  });
  const chat = (id: string, unreadCount: number): ChatDto => ({ id, type: 'direct', refId: null, title: id, avatarUrl: null, lastMessage: null, unreadCount });
  function setup() {
    const queryClient = new QueryClient();
    const handlers = createAppRealtimeHandlers({ queryClient, toast: vi.fn(), logout: vi.fn(), getMyId: () => 'me' });
    queryClient.setQueryData(chatKeys.list, { pages: [{ items: [chat('c0', 0), chat('c1', 1)], nextCursor: null }], pageParams: [null] });
    queryClient.setQueryData(chatKeys.messages('c1'), { pages: [{ items: [], nextCursor: null }], pageParams: [null] });
    return { queryClient, handlers, invalidate: vi.spyOn(queryClient, 'invalidateQueries') };
  }
  const list = (qc: QueryClient) => qc.getQueryData<InfiniteData<Paginated<ChatDto>>>(chatKeys.list)!.pages[0]!.items;

  it('message:new updates history, unread and order; typing mark ends', () => {
    const { queryClient, handlers } = setup();
    typingStore.add('c1', peer);
    handlers.onMessage(message('m1'));
    expect(list(queryClient).map((c) => [c.id, c.unreadCount])).toEqual([
      ['c1', 2],
      ['c0', 0],
    ]);
    const history = queryClient.getQueryData<InfiniteData<Paginated<MessageDto>>>(chatKeys.messages('c1'))!;
    expect(history.pages[0]!.items.map((m) => m.id)).toEqual(['m1']);
    expect(typingStore.get('c1')).toEqual([]);
  });

  it('message:new for an unknown chat refetches the list', () => {
    const { handlers, invalidate } = setup();
    handlers.onMessage(message('m1', 'other'));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.list });
  });

  it('message:deleted, chat:typing, chat:read and chats:changed', () => {
    const { queryClient, handlers, invalidate } = setup();
    handlers.onMessage(message('m1'));
    handlers.onMessageDeleted({ chatId: 'c1', messageId: 'm1' });
    const history = queryClient.getQueryData<InfiniteData<Paginated<MessageDto>>>(chatKeys.messages('c1'))!;
    expect(history.pages[0]!.items[0]!.deletedAt).not.toBeNull();

    handlers.onTyping({ chatId: 'c9', user: peer });
    handlers.onTyping({ chatId: 'c9', user: { ...peer, id: 'me' } });
    expect(typingStore.get('c9').map((u) => u.id)).toEqual(['peer']);
    typingStore.remove('c9', 'peer');

    handlers.onRead({ chatId: 'c1', userId: 'peer', lastReadAt: '2026-10-05T10:00:00Z' });
    expect(readStore.latestPeerRead('c1', 'me')).toBe(Date.parse('2026-10-05T10:00:00Z'));
    expect(list(queryClient).find((c) => c.id === 'c1')!.unreadCount).toBe(2);
    handlers.onRead({ chatId: 'c1', userId: 'me', lastReadAt: '2026-10-05T10:00:00Z' });
    expect(list(queryClient).find((c) => c.id === 'c1')!.unreadCount).toBe(0);

    handlers.onChatsChanged();
    const keys = invalidate.mock.calls.map((call) => JSON.stringify((call[0] as { queryKey?: unknown }).queryKey));
    expect(keys).toContain('["communities"]');
  });
});

describe('SOS realtime', () => {
  it('sos:new caches the SOS and raises one alert; sos_nearby joins it instead of toasting', async () => {
    const { sos } = await import('@/features/sos/fixtures');
    const queryClient = new QueryClient();
    const toast = vi.fn();
    const alerts = { push: vi.fn(), remove: vi.fn() };
    const handlers = createAppRealtimeHandlers({ queryClient, toast, logout: vi.fn(), alerts });
    const s = sos({ myRole: 'viewer' });
    handlers.onSosNew(s);
    expect(queryClient.getQueryData(['sos', 'detail', 's1'])).toEqual(s);
    expect(alerts.push).toHaveBeenCalledWith(expect.objectContaining({ sosId: 's1', type: 'flat_tire' }));
    handlers.onNotification({ id: 'n', type: 'sos_nearby', payload: { sosId: 's1', type: 'flat_tire' }, readAt: null, createdAt: '2026-10-05T10:00:00Z' });
    expect(toast).not.toHaveBeenCalled();
    expect(alerts.push).toHaveBeenCalledTimes(2);
    handlers.onSosUpdate({ ...s, status: 'closed' });
    expect(alerts.remove).toHaveBeenCalledWith('s1');
  });

  it('binds sos:new / sos:update and drops malformed payloads', () => {
    const socket = new FakeSocket();
    const onSosNew = vi.fn();
    const onSosUpdate = vi.fn();
    const noop = vi.fn();
    bindRealtimeHandlers(socket as unknown as RealtimeSocket, {
      onNotification: noop, onCount: noop, onFriendsChanged: noop, onRevoked: noop, onMessage: noop,
      onMessageDeleted: noop, onTyping: noop, onRead: noop, onChatsChanged: noop, onSosNew, onSosUpdate,
    });
    socket.emit('sos:new', { nope: true });
    socket.emit('sos:update', { id: 'x', status: 'closed', responses: [] });
    expect(onSosNew).not.toHaveBeenCalled();
    expect(onSosUpdate).toHaveBeenCalledTimes(1);
  });
});
