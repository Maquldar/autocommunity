import { describe, expect, it } from 'vitest';
import { calendarTile, formatEventWhen, fromZonedInput, toZonedInput, zonedDayKey } from './time';

describe('Almaty event times', () => {
  it('converts an instant to the Almaty datetime-local value and back (UTC+5)', () => {
    expect(toZonedInput('2026-10-10T06:00:00.000Z')).toBe('2026-10-10T11:00');
    expect(toZonedInput('2026-10-10T20:30:00.000Z')).toBe('2026-10-11T01:30');
    expect(fromZonedInput('2026-10-10T11:00')).toBe('2026-10-10T06:00:00.000Z');
    expect(fromZonedInput('2026-01-01T00:15')).toBe('2025-12-31T19:15:00.000Z');
    for (const iso of ['2026-03-01T00:00:00.000Z', '2026-12-31T23:59:00.000Z']) expect(fromZonedInput(toZonedInput(iso))).toBe(iso);
  });

  it('rejects malformed and impossible values', () => {
    expect(fromZonedInput('')).toBeNull();
    expect(fromZonedInput('2026-10-10 11:00')).toBeNull();
    expect(fromZonedInput('2026-02-31T10:00')).toBeNull();
    expect(fromZonedInput('2026-13-01T10:00')).toBeNull();
    expect(fromZonedInput('2026-10-10T24:00')).toBeNull();
  });

  it('works whatever the device time zone is (other zone parameter)', () => {
    expect(toZonedInput('2026-10-10T06:00:00.000Z', 'Europe/Moscow')).toBe('2026-10-10T09:00');
    expect(fromZonedInput('2026-07-01T12:00', 'Europe/Berlin')).toBe('2026-07-01T10:00:00.000Z');
  });

  it('formats ranges in ru and en', () => {
    expect(formatEventWhen('2026-10-10T06:00:00.000Z', '2026-10-10T08:00:00.000Z', 'en')).toBe('Sat 10 Oct, 11:00–13:00');
    expect(formatEventWhen('2026-10-10T06:00:00.000Z', null, 'ru')).toBe('сб, 10 окт., 11:00');
    expect(formatEventWhen('2026-10-10T18:00:00.000Z', '2026-10-10T20:00:00.000Z', 'en')).toBe('Sat 10 Oct, 23:00 – 11 Oct, 01:00');
    expect(zonedDayKey('2026-10-10T19:30:00.000Z')).toBe('2026-10-11');
  });

  it('calendar tile parts', () => {
    expect(calendarTile('2026-10-10T20:00:00.000Z', 'en')).toEqual({ month: 'Oct', day: '11' });
    expect(calendarTile('2026-10-10T06:00:00.000Z', 'ru')).toEqual({ month: 'окт', day: '10' });
  });
});
