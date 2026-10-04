import { createApiClient } from './client';
import { API_BASE_URL, CSRF_COOKIE } from './config';
import { createEndpoints } from './endpoints';
import { createSession, readCookie, type ChannelLike, type LockManagerLike } from './session';

export * from './errors';
export type { SessionEvent, LogoutReason } from './session';

const isBrowser = typeof window !== 'undefined';

/** The app-wide session (one per tab). */
export const session = createSession({
  baseUrl: API_BASE_URL,
  fetch: (input, init) => fetch(input, init),
  readCsrfToken: () => readCookie(CSRF_COOKIE),
  getLocks: () => (isBrowser && 'locks' in navigator && navigator.locks ? (navigator.locks as LockManagerLike) : null),
  createChannel: (name) =>
    isBrowser && typeof BroadcastChannel !== 'undefined' ? (new BroadcastChannel(name) as ChannelLike) : null,
});

export const apiClient = createApiClient({ baseUrl: API_BASE_URL, fetch: (input, init) => fetch(input, init), session });

export const api = createEndpoints(apiClient);
