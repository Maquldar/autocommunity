import { describe, expect, it } from 'vitest';
import { chatTimeKind, formatDuration, mapsUrl } from './format';

describe('chatTimeKind (Asia/Almaty)', () => {
  const now = new Date('2026-10-05T12:00:00Z'); // Monday 17:00 in Almaty
  it.each([
    ['2026-10-05T03:00:00Z', 'time'],
    ['2026-10-04T18:00:00Z', 'yesterday'], // 23:00 on the 4th, local
    ['2026-10-04T19:30:00Z', 'time'], // 00:30 on the 5th, local
    ['2026-10-01T10:00:00Z', 'weekday'],
    ['2026-09-20T10:00:00Z', 'date'],
    ['2025-12-31T10:00:00Z', 'dateYear'],
  ])('%s → %s', (iso, kind) => {
    expect(chatTimeKind(iso, now)).toBe(kind);
  });
});

describe('formatDuration / mapsUrl', () => {
  it('formats m:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(4.4)).toBe('0:04');
    expect(formatDuration(180)).toBe('3:00');
  });
  it('builds an OpenStreetMap link with a marker', () => {
    expect(mapsUrl(43.2389, 76.8897)).toBe('https://www.openstreetmap.org/?mlat=43.238900&mlon=76.889700#map=16/43.238900/76.889700');
  });
});
