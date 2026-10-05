import type { ClientToServerEvents, NotificationDto, ServerToClientEvents } from '@autoc/shared';
import type { ManagerOptions, Socket, SocketOptions } from 'socket.io-client';

/**
 * Socket.IO client for the `/rt` namespace (API.md §2).
 *
 * - `auth` is a callback, so every (re)connect handshakes with the current in-memory access token.
 * - A handshake rejected with `UNAUTHORIZED` (expired token) refreshes the session once and reconnects.
 * - Transports start with HTTP long-polling and upgrade to WebSocket when possible; the demo deploy
 *   proxies HTTP only, so polling alone must work.
 */

export type RealtimeSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type IoFactory = (url: string, options: Partial<ManagerOptions & SocketOptions>) => RealtimeSocket;

export const RT_NAMESPACE = '/rt';
export const RT_PATH = '/socket.io';

/** `''` (same-origin deploy) → `/rt` on the page's own host. */
export function realtimeUrl(apiOrigin: string): string {
  return `${apiOrigin.replace(/\/+$/, '')}${RT_NAMESPACE}`;
}

export type RealtimeHandlers = {
  onNotification: (notification: NotificationDto) => void;
  onCount: (count: number) => void;
  onFriendsChanged: () => void;
  onRevoked: () => void;
};

/** Subscribes the typed server events; returns an unsubscribe function. */
export function bindRealtimeHandlers(socket: Pick<RealtimeSocket, 'on' | 'off'>, handlers: RealtimeHandlers): () => void {
  const onNew: ServerToClientEvents['notification:new'] = (n) => handlers.onNotification(n);
  const onCount: ServerToClientEvents['notification:count'] = (p) => {
    if (p && typeof p.count === 'number') handlers.onCount(p.count);
  };
  const onFriends: ServerToClientEvents['friends:changed'] = () => handlers.onFriendsChanged();
  const onRevoked: ServerToClientEvents['session:revoked'] = () => handlers.onRevoked();
  socket.on('notification:new', onNew);
  socket.on('notification:count', onCount);
  socket.on('friends:changed', onFriends);
  socket.on('session:revoked', onRevoked);
  return () => {
    socket.off('notification:new', onNew);
    socket.off('notification:count', onCount);
    socket.off('friends:changed', onFriends);
    socket.off('session:revoked', onRevoked);
  };
}

export type ConnectionDeps = {
  io: IoFactory;
  origin: string;
  getToken: () => string | null;
  /** Session refresh; `staleToken` is the token the server rejected. Resolves null when signed out. */
  refresh: (staleToken: string | null) => Promise<string | null>;
  /** Consecutive UNAUTHORIZED handshakes before giving up (until `connect()` is called again). */
  maxAuthRetries?: number;
};

function isUnauthorized(error: Error & { data?: unknown }): boolean {
  if (error.message === 'UNAUTHORIZED') return true;
  const data = error.data as { code?: unknown } | undefined;
  return typeof data === 'object' && data !== null && data.code === 'UNAUTHORIZED';
}

export function createRealtimeConnection(deps: ConnectionDeps) {
  const maxAuthRetries = deps.maxAuthRetries ?? 2;
  let authFailures = 0;
  let lastToken: string | null = null;
  let wanted = false;

  const socket = deps.io(realtimeUrl(deps.origin), {
    path: RT_PATH,
    autoConnect: false,
    transports: ['polling', 'websocket'],
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 15_000,
    auth: (cb: (data: object) => void) => {
      lastToken = deps.getToken();
      cb({ token: lastToken });
    },
  });

  socket.on('connect', () => {
    authFailures = 0;
  });

  socket.on('connect_error', (error: Error & { data?: unknown }) => {
    if (!isUnauthorized(error) || !wanted) return;
    // Middleware rejections are not retried by Socket.IO: refresh the token and reconnect ourselves.
    authFailures += 1;
    if (authFailures > maxAuthRetries) return;
    void deps
      .refresh(lastToken)
      .then((token) => {
        if (token && wanted && !socket.connected) socket.connect();
      })
      .catch(() => undefined);
  });

  return {
    socket,
    /** Connects (or reconnects after an auth failure) when a token is available. */
    connect() {
      wanted = true;
      authFailures = 0;
      if (!socket.connected && deps.getToken()) socket.connect();
    },
    disconnect() {
      wanted = false;
      socket.disconnect();
    },
    isConnected: () => socket.connected,
  };
}

export type RealtimeConnection = ReturnType<typeof createRealtimeConnection>;
