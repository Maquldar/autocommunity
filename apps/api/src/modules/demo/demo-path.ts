/** Almaty city bounds used by the seed and by demo live locations (airport – Sayakhat – foothills). */
export const ALMATY_BOUNDS = { minLat: 43.19, maxLat: 43.32, minLng: 76.82, maxLng: 77.0 } as const;

/** Steps per loop: a seeded driver comes back to its start after this many ticks (minutes). */
export const DEMO_LOOP_STEPS = 30;
const METERS_PER_DEG_LAT = 111_320;

/** FNV-1a: stable per-user path parameters derived from the id. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const demoStepMeters = (userId: string): number => 20 + ((hash(userId) >>> 12) % 26); // 20–45 m

/**
 * One step along a user's closed loop: the heading turns by 360°/DEMO_LOOP_STEPS each tick, so consecutive
 * steps trace a polygon (~200–430 m across) that returns to its start. Deterministic in (user, tick). A step
 * that would leave Almaty is reversed instead.
 */
export function demoStep(userId: string, lat: number, lng: number, tick: number): { lat: number; lng: number } {
  const h = hash(userId);
  const direction = h & 1 ? 1 : -1;
  const phase = (h >>> 1) % DEMO_LOOP_STEPS;
  const theta = (direction * 2 * Math.PI * (phase + tick)) / DEMO_LOOP_STEPS;
  const meters = demoStepMeters(userId);
  const dLat = (meters * Math.sin(theta)) / METERS_PER_DEG_LAT;
  const dLng = (meters * Math.cos(theta)) / (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  const inside = (la: number, ln: number) =>
    la >= ALMATY_BOUNDS.minLat && la <= ALMATY_BOUNDS.maxLat && ln >= ALMATY_BOUNDS.minLng && ln <= ALMATY_BOUNDS.maxLng;
  if (inside(lat + dLat, lng + dLng)) return { lat: lat + dLat, lng: lng + dLng };
  if (inside(lat - dLat, lng - dLng)) return { lat: lat - dLat, lng: lng - dLng };
  // Already outside (moved by hand): step towards the city centre.
  const toLat = (ALMATY_BOUNDS.minLat + ALMATY_BOUNDS.maxLat) / 2 - lat;
  const toLng = (ALMATY_BOUNDS.minLng + ALMATY_BOUNDS.maxLng) / 2 - lng;
  const scale = meters / METERS_PER_DEG_LAT / Math.max(Math.hypot(toLat, toLng), 1e-9);
  return { lat: lat + toLat * scale, lng: lng + toLng * scale };
}
