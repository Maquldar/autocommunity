import { normalizeHours, type ServiceHours } from '@autoc/shared';
import { describe, expect, it } from 'vitest';
import { distanceParts, formatServicePhone, mapLinks } from './format';
import {
  copyMondayToWeekdays,
  dayEditorFromValue,
  dayEditorToValue,
  DEFAULT_HOURS,
  describeOpenState,
  formatRange,
  hoursRows,
} from './hours';

/** Almaty is UTC+5; 2026-10-05 is a Monday. */
const almaty = (iso: string) => new Date(`${iso}+05:00`);
const WEEK: ServiceHours = DEFAULT_HOURS; // Mon–Fri 09–19, Sat 10–16, Sun closed

describe('describeOpenState', () => {
  it('open: until closing time', () => {
    expect(describeOpenState(WEEK, almaty('2026-10-05T12:00:00'))).toEqual({ kind: 'openUntil', time: '19:00', nextDay: false });
  });

  it('closed before opening: opens later today', () => {
    expect(describeOpenState(WEEK, almaty('2026-10-05T07:30:00'))).toEqual({ kind: 'opensAt', time: '09:00' });
  });

  it('closed after closing: opens tomorrow', () => {
    expect(describeOpenState(WEEK, almaty('2026-10-05T20:00:00'))).toEqual({ kind: 'opensTomorrow', time: '09:00' });
    expect(describeOpenState(WEEK, almaty('2026-10-10T17:00:00'))).toEqual({ kind: 'opensOn', day: 'mon', time: '09:00' }); // Sat evening, Sun closed
  });

  it('24 hours and unknown', () => {
    const always = normalizeHours(Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, '00:00-24:00'])));
    expect(describeOpenState(always, almaty('2026-10-11T03:00:00'))).toEqual({ kind: 'open24' });
    expect(describeOpenState(normalizeHours({}), new Date())).toEqual({ kind: 'unknown' });
  });

  it('overnight ranges: open until tomorrow, then until the spill-over end', () => {
    const night = { ...normalizeHours({}), sun: '20:00-02:00' };
    expect(describeOpenState(night, almaty('2026-10-11T21:00:00'))).toEqual({ kind: 'openUntil', time: '02:00', nextDay: true });
    expect(describeOpenState(night, almaty('2026-10-12T01:00:00'))).toEqual({ kind: 'openUntil', time: '02:00', nextDay: false });
    expect(describeOpenState(night, almaty('2026-10-12T03:00:00'))).toEqual({ kind: 'opensOn', day: 'sun', time: '20:00' });
  });
});

describe('hours table rows', () => {
  it('marks today in Almaty, Monday first', () => {
    // 2026-10-04 21:00 UTC is already Monday 02:00 in Almaty.
    const rows = hoursRows(WEEK, new Date('2026-10-04T21:00:00Z'));
    expect(rows.map((r) => r.day)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    expect(rows.filter((r) => r.isToday).map((r) => r.day)).toEqual(['mon']);
    expect(rows[6]).toMatchObject({ value: null, allDay: false });
  });

  it('formats ranges with an en dash', () => {
    expect(formatRange('09:00-19:00')).toBe('09:00–19:00');
  });
});

describe('hours editor conversion', () => {
  it('round-trips closed, 24 h, normal and partial values', () => {
    expect(dayEditorFromValue(null)).toMatchObject({ open: false });
    expect(dayEditorToValue(dayEditorFromValue(null))).toBeNull();
    expect(dayEditorFromValue('00:00-24:00')).toMatchObject({ open: true, allDay: true });
    expect(dayEditorToValue(dayEditorFromValue('00:00-24:00'))).toBe('00:00-24:00');
    expect(dayEditorFromValue('08:30-20:00')).toEqual({ open: true, allDay: false, from: '08:30', to: '20:00' });
    expect(dayEditorToValue({ open: true, allDay: false, from: '08:30', to: '' })).toBe('08:30-');
    expect(dayEditorToValue({ ...dayEditorFromValue(null), open: true })).toBe('09:00-19:00');
  });

  it('copies Monday to the other weekdays only', () => {
    const copied = copyMondayToWeekdays({ ...WEEK, mon: '08:00-20:00' });
    expect([copied.tue, copied.fri, copied.sat, copied.sun]).toEqual(['08:00-20:00', '08:00-20:00', '10:00-16:00', null]);
  });
});

describe('formatting', () => {
  it('distances and phones', () => {
    expect(distanceParts(3)).toEqual({ value: 10, unit: 'meter' });
    expect(distanceParts(347)).toEqual({ value: 350, unit: 'meter' });
    expect(distanceParts(1260)).toEqual({ value: 1.3, unit: 'kilometer' });
    expect(formatServicePhone('+77272905208')).toBe('+7 727 290 52 08');
    expect(formatServicePhone('+4420123')).toBe('+4420123');
  });

  it('map links', () => {
    expect(mapLinks(43.25, 76.9)).toEqual({
      twoGis: 'https://2gis.kz/almaty/geo/76.9,43.25',
      google: 'https://www.google.com/maps/search/?api=1&query=43.25,76.9',
    });
  });
});
