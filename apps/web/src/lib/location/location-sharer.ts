import { distanceMeters } from '@/lib/geo';

/**
 * Foreground location sharing (SPEC A-4, F-9).
 *
 * - Watches the position only while the document is visible; a hidden tab stops the watch.
 * - Sends PUT /me/location when BOTH 30 s have passed since the last update AND the driver moved
 *   more than 100 m ("whichever comes later"), so a moving car sends at most every 30 s and a parked
 *   one sends nothing.
 * - A parked driver would drop off the map after 15 min (API visibility rule), so the last fix is
 *   re-sent as a heartbeat every 5 min while the app is open.
 */

export type Fix = { lat: number; lng: number; accuracyM?: number };
export type SentFix = Fix & { at: number };

export type ThrottlePolicy = { minIntervalMs: number; minDistanceM: number; heartbeatMs: number };

export const DEFAULT_POLICY: ThrottlePolicy = { minIntervalMs: 30_000, minDistanceM: 100, heartbeatMs: 5 * 60_000 };

/** Pure decision: should `next` be sent now, given the last sent fix? */
export function shouldSend(last: SentFix | null, next: Fix, now: number, policy: ThrottlePolicy = DEFAULT_POLICY): boolean {
  if (!last) return true;
  const elapsed = now - last.at;
  if (elapsed < policy.minIntervalMs) return false;
  if (elapsed >= policy.heartbeatMs) return true;
  return distanceMeters(last, next) > policy.minDistanceM;
}

export type SharerStatus =
  /** Not started (no consent yet, or stopped). */
  | 'off'
  /** Waiting for the first fix (permission prompt may be open). */
  | 'starting'
  | 'active'
  /** Tab hidden: watch stopped until it is visible again. */
  | 'paused'
  | 'denied'
  | 'unavailable'
  | 'unsupported';

export type GeolocationLike = Pick<Geolocation, 'watchPosition' | 'clearWatch'>;

export type VisibilityLike = {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
};

export type SharerDeps = {
  geolocation: GeolocationLike | null;
  visibility: VisibilityLike | null;
  send: (fix: Fix) => Promise<void>;
  now?: () => number;
  policy?: ThrottlePolicy;
  /** How often a pending or heartbeat update is re-checked while visible. */
  tickMs?: number;
  onChange?: (state: SharerState) => void;
};

export type SharerState = { status: SharerStatus; position: Fix | null; lastSentAt: number | null };

/** PERMISSION_DENIED from GeolocationPositionError (constants aren't available outside browsers). */
const PERMISSION_DENIED = 1;

export function createLocationSharer(deps: SharerDeps) {
  const now = deps.now ?? (() => Date.now());
  const policy = deps.policy ?? DEFAULT_POLICY;
  const tickMs = deps.tickMs ?? 10_000;

  let started = false;
  let watchId: number | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let latest: Fix | null = null;
  let lastSent: SentFix | null = null;
  let sending = false;
  let state: SharerState = { status: 'off', position: null, lastSentAt: null };

  function set(patch: Partial<SharerState>) {
    state = { ...state, ...patch };
    deps.onChange?.(state);
  }

  async function maybeSend() {
    if (!latest || sending || !started) return;
    const fix = latest;
    const at = now();
    if (!shouldSend(lastSent, fix, at, policy)) return;
    sending = true;
    try {
      await deps.send(fix);
      lastSent = { ...fix, at };
      set({ lastSentAt: at });
    } catch {
      // Offline / server error: keep the fix, the next tick or fix retries.
    } finally {
      sending = false;
    }
  }

  function onPosition(position: GeolocationPosition) {
    const { latitude, longitude, accuracy } = position.coords;
    latest = { lat: latitude, lng: longitude, accuracyM: Number.isFinite(accuracy) ? Math.round(accuracy) : undefined };
    set({ status: 'active', position: latest });
    void maybeSend();
  }

  function onError(error: GeolocationPositionError) {
    if (error.code === PERMISSION_DENIED) {
      stopWatching();
      set({ status: 'denied' });
      return;
    }
    // POSITION_UNAVAILABLE / TIMEOUT: keep watching, it may recover (tunnel, cold GPS).
    if (state.status !== 'active') set({ status: 'unavailable' });
  }

  function startWatching() {
    if (!deps.geolocation || watchId !== null) return;
    if (state.status !== 'active') set({ status: 'starting' });
    watchId = deps.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: false,
      maximumAge: 15_000,
      timeout: 30_000,
    });
    timer = setInterval(() => void maybeSend(), tickMs);
  }

  function stopWatching() {
    if (watchId !== null) deps.geolocation?.clearWatch(watchId);
    watchId = null;
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  function onVisibility() {
    if (!started) return;
    if (deps.visibility?.visibilityState === 'hidden') {
      stopWatching();
      if (state.status !== 'denied') set({ status: 'paused' });
    } else if (state.status !== 'denied') {
      startWatching();
    }
  }

  return {
    getState: () => state,
    /** Starts watching (this is what triggers the browser permission prompt the first time). */
    start() {
      if (!deps.geolocation) {
        set({ status: 'unsupported' });
        return;
      }
      if (started && state.status !== 'denied' && state.status !== 'unavailable') return;
      started = true;
      stopWatching();
      deps.visibility?.removeEventListener('visibilitychange', onVisibility);
      deps.visibility?.addEventListener('visibilitychange', onVisibility);
      if (deps.visibility?.visibilityState === 'hidden') set({ status: 'paused' });
      else startWatching();
    },
    stop() {
      started = false;
      stopWatching();
      deps.visibility?.removeEventListener('visibilitychange', onVisibility);
      latest = null;
      lastSent = null;
      set({ status: 'off', position: null, lastSentAt: null });
    },
  };
}

export type LocationSharer = ReturnType<typeof createLocationSharer>;
