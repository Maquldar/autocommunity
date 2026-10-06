import { describe, expect, it } from 'vitest';
import { buildIcs, escapeIcsText, foldIcsLine, icsFileName } from './ics';

const event = {
  id: '0192f0c0-0000-7000-8000-0000000000e1',
  title: 'Встреча клуба; кофе, фото',
  description: 'Строка 1\nСтрока 2 \\ слэш',
  place: 'Достык Плаза, парковка',
  lat: 43.2335,
  lng: 76.9565,
  startsAt: '2026-10-10T06:00:00.000Z',
  endsAt: null,
};

describe('ics', () => {
  it('escapes text per RFC 5545', () => {
    expect(escapeIcsText('a;b,c\\d\ne')).toBe('a\;b\\,c\\\\d\\ne');
  });

  it('folds long lines at 75 octets without splitting UTF-8 characters', () => {
    const line = `SUMMARY:${'ж'.repeat(80)}`;
    const folded = foldIcsLine(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    expect(parts.slice(1).every((p) => p.startsWith(' '))).toBe(true);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(line);
    expect(foldIcsLine('SHORT:x')).toBe('SHORT:x');
  });

  it('builds a VEVENT with UTC times, default duration and the event url', () => {
    const ics = buildIcs(event, { url: 'https://app.example/events/1', now: new Date('2026-10-05T12:00:00.000Z') });
    expect(ics.endsWith('\r\n')).toBe(true);
    const lines = ics.split('\r\n');
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('DTSTART:20261010T060000Z');
    expect(lines).toContain('DTEND:20261010T090000Z'); // + 3 h default
    expect(lines).toContain('DTSTAMP:20261005T120000Z');
    expect(lines).toContain(`UID:${event.id}@autocommunity`);
    expect(lines).toContain('SUMMARY:Встреча клуба\; кофе\\, фото');
    expect(lines).toContain('LOCATION:Достык Плаза\\, парковка');
    expect(lines).toContain('GEO:43.233500;76.956500');
    expect(ics).toContain('DESCRIPTION:Строка 1\\nСтрока 2 \\\\ слэш');
    const withEnd = buildIcs({ ...event, endsAt: '2026-10-10T08:30:00.000Z' }, { url: 'https://x' });
    expect(withEnd).toContain('DTEND:20261010T083000Z');
  });

  it('safe file names', () => {
    expect(icsFileName('Встреча клуба: кофе/фото!')).toBe('Встреча-клуба-кофе-фото.ics');
    expect(icsFileName('***')).toBe('event.ics');
  });
});
