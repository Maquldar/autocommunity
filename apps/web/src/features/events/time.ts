/**
 * Event times are entered and shown in Almaty wall-clock time (the pilot city), whatever the device's
 * time zone is. Pure helpers, unit-tested.
 */
export const EVENT_TIME_ZONE = 'Asia/Almaty';

type Parts = { year: number; month: number; day: number; hour: number; minute: number };

function partsIn(date: Date, timeZone: string): Parts {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  return { year: values.year!, month: values.month!, day: values.day!, hour: values.hour! % 24, minute: values.minute! };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DDTHH:mm` (an `<input type="datetime-local">` value) for an instant, in Almaty time. */
export function toZonedInput(iso: string | Date, timeZone = EVENT_TIME_ZONE): string {
  const p = partsIn(new Date(iso), timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** The instant (ISO, UTC) of an Almaty wall-clock `YYYY-MM-DDTHH:mm`; null for an invalid value. */
export function fromZonedInput(value: string, timeZone = EVENT_TIME_ZONE): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  // The zone's offset at that moment (two passes settle DST edges; Almaty has none since 2024).
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const p = partsIn(new Date(guess), timeZone);
    const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - guess;
    guess = asUtc - offset;
  }
  const check = partsIn(new Date(guess), timeZone);
  if (check.day !== day || check.month !== month) return null; // e.g. 31 Feb
  return new Date(guess).toISOString();
}

/** `YYYY-MM-DD` of an instant in Almaty (for "today" / day grouping). */
export function zonedDayKey(iso: string | Date, timeZone = EVENT_TIME_ZONE): string {
  return toZonedInput(iso, timeZone).slice(0, 10);
}

/**
 * Human date range: "Sat 10 Oct, 11:00–13:00" (same day) or "10 Oct, 23:00 – 11 Oct, 01:00".
 * `locale` is a BCP 47 tag (`ru`, `en`).
 */
export function formatEventWhen(startsAt: string, endsAt: string | null, locale: string, timeZone = EVENT_TIME_ZONE): string {
  const tag = locale === 'en' ? 'en-GB' : 'ru-RU';
  const start = new Date(startsAt);
  const day = new Intl.DateTimeFormat(tag, { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(start);
  const time = (d: Date) => new Intl.DateTimeFormat(tag, { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  if (!endsAt) return `${day}, ${time(start)}`;
  const end = new Date(endsAt);
  if (zonedDayKey(start, timeZone) === zonedDayKey(end, timeZone)) return `${day}, ${time(start)}–${time(end)}`;
  const endDay = new Intl.DateTimeFormat(tag, { timeZone, day: 'numeric', month: 'short' }).format(end);
  return `${day}, ${time(start)} – ${endDay}, ${time(end)}`;
}

/** Short calendar tile parts: month abbreviation and day number in Almaty. */
export function calendarTile(iso: string, locale: string, timeZone = EVENT_TIME_ZONE): { month: string; day: string } {
  const tag = locale === 'en' ? 'en-GB' : 'ru-RU';
  const d = new Date(iso);
  return {
    month: new Intl.DateTimeFormat(tag, { timeZone, month: 'short' }).format(d).replace('.', ''),
    day: new Intl.DateTimeFormat(tag, { timeZone, day: 'numeric' }).format(d),
  };
}
