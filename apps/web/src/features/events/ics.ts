import { eventEndsAt, type EventDto } from '@autoc/shared';

/** RFC 5545 text escaping: backslash, semicolon, comma and newlines. */
export function escapeIcsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** Folds a content line at 75 octets (UTF-8 aware: never splits a character). */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/**
 * An iCalendar file with one VEVENT (UTC times; an event without endsAt gets the default duration).
 * `url` is the absolute link back to the event page.
 */
export function buildIcs(
  event: Pick<EventDto, 'id' | 'title' | 'description' | 'place' | 'lat' | 'lng' | 'startsAt' | 'endsAt'>,
  { url, now = new Date() }: { url: string; now?: Date },
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AutoCommunity//Events//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.id}@autocommunity`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(new Date(event.startsAt))}`,
    `DTEND:${stamp(eventEndsAt(event))}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText([event.description, url].filter(Boolean).join('\n\n'))}`,
    `LOCATION:${escapeIcsText(event.place)}`,
    `GEO:${event.lat.toFixed(6)};${event.lng.toFixed(6)}`,
    `URL:${url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

/** File name for the download: the title reduced to safe characters. */
export function icsFileName(title: string): string {
  const base = title
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'event'}.ics`;
}

/** Triggers a browser download of the event as .ics. */
export function downloadIcs(event: Parameters<typeof buildIcs>[0], url: string): void {
  const blob = new Blob([buildIcs(event, { url })], { type: 'text/calendar;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = icsFileName(event.title);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
