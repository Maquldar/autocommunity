import { CSRF_HEADER } from './config';
import { networkError, parseApiError } from './errors';

export type LogoutReason = 'user' | 'expired' | 'remote';

export type SessionEvent =
  | { type: 'token' }
  | { type: 'logout'; reason: LogoutReason }
  | { type: 'blocked' };

/** Messages exchanged between tabs over BroadcastChannel. */
type ChannelMessage = { type: 'token'; token: string } | { type: 'logout' } | { type: 'blocked' };

/** The subset of the Web Locks API we use (navigator.locks). */
export type LockManagerLike = {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
};

/** The subset of BroadcastChannel we use. */
export type ChannelLike = {
  postMessage(message: ChannelMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
};

export type SessionDeps = {
  baseUrl: string;
  fetch: typeof fetch;
  readCsrfToken: () => string | null;
  /** Cross-tab mutex. Null → only the in-tab single flight applies. */
  getLocks?: () => LockManagerLike | null;
  /** Cross-tab token sharing. Null → each tab refreshes on its own (still serialized by the lock). */
  createChannel?: (name: string) => ChannelLike | null;
};

export const REFRESH_LOCK = 'autoc:auth-refresh';
export const AUTH_CHANNEL = 'autoc:auth';

function isChannelMessage(value: unknown): value is ChannelMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  const { type } = value as { type: unknown };
  if (type === 'token') return typeof (value as { token?: unknown }).token === 'string';
  return type === 'logout' || type === 'blocked';
}

export type Session = ReturnType<typeof createSession>;

/**
 * Access token (memory only) plus refresh coordination.
 *
 * The API rotates refresh tokens strictly: two refreshes with the same cookie revoke the session.
 * So there is at most one refresh in flight per tab (shared promise), refreshes are serialized
 * across tabs with a Web Lock, and the winner broadcasts the new access token so the other tabs
 * can use it instead of refreshing again.
 */
export function createSession(deps: SessionDeps) {
  let accessToken: string | null = null;
  // Bumped on every token change, so a waiter can tell that another tab refreshed meanwhile.
  let version = 0;
  let inflight: Promise<string | null> | null = null;
  const listeners = new Set<(event: SessionEvent) => void>();
  let channel: ChannelLike | null | undefined;

  function emit(event: SessionEvent) {
    for (const listener of listeners) listener(event);
  }

  function getChannel(): ChannelLike | null {
    if (channel !== undefined) return channel;
    channel = deps.createChannel?.(AUTH_CHANNEL) ?? null;
    channel?.addEventListener('message', (event) => {
      if (!isChannelMessage(event.data)) return;
      const message = event.data;
      if (message.type === 'token') {
        accessToken = message.token;
        version += 1;
        emit({ type: 'token' });
      } else if (message.type === 'logout') {
        reset();
        emit({ type: 'logout', reason: 'remote' });
      } else {
        reset();
        emit({ type: 'blocked' });
      }
    });
    return channel;
  }

  function broadcast(message: ChannelMessage) {
    getChannel()?.postMessage(message);
  }

  function reset() {
    accessToken = null;
    version += 1;
  }

  function setAccessToken(token: string) {
    accessToken = token;
    version += 1;
    broadcast({ type: 'token', token });
    emit({ type: 'token' });
  }

  /** Drops the local session and tells the other tabs. Does not call the API. */
  function clear(reason: Exclude<LogoutReason, 'remote'>) {
    reset();
    broadcast({ type: 'logout' });
    emit({ type: 'logout', reason });
  }

  function markBlocked() {
    reset();
    broadcast({ type: 'blocked' });
    emit({ type: 'blocked' });
    // A blocked account can't use its refresh token anyway; drop the cookies too.
    void revokeRefreshCookie();
  }

  async function requestNewToken(): Promise<string | null> {
    const csrf = deps.readCsrfToken();
    if (!csrf) {
      // No CSRF cookie means no refresh cookie either: there is no session to restore.
      if (accessToken) clear('expired');
      return null;
    }
    let response: Response;
    try {
      response = await deps.fetch(`${deps.baseUrl}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { [CSRF_HEADER]: csrf },
      });
    } catch (cause) {
      throw networkError(cause);
    }
    if (response.ok) {
      const body = (await response.json()) as { accessToken: string };
      setAccessToken(body.accessToken);
      return body.accessToken;
    }
    const error = await parseApiError(response);
    if (error.code === 'ACCOUNT_BLOCKED') {
      markBlocked();
      return null;
    }
    if (response.status === 401 || response.status === 403) {
      // SESSION_EXPIRED / CSRF_FAILED: the server already cleared the cookies.
      if (accessToken) clear('expired');
      else reset();
      return null;
    }
    // 429 / 5xx: keep the session; the caller sees the error and may retry later.
    throw error;
  }

  /**
   * Returns a fresh access token, or null when there is no session.
   * `staleToken` is the token a request was rejected with: if the token has changed since, it is
   * returned right away instead of refreshing again (handles 401s that arrive after a refresh).
   */
  function refresh(staleToken?: string | null): Promise<string | null> {
    getChannel();
    if (staleToken !== undefined && accessToken !== null && accessToken !== staleToken) {
      return Promise.resolve(accessToken);
    }
    if (inflight) return inflight;

    const startVersion = version;
    const run = async () => {
      // Another tab refreshed while we waited for the lock and broadcast its token: reuse it.
      if (version !== startVersion && accessToken) return accessToken;
      return requestNewToken();
    };
    const locks = deps.getLocks?.() ?? null;
    inflight = (locks ? locks.request(REFRESH_LOCK, run) : run()).finally(() => {
      inflight = null;
    });
    return inflight;
  }

  /** POST /auth/logout (cookie + CSRF): revokes the refresh token and clears the cookies. Best effort. */
  async function revokeRefreshCookie(): Promise<void> {
    const csrf = deps.readCsrfToken();
    if (!csrf) return;
    try {
      await deps.fetch(`${deps.baseUrl}/auth/logout`, { method: 'POST', credentials: 'include', headers: { [CSRF_HEADER]: csrf } });
    } catch {
      // Offline: the local session still ends; the refresh token expires on its own.
    }
  }

  /** Signs out on the server, then clears the session in every tab. */
  async function logout(): Promise<void> {
    await revokeRefreshCookie();
    clear('user');
  }

  return {
    getAccessToken: () => accessToken,
    logout,
    setAccessToken,
    refresh,
    clear,
    markBlocked,
    /** Whether a refresh cookie may exist (the readable CSRF twin is present). */
    hasStoredSession: () => deps.readCsrfToken() !== null,
    subscribe(listener: (event: SessionEvent) => void): () => void {
      getChannel();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Reads a cookie visible to this document. */
export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      const value = rest.join('=');
      return value ? decodeURIComponent(value) : null;
    }
  }
  return null;
}
