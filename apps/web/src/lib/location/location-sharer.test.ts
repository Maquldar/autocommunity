import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocationSharer, DEFAULT_POLICY, shouldSend, type GeolocationLike, type VisibilityLike } from './location-sharer';

// ~0.001° latitude ≈ 111 m.
const BASE = { lat: 43.2389, lng: 76.8897 };
const north = (meters: number) => ({ lat: BASE.lat + meters / 111_195, lng: BASE.lng });

describe('shouldSend', () => {
  const at = 1_000_000;
  it('always sends the first fix', () => {
    expect(shouldSend(null, BASE, at)).toBe(true);
  });
  it('waits 30 s even after a long move', () => {
    expect(shouldSend({ ...BASE, at }, north(500), at + 29_999)).toBe(false);
  });
  it('waits for a 100 m move even after 30 s', () => {
    expect(shouldSend({ ...BASE, at }, north(60), at + 60_000)).toBe(false);
  });
  it('sends when both 30 s and 100 m have passed', () => {
    expect(shouldSend({ ...BASE, at }, north(150), at + 30_000)).toBe(true);
  });
  it('re-sends a parked position as a heartbeat after 5 min', () => {
    expect(shouldSend({ ...BASE, at }, BASE, at + DEFAULT_POLICY.heartbeatMs)).toBe(true);
  });
});

class FakeGeolocation implements GeolocationLike {
  watchers = new Map<number, { success: PositionCallback; error?: PositionErrorCallback | null }>();
  nextId = 1;
  cleared: number[] = [];
  watchPosition = vi.fn((success: PositionCallback, error?: PositionErrorCallback | null) => {
    const id = this.nextId++;
    this.watchers.set(id, { success, error });
    return id;
  });
  clearWatch = vi.fn((id: number) => {
    this.cleared.push(id);
    this.watchers.delete(id);
  });
  emit(pos: { lat: number; lng: number }, accuracy = 12) {
    for (const w of this.watchers.values()) {
      w.success({ coords: { latitude: pos.lat, longitude: pos.lng, accuracy } } as GeolocationPosition);
    }
  }
  fail(code: number) {
    for (const w of this.watchers.values()) w.error?.({ code, message: 'x' } as GeolocationPositionError);
  }
}

class FakeDocument implements VisibilityLike {
  visibilityState: DocumentVisibilityState = 'visible';
  listeners = new Set<() => void>();
  addEventListener(_: 'visibilitychange', l: () => void) {
    this.listeners.add(l);
  }
  removeEventListener(_: 'visibilitychange', l: () => void) {
    this.listeners.delete(l);
  }
  set(state: DocumentVisibilityState) {
    this.visibilityState = state;
    for (const l of this.listeners) l();
  }
}

describe('createLocationSharer', () => {
  let geo: FakeGeolocation;
  let doc: FakeDocument;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T10:00:00Z'));
    geo = new FakeGeolocation();
    doc = new FakeDocument();
    send = vi.fn().mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function make() {
    return createLocationSharer({ geolocation: geo, visibility: doc, send });
  }

  it('does not touch geolocation until started', () => {
    make();
    expect(geo.watchPosition).not.toHaveBeenCalled();
  });

  it('sends the first fix right away, then throttles to 30 s AND 100 m', async () => {
    const sharer = make();
    sharer.start();
    expect(sharer.getState().status).toBe('starting');

    geo.emit(BASE);
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith({ ...BASE, accuracyM: 12 });
    expect(sharer.getState().status).toBe('active');

    // Moved 500 m after 10 s: too soon.
    vi.advanceTimersByTime(10_000);
    geo.emit(north(500));
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);

    // No new fix arrives, but the pending move goes out once 30 s have passed (tick).
    await vi.advanceTimersByTimeAsync(20_000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0].lat).toBeCloseTo(north(500).lat, 6);

    // Parked: small jitter after 40 s is not sent.
    await vi.advanceTimersByTimeAsync(40_000);
    geo.emit(north(530));
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('re-sends a parked position every 5 minutes', async () => {
    const sharer = make();
    sharer.start();
    geo.emit(BASE);
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000 + 10_000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('stops watching while the tab is hidden and resumes when visible', async () => {
    const sharer = make();
    sharer.start();
    geo.emit(BASE);
    await vi.advanceTimersByTimeAsync(0);

    doc.set('hidden');
    expect(geo.clearWatch).toHaveBeenCalledTimes(1);
    expect(sharer.getState().status).toBe('paused');
    // No heartbeat while hidden.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(send).toHaveBeenCalledTimes(1);

    doc.set('visible');
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
    geo.emit(BASE);
    await vi.advanceTimersByTimeAsync(0);
    // Over 5 min since the last update: sent again.
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('reports permission denied and stops watching', () => {
    const sharer = make();
    sharer.start();
    geo.fail(1);
    expect(sharer.getState().status).toBe('denied');
    expect(geo.watchers.size).toBe(0);
  });

  it('reports unavailable but keeps watching so it can recover', async () => {
    const sharer = make();
    sharer.start();
    geo.fail(2);
    expect(sharer.getState().status).toBe('unavailable');
    geo.emit(BASE);
    await vi.advanceTimersByTimeAsync(0);
    expect(sharer.getState().status).toBe('active');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retries a failed send on the next tick', async () => {
    send.mockRejectedValueOnce(new Error('offline'));
    const sharer = make();
    sharer.start();
    geo.emit(BASE);
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('reports unsupported without geolocation', () => {
    const sharer = createLocationSharer({ geolocation: null, visibility: doc, send });
    sharer.start();
    expect(sharer.getState().status).toBe('unsupported');
  });

  it('stop() clears the watch, the timer and the position', async () => {
    const sharer = make();
    sharer.start();
    geo.emit(BASE);
    await vi.advanceTimersByTimeAsync(0);
    sharer.stop();
    expect(sharer.getState()).toEqual({ status: 'off', position: null, lastSentAt: null });
    expect(geo.watchers.size).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(send).toHaveBeenCalledTimes(1);
    // Visibility changes after stop don't restart it.
    doc.set('hidden');
    doc.set('visible');
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
  });

  it('starts paused when launched in a hidden tab', () => {
    doc.visibilityState = 'hidden';
    const sharer = make();
    sharer.start();
    expect(sharer.getState().status).toBe('paused');
    expect(geo.watchPosition).not.toHaveBeenCalled();
  });
});
