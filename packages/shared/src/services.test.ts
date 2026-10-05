import { describe, expect, it } from 'vitest';
import {
  almatyClock,
  base32,
  bayesianServiceRating,
  createServiceSchema,
  extractQrCode,
  isOpenAt,
  normalizeHours,
  parseHoursRange,
  serviceListQuerySchema,
  type ServiceHours,
} from './services';

const WEEK: ServiceHours = { mon: '09:00-19:00', tue: '09:00-19:00', wed: '09:00-19:00', thu: '09:00-19:00', fri: '09:00-19:00', sat: '10:00-16:00', sun: null };
/** Almaty is UTC+5: 2026-10-05 is a Monday. */
const almaty = (iso: string) => new Date(`${iso}+05:00`);

describe('bayesianServiceRating', () => {
  it('starts at the prior and moves toward the mean as reviews accumulate', () => {
    expect(bayesianServiceRating(0, 0)).toBe(3.5);
    expect(bayesianServiceRating(5, 1)).toBe(3.8); // (17.5 + 5) / 6 = 3.75 → 3.8
    expect(bayesianServiceRating(1, 1)).toBe(3.1); // (17.5 + 1) / 6 = 3.083
    expect(bayesianServiceRating(16, 4)).toBe(3.7); // 33.5 / 9 = 3.722
    expect(bayesianServiceRating(500, 100)).toBe(4.9); // 517.5 / 105 = 4.928
    expect(bayesianServiceRating(100, 100)).toBe(1.1); // 117.5 / 105 = 1.119
  });
});

describe('opening hours', () => {
  it('parses ranges', () => {
    expect(parseHoursRange('09:00-19:30')).toEqual({ start: 540, end: 1170 });
    expect(parseHoursRange('00:00-24:00')).toEqual({ start: 0, end: 1440 });
    expect(parseHoursRange('20:00-02:00')).toEqual({ start: 1200, end: 120 });
    for (const bad of ['9:00-19:00', '09:00-24:30', '25:00-26:00', '10:00-10:00', '', 'closed']) expect(parseHoursRange(bad)).toBeNull();
  });

  it('computes the Almaty wall clock', () => {
    expect(almatyClock(new Date('2026-10-05T04:30:00Z'))).toEqual({ day: 'mon', minutes: 570, date: '2026-10-05' });
    expect(almatyClock(new Date('2026-10-04T20:00:00Z'))).toEqual({ day: 'mon', minutes: 60, date: '2026-10-05' });
  });

  it('isOpenAt respects days, closing time, closed days and 24h', () => {
    expect(isOpenAt(WEEK, almaty('2026-10-05T09:00:00'))).toBe(true);
    expect(isOpenAt(WEEK, almaty('2026-10-05T08:59:00'))).toBe(false);
    expect(isOpenAt(WEEK, almaty('2026-10-05T19:00:00'))).toBe(false);
    expect(isOpenAt(WEEK, almaty('2026-10-10T15:00:00'))).toBe(true); // Saturday
    expect(isOpenAt(WEEK, almaty('2026-10-11T12:00:00'))).toBe(false); // Sunday closed
    const always = normalizeHours(Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, '00:00-24:00'])));
    expect(isOpenAt(always, almaty('2026-10-11T03:00:00'))).toBe(true);
    expect(isOpenAt(normalizeHours({}), new Date())).toBeNull();
  });

  it('overnight ranges spill into the next morning', () => {
    const night = { ...normalizeHours({}), fri: '20:00-02:00' };
    expect(isOpenAt(night, almaty('2026-10-09T23:00:00'))).toBe(true); // Fri
    expect(isOpenAt(night, almaty('2026-10-10T01:30:00'))).toBe(true); // Sat early
    expect(isOpenAt(night, almaty('2026-10-10T02:00:00'))).toBe(false);
    expect(isOpenAt(night, almaty('2026-10-09T19:00:00'))).toBe(false);
  });

  it('normalizeHours drops malformed values', () => {
    expect(normalizeHours({ mon: '09:00-19:00', tue: 'x', extra: 1 })).toMatchObject({ mon: '09:00-19:00', tue: null, sun: null });
  });
});

describe('QR helpers', () => {
  it('base32 encodes RFC 4648 vectors', () => {
    const enc = (s: string, n: number) => base32(new TextEncoder().encode(s), n);
    expect(enc('foobar', 10)).toBe('MZXW6YTBOI');
    expect(enc('f', 2)).toBe('MY');
  });

  it('extracts codes from URLs and typed text', () => {
    expect(extractQrCode('https://app.example/services/abc?code=abcd2345')).toBe('ABCD2345');
    expect(extractQrCode(' abcd-2345 ')).toBe('ABCD2345');
    expect(extractQrCode('ABC')).toBeNull();
    expect(extractQrCode('https://app.example/services/abc')).toBeNull();
  });
});

describe('schemas', () => {
  it('list query: distance sort needs a location; lat/lng go together', () => {
    expect(serviceListQuerySchema.safeParse({ sort: 'distance' }).success).toBe(false);
    expect(serviceListQuerySchema.safeParse({ lat: '43.2' }).success).toBe(false);
    expect(serviceListQuerySchema.parse({ lat: '43.2', lng: '76.9', sort: 'distance' })).toMatchObject({ lat: 43.2, limit: 20 });
  });

  it('create: normalizes phone and defaults', () => {
    const base = { name: 'Тест', category: 'tow', address: 'ул. Абая 1', hours: WEEK, lat: 43.2, lng: 76.9 };
    expect(createServiceSchema.parse({ ...base, phone: '8 727 300 10 20' })).toMatchObject({ phone: '+77273001020', description: '', photoUploadIds: [] });
    expect(createServiceSchema.parse({ ...base, phone: '' }).phone).toBeNull();
    expect(createServiceSchema.safeParse({ ...base, name: 'Line\nbreak' }).success).toBe(false);
  });
});
