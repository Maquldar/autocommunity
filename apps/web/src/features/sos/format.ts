import { SOS_LIMITS } from '@autoc/shared';

/** "1:05:09" from one hour up, otherwise "5:09" (minutes:seconds). Never negative. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
  return `${minutes}:${ss}`;
}

/** Whole kilometres for the search radius ("5", "10", "20"). */
export function radiusKm(radiusM: number): number {
  return Math.max(1, Math.round(radiusM / 1000));
}

/**
 * The next dispatch step while nobody has accepted: radii 5 → 10 → 20 km, every `expandDelaySec`
 * after creation (API.md §4). Returns null at the largest radius. `inSec` is an estimate (0 while
 * the server is about to expand) because the server's delay can be shortened for tests.
 */
export function nextRadiusStep(
  radiusM: number,
  createdAt: string,
  nowMs: number,
  { radii = SOS_LIMITS.radiiM, delaySec = SOS_LIMITS.expandDelaySec }: { radii?: readonly number[]; delaySec?: number } = {},
): { radiusM: number; inSec: number } | null {
  const index = radii.findIndex((r) => r >= radiusM);
  const current = index === -1 ? radii.length - 1 : index;
  const next = radii[current + 1];
  if (next === undefined) return null;
  const due = Date.parse(createdAt) + (current + 1) * delaySec * 1000;
  return { radiusM: next, inSec: Math.max(0, Math.ceil((due - nowMs) / 1000)) };
}

/** Distance as a unit-formatted number: metres under 1 km (rounded to 10 m), else km with one decimal. */
export function distanceParts(meters: number): { value: number; unit: 'meter' | 'kilometer' } {
  if (meters < 1000) return { value: Math.max(10, Math.round(meters / 10) * 10), unit: 'meter' };
  return { value: Math.round(meters / 100) / 10, unit: 'kilometer' };
}

/** Turn-by-turn directions in the platform's maps app (Google Maps universal link). */
export function navigateUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

/** A plain "view on the map" link (OpenStreetMap, as in chat location messages). */
export function osmUrl(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}

/** `tel:` href for an E.164 number. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

/** "+77071234567" → "+7 707 123 45 67" (other formats unchanged). */
export function formatPhone(phone: string): string {
  const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return m ? `+7 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : phone;
}
