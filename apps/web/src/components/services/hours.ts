import { almatyClock, isOpenAt, parseHoursRange, WEEKDAYS, type ServiceHours, type Weekday } from '@autoc/shared';

const ALL_DAY = '00:00-24:00';

export type OpenState =
  | { kind: 'unknown' }
  | { kind: 'open24' }
  | { kind: 'openUntil'; time: string; nextDay: boolean }
  | { kind: 'opensAt'; time: string }
  | { kind: 'opensTomorrow'; time: string }
  | { kind: 'opensOn'; day: Weekday; time: string }
  | { kind: 'closed' };

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const dayAt = (day: Weekday, offset: number): Weekday => WEEKDAYS[(WEEKDAYS.indexOf(day) + offset + 7) % 7]!;

/** "Open until 19:00" / "Closed · opens tomorrow at 09:00", computed on the Asia/Almaty wall clock. */
export function describeOpenState(hours: ServiceHours, now: Date): OpenState {
  const open = isOpenAt(hours, now);
  if (open === null) return { kind: 'unknown' };
  const { day, minutes } = almatyClock(now);
  const todayValue = hours[day];
  const today = todayValue ? parseHoursRange(todayValue) : null;

  if (open) {
    if (todayValue === ALL_DAY) return { kind: 'open24' };
    if (today && minutes >= today.start && (today.end < today.start || minutes < today.end)) {
      return { kind: 'openUntil', time: hhmm(today.end), nextDay: today.end < today.start };
    }
    // Still inside yesterday's overnight range.
    const prevValue = hours[dayAt(day, -1)];
    const prev = prevValue ? parseHoursRange(prevValue) : null;
    return { kind: 'openUntil', time: prev ? hhmm(prev.end) : '', nextDay: false };
  }

  if (today && today.start > minutes) return { kind: 'opensAt', time: hhmm(today.start) };
  for (let offset = 1; offset <= 7; offset++) {
    const next = dayAt(day, offset);
    const value = hours[next];
    const range = value ? parseHoursRange(value) : null;
    if (range) return offset === 1 ? { kind: 'opensTomorrow', time: hhmm(range.start) } : { kind: 'opensOn', day: next, time: hhmm(range.start) };
  }
  return { kind: 'closed' };
}

export type HoursRow = { day: Weekday; value: string | null; allDay: boolean; isToday: boolean };

/** Monday-first rows for the hours table, with today's row (Almaty) marked. */
export function hoursRows(hours: ServiceHours, now: Date): HoursRow[] {
  const today = almatyClock(now).day;
  return WEEKDAYS.map((day) => ({ day, value: hours[day], allDay: hours[day] === ALL_DAY, isToday: day === today }));
}

/** "09:00-19:00" → "09:00–19:00" (en dash for display). */
export const formatRange = (value: string) => value.replace('-', '–');

/* ---------- editor ---------- */

export type DayEditor = { open: boolean; allDay: boolean; from: string; to: string };

const DEFAULT_FROM = '09:00';
const DEFAULT_TO = '19:00';

/** Splits a stored value into editor fields. Partially typed values ("09:00-") round-trip unchanged. */
export function dayEditorFromValue(value: string | null): DayEditor {
  if (value === null) return { open: false, allDay: false, from: DEFAULT_FROM, to: DEFAULT_TO };
  if (value === ALL_DAY) return { open: true, allDay: true, from: DEFAULT_FROM, to: DEFAULT_TO };
  const [from = '', to = ''] = value.split('-');
  return { open: true, allDay: false, from, to };
}

export function dayEditorToValue(e: DayEditor): string | null {
  if (!e.open) return null;
  if (e.allDay) return ALL_DAY;
  return `${e.from}-${e.to}`;
}

export const DEFAULT_HOURS: ServiceHours = {
  mon: '09:00-19:00',
  tue: '09:00-19:00',
  wed: '09:00-19:00',
  thu: '09:00-19:00',
  fri: '09:00-19:00',
  sat: '10:00-16:00',
  sun: null,
};

/** Copies Monday's value to Tuesday–Friday. */
export const copyMondayToWeekdays = (hours: ServiceHours): ServiceHours => ({
  ...hours,
  tue: hours.mon,
  wed: hours.mon,
  thu: hours.mon,
  fri: hours.mon,
});
