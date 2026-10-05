'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { GeoError } from './errors';

export type Coords = { lat: number; lng: number };
export type PositionStatus = 'idle' | 'locating' | 'ready' | 'denied' | 'unavailable';
type Snapshot = { status: PositionStatus; coords: Coords | null };

/*
 * One position for the whole services feature (list ↔ details ↔ map), so navigating doesn't ask the
 * browser again. Never persisted: a position is personal data and is only kept in memory for the tab.
 */
let snapshot: Snapshot = { status: 'idle', coords: null };
const listeners = new Set<() => void>();
const set = (next: Snapshot) => {
  snapshot = next;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const SERVER: Snapshot = { status: 'idle', coords: null };

/**
 * One-shot current position. Resolves with coordinates or rejects with GeoError. `maximumAgeMs: 0` forces a
 * fresh fix (the visit check must not reuse a position taken before the driver walked to the service).
 */
export function getCurrentPosition({ timeoutMs = 15_000, maximumAgeMs = 30_000 }: { timeoutMs?: number; maximumAgeMs?: number } = {}): Promise<Coords> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.reject(new GeoError('unavailable'));
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (err) => reject(new GeoError(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable')),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: maximumAgeMs },
    );
  });
}

export async function locate(): Promise<Coords> {
  set({ ...snapshot, status: 'locating' });
  try {
    const coords = await getCurrentPosition();
    set({ status: 'ready', coords });
    return coords;
  } catch (err) {
    set({ status: err instanceof GeoError ? err.reason : 'unavailable', coords: snapshot.coords });
    throw err;
  }
}

/**
 * The viewer's position for distances and the "nearest" sort. With `auto`, asks the browser only when
 * location permission is already granted (no prompt on page load); otherwise the UI offers a button.
 */
export function usePosition({ auto = false }: { auto?: boolean } = {}) {
  const state = useSyncExternalStore(subscribe, () => snapshot, () => SERVER);

  useEffect(() => {
    if (!auto || snapshot.status !== 'idle' || typeof navigator === 'undefined') return;
    let cancelled = false;
    void navigator.permissions
      ?.query({ name: 'geolocation' as PermissionName })
      .then((p) => {
        if (!cancelled && p.state === 'granted' && snapshot.status === 'idle') void locate().catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [auto]);

  const request = useCallback(() => locate(), []);
  return { ...state, request };
}
