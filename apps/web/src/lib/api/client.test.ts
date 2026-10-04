import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import { ApiError } from './errors';
import { createSession, type ChannelLike, type LockManagerLike, type SessionDeps, type SessionEvent } from './session';

const BASE = 'http://api.test/api/v1';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

/**
 * In-memory API with the real server's strict refresh rotation: the refresh cookie is read when the
 * request arrives and checked after a delay, so two overlapping refreshes with the same cookie are
 * detected as reuse and revoke the session.
 */
function fakeServer() {
  const state = {
    cookie: 'rt-0' as string | null,
    validRefresh: 'rt-0' as string | null,
    validAccess: new Set<string>(),
    refreshCalls: 0,
    csrfHeaders: [] as Array<string | null>,
    revoked: false,
    n: 0,
  };

  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (url.endsWith('/auth/refresh')) {
      state.refreshCalls += 1;
      state.csrfHeaders.push(headers.get('X-CSRF-Token'));
      expect(init?.credentials).toBe('include');
      const sent = state.cookie;
      await sleep(5);
      if (!sent || sent !== state.validRefresh) {
        state.revoked = true;
        state.validRefresh = null;
        state.cookie = null;
        return json(401, { error: { code: 'SESSION_EXPIRED', message: 'Session expired' } });
      }
      state.n += 1;
      state.validRefresh = `rt-${state.n}`;
      state.cookie = state.validRefresh;
      const accessToken = `at-${state.n}`;
      state.validAccess.add(accessToken);
      return json(200, { accessToken });
    }
    const token = headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    if (!state.validAccess.has(token)) return json(401, { error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
    if (url.endsWith('/me')) return json(200, { id: 'u1', token });
    return new Response(null, { status: 204 });
  });

  return { state, fetch: fetch as unknown as typeof globalThis.fetch, mock: fetch };
}

/** Web Locks stand-in: one FIFO mutex shared by every "tab". */
function fakeLocks(): LockManagerLike {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    request<T>(_name: string, callback: () => Promise<T>): Promise<T> {
      const run = tail.then(callback);
      tail = run.catch(() => undefined);
      return run;
    },
  };
}

/** BroadcastChannel stand-in: async delivery to every other channel with the same name. */
function fakeChannelBus() {
  const channels: Array<{ name: string; listeners: Array<(event: MessageEvent<unknown>) => void> }> = [];
  return (name: string): ChannelLike => {
    const self = { name, listeners: [] as Array<(event: MessageEvent<unknown>) => void> };
    channels.push(self);
    return {
      postMessage(message) {
        for (const other of channels) {
          if (other === self || other.name !== name) continue;
          setTimeout(() => other.listeners.forEach((listener) => listener(new MessageEvent('message', { data: message }))), 0);
        }
      },
      addEventListener(_type, listener) {
        self.listeners.push(listener);
      },
    };
  };
}

function makeTab(server: ReturnType<typeof fakeServer>, extra: Partial<SessionDeps> = {}) {
  const session = createSession({ baseUrl: BASE, fetch: server.fetch, readCsrfToken: () => 'csrf-1', ...extra });
  const events: SessionEvent[] = [];
  session.subscribe((event) => events.push(event));
  const client = createApiClient({ baseUrl: BASE, fetch: server.fetch, session });
  return { session, client, events };
}

describe('api client', () => {
  it('sends the bearer token and parses JSON', async () => {
    const server = fakeServer();
    server.state.validAccess.add('at-live');
    const { session, client } = makeTab(server);
    session.setAccessToken('at-live');

    await expect(client.request('/me')).resolves.toEqual({ id: 'u1', token: 'at-live' });
    const headers = new Headers(server.mock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer at-live');
    expect(server.state.refreshCalls).toBe(0);
  });

  it('on 401 refreshes once with the CSRF header and retries the request', async () => {
    const server = fakeServer();
    const { session, client } = makeTab(server);
    session.setAccessToken('at-expired');

    await expect(client.request('/me')).resolves.toEqual({ id: 'u1', token: 'at-1' });
    expect(server.state.refreshCalls).toBe(1);
    expect(server.state.csrfHeaders).toEqual(['csrf-1']);
    expect(session.getAccessToken()).toBe('at-1');
  });

  it('concurrent 401s trigger a single refresh', async () => {
    const server = fakeServer();
    const { session, client } = makeTab(server);
    session.setAccessToken('at-expired');

    const results = await Promise.all([client.request('/me'), client.request('/me'), client.request('/a'), client.request('/b')]);
    expect(server.state.refreshCalls).toBe(1);
    expect(server.state.revoked).toBe(false);
    expect(results[0]).toEqual({ id: 'u1', token: 'at-1' });
  });

  it('a 401 that arrives after another request already refreshed reuses the new token', async () => {
    const server = fakeServer();
    const { session, client } = makeTab(server);
    session.setAccessToken('at-expired');
    await client.request('/me');
    // A request sent with the old token comes back 401 later:
    await expect(session.refresh('at-expired')).resolves.toBe('at-1');
    expect(server.state.refreshCalls).toBe(1);
  });

  it('serializes refreshes across tabs and shares the token (no reuse → session survives)', async () => {
    const server = fakeServer();
    const locks = fakeLocks();
    const createChannel = fakeChannelBus();
    const tabA = makeTab(server, { getLocks: () => locks, createChannel });
    const tabB = makeTab(server, { getLocks: () => locks, createChannel });

    // Both tabs restore the session at the same moment (e.g. two tabs opened together).
    const [a, b] = await Promise.all([tabA.session.refresh(null), tabB.session.refresh(null)]);
    expect(server.state.revoked).toBe(false);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    await expect(tabB.client.request('/me')).resolves.toMatchObject({ id: 'u1' });
    await expect(tabA.client.request('/me')).resolves.toMatchObject({ id: 'u1' });
  });

  it('without a cross-tab lock, overlapping refreshes would be treated as token reuse', async () => {
    // Documents why the lock exists: the fake server revokes on reuse, like the real one.
    const server = fakeServer();
    const tabA = makeTab(server);
    const tabB = makeTab(server);
    await Promise.all([tabA.session.refresh(null), tabB.session.refresh(null)]);
    expect(server.state.revoked).toBe(true);
  });

  it('a failed refresh ends the session and reports 401', async () => {
    const server = fakeServer();
    server.state.cookie = 'rt-stolen';
    const { session, client, events } = makeTab(server);
    session.setAccessToken('at-expired');

    const error = await client.request('/me').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401 });
    expect(session.getAccessToken()).toBeNull();
    expect(events.at(-1)).toEqual({ type: 'logout', reason: 'expired' });
  });

  it('does not call the API when there is no CSRF cookie (no session)', async () => {
    const server = fakeServer();
    const { session, client } = makeTab(server, { readCsrfToken: () => null });
    await expect(session.refresh(null)).resolves.toBeNull();
    await expect(client.request('/me')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(server.mock).not.toHaveBeenCalled();
  });

  it('ACCOUNT_BLOCKED marks the session blocked', async () => {
    const fetch = vi.fn(async () => json(403, { error: { code: 'ACCOUNT_BLOCKED', message: 'Blocked' } }));
    const session = createSession({ baseUrl: BASE, fetch: fetch as unknown as typeof globalThis.fetch, readCsrfToken: () => 'c' });
    const events: SessionEvent[] = [];
    session.subscribe((event) => events.push(event));
    session.setAccessToken('at');
    const client = createApiClient({ baseUrl: BASE, fetch: fetch as unknown as typeof globalThis.fetch, session });

    await expect(client.request('/me')).rejects.toMatchObject({ code: 'ACCOUNT_BLOCKED', status: 403 });
    expect(events).toContainEqual({ type: 'blocked' });
    expect(session.getAccessToken()).toBeNull();
  });

  it('public requests send no token and never refresh', async () => {
    const fetch = vi.fn(async () => json(400, { error: { code: 'OTP_INVALID', message: 'Wrong code', details: { attemptsLeft: 2 } } }));
    const session = createSession({ baseUrl: BASE, fetch: fetch as unknown as typeof globalThis.fetch, readCsrfToken: () => 'c' });
    const client = createApiClient({ baseUrl: BASE, fetch: fetch as unknown as typeof globalThis.fetch, session });

    await expect(client.request('/auth/otp/verify', { method: 'POST', json: {}, auth: false })).rejects.toMatchObject({
      code: 'OTP_INVALID',
      details: { attemptsLeft: 2 },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const init = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init[1].headers).has('Authorization')).toBe(false);
  });

  it('turns fetch failures into NETWORK_ERROR', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const session = createSession({ baseUrl: BASE, fetch: fetch as unknown as typeof globalThis.fetch, readCsrfToken: () => null });
    const client = createApiClient({ baseUrl: BASE, fetch: fetch as unknown as typeof globalThis.fetch, session });
    await expect(client.request('/auth/providers', { auth: false })).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });

  it('returns undefined for 204', async () => {
    const server = fakeServer();
    server.state.validAccess.add('at-live');
    const { session, client } = makeTab(server);
    session.setAccessToken('at-live');
    await expect(client.request('/me/vehicles/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('logout revokes the cookie with the CSRF header and tells other tabs', async () => {
    const server = fakeServer();
    const createChannel = fakeChannelBus();
    const tabA = makeTab(server, { createChannel });
    const tabB = makeTab(server, { createChannel });
    tabA.session.setAccessToken('at-x');
    await sleep(1);
    expect(tabB.session.getAccessToken()).toBe('at-x');

    await tabA.session.logout();
    await sleep(1);
    const call = server.mock.mock.calls.find(([url]) => String(url).endsWith('/auth/logout'));
    expect(new Headers(call?.[1]?.headers).get('X-CSRF-Token')).toBe('csrf-1');
    expect(tabB.session.getAccessToken()).toBeNull();
    expect(tabB.events.at(-1)).toEqual({ type: 'logout', reason: 'remote' });
  });
});
