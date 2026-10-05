import type { UserMini } from '@autoc/shared';

/**
 * Small external stores for live, non-cached chat state (typing users, other members' read marks),
 * read with `useSyncExternalStore`. Timers and clocks are injectable for tests.
 */

type Listener = () => void;

function createEmitter() {
  const listeners = new Set<Listener>();
  return {
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit() {
      for (const listener of listeners) listener();
    },
  };
}

/* ---------- throttle (chat:typing is sent at most once per interval) ---------- */

/** Returns `true` when the action may run now, `false` while still inside the interval of the last run. */
export function createThrottle(intervalMs: number, now: () => number = Date.now): () => boolean {
  let last = Number.NEGATIVE_INFINITY;
  return () => {
    const t = now();
    if (t - last < intervalMs) return false;
    last = t;
    return true;
  };
}

/* ---------- typing ---------- */

/** How long a "typing" mark lives without a new `chat:typing` (the server relays one per 3 s at most). */
export const TYPING_TTL_MS = 6_000;

export type TimerApi = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

const realTimers: TimerApi = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createTypingStore(ttlMs = TYPING_TTL_MS, timers: TimerApi = realTimers) {
  const emitter = createEmitter();
  // chatId → userId → { user, timer }
  const state = new Map<string, Map<string, { user: UserMini; timer: unknown }>>();
  const snapshots = new Map<string, UserMini[]>();
  const EMPTY: UserMini[] = [];

  function refresh(chatId: string) {
    const users = state.get(chatId);
    if (!users || users.size === 0) {
      state.delete(chatId);
      snapshots.delete(chatId);
    } else {
      snapshots.set(chatId, [...users.values()].map((entry) => entry.user));
    }
    emitter.emit();
  }

  function remove(chatId: string, userId: string) {
    const users = state.get(chatId);
    const entry = users?.get(userId);
    if (!users || !entry) return;
    timers.clearTimeout(entry.timer);
    users.delete(userId);
    refresh(chatId);
  }

  return {
    subscribe: emitter.subscribe,
    add(chatId: string, user: UserMini) {
      const users = state.get(chatId) ?? new Map();
      state.set(chatId, users);
      const existing = users.get(user.id);
      if (existing) timers.clearTimeout(existing.timer);
      const timer = timers.setTimeout(() => remove(chatId, user.id), ttlMs);
      users.set(user.id, { user, timer });
      refresh(chatId);
    },
    /** A message from the user ends their typing mark. */
    remove,
    get(chatId: string): UserMini[] {
      return snapshots.get(chatId) ?? EMPTY;
    },
  };
}

export const typingStore = createTypingStore();

/* ---------- read marks (chat:read from other members) ---------- */

export function createReadStore() {
  const emitter = createEmitter();
  // chatId → userId → lastReadAt (ms)
  const state = new Map<string, Map<string, number>>();
  return {
    subscribe: emitter.subscribe,
    set(chatId: string, userId: string, lastReadAt: string) {
      const time = Date.parse(lastReadAt);
      if (!Number.isFinite(time)) return;
      const users = state.get(chatId) ?? new Map<string, number>();
      state.set(chatId, users);
      if ((users.get(userId) ?? 0) >= time) return;
      users.set(userId, time);
      emitter.emit();
    },
    /** Latest read time of anyone but `myId` (ms since epoch, 0 when unknown). */
    latestPeerRead(chatId: string, myId: string | null): number {
      let latest = 0;
      for (const [userId, time] of state.get(chatId) ?? []) if (userId !== myId && time > latest) latest = time;
      return latest;
    },
  };
}

export const readStore = createReadStore();
