import { describe, expect, it, vi } from 'vitest';
import { createReadStore, createThrottle, createTypingStore } from './live-stores';

const user = (id: string) => ({ id, nickname: id, name: id, avatarUrl: null, rating: 50 });

describe('createThrottle (chat:typing at most once per 3 s)', () => {
  it('allows the first call, blocks inside the interval, allows again after it', () => {
    let now = 1_000;
    const allow = createThrottle(3_000, () => now);
    expect(allow()).toBe(true);
    now += 1_000;
    expect(allow()).toBe(false);
    now += 1_999;
    expect(allow()).toBe(false);
    now += 1;
    expect(allow()).toBe(true);
  });

  it('emits once per window for a burst of keystrokes', () => {
    let now = 0;
    const allow = createThrottle(3_000, () => now);
    let emitted = 0;
    for (let i = 0; i < 100; i += 1) {
      now = i * 100; // 10 s of typing, a key every 100 ms
      if (allow()) emitted += 1;
    }
    expect(emitted).toBe(4); // t = 0, 3000, 6000, 9000
  });
});

describe('createTypingStore', () => {
  it('adds typers per chat, expires them after the TTL and notifies', () => {
    vi.useFakeTimers();
    const store = createTypingStore(6_000);
    const listener = vi.fn();
    store.subscribe(listener);
    store.add('c1', user('a'));
    store.add('c1', user('b'));
    expect(store.get('c1').map((u) => u.id)).toEqual(['a', 'b']);
    expect(store.get('c2')).toEqual([]);
    vi.advanceTimersByTime(3_000);
    store.add('c1', user('a')); // refreshes a's timer
    vi.advanceTimersByTime(3_001);
    expect(store.get('c1').map((u) => u.id)).toEqual(['a']);
    vi.advanceTimersByTime(3_000);
    expect(store.get('c1')).toEqual([]);
    expect(listener).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('a message from the typer clears the mark; snapshots are stable between changes', () => {
    const store = createTypingStore();
    store.add('c1', user('a'));
    const first = store.get('c1');
    expect(store.get('c1')).toBe(first);
    store.remove('c1', 'a');
    expect(store.get('c1')).toEqual([]);
  });
});

describe('createReadStore', () => {
  it('keeps the latest read time per member and ignores my own', () => {
    const store = createReadStore();
    store.set('c1', 'peer', '2026-10-05T10:00:00Z');
    store.set('c1', 'peer', '2026-10-05T09:00:00Z'); // older: ignored
    store.set('c1', 'me', '2026-10-05T11:00:00Z');
    expect(store.latestPeerRead('c1', 'me')).toBe(Date.parse('2026-10-05T10:00:00Z'));
    expect(store.latestPeerRead('c2', 'me')).toBe(0);
  });
});
