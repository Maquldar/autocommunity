import { describe, expect, it } from 'vitest';
import { v7 } from 'uuid';
import { safeEqual } from '../http/auth-cookies';
import { uuidV7Timestamp } from './access-token.service';
import { isUserBlocked } from './user-state.service';

describe('auth helpers', () => {
  it('reads the millisecond timestamp from a UUID v7', () => {
    const before = Date.now();
    const ts = uuidV7Timestamp(v7());
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(Date.now());
  });

  it('compares secrets in constant time and handles length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('treats deleted and currently blocked accounts as blocked', () => {
    const now = Date.parse('2026-10-04T12:00:00Z');
    expect(isUserBlocked({ status: 'active', blockedUntil: null }, now)).toBe(false);
    expect(isUserBlocked({ status: 'deleted', blockedUntil: null }, now)).toBe(true);
    expect(isUserBlocked({ status: 'blocked', blockedUntil: null }, now)).toBe(true);
    expect(isUserBlocked({ status: 'blocked', blockedUntil: '2026-10-05T00:00:00Z' }, now)).toBe(true);
    expect(isUserBlocked({ status: 'blocked', blockedUntil: '2026-10-03T00:00:00Z' }, now)).toBe(false);
  });
});
