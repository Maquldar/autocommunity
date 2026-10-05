/**
 * Viewport → `bbox` query for GET /map/users (API.md §2: `minLng,minLat,maxLng,maxLat`, at most 2° × 2°).
 * Pure functions, unit-tested in bbox.test.ts.
 */

export type Bounds = { west: number; south: number; east: number; north: number };

/** Largest span the API accepts on each axis (400 BBOX_TOO_LARGE above it). */
export const MAX_BBOX_SPAN_DEG = 2;

/** We ask for a little more than the viewport so small pans don't leave the edges empty. */
export const VIEWPORT_PADDING = 0.15;

/** Rounding of bbox edges: ~100 m, so tiny map jitters reuse the same query (and cache entry). */
const PRECISION = 3;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function spanOf(bounds: Bounds): { lng: number; lat: number } {
  // A viewport that crosses the antimeridian reports east < west.
  const lng = bounds.east >= bounds.west ? bounds.east - bounds.west : bounds.east + 360 - bounds.west;
  return { lng, lat: bounds.north - bounds.south };
}

/** True when the visible area is wider or taller than the API allows: show "zoom in" instead of calling. */
export function isTooLarge(bounds: Bounds, max = MAX_BBOX_SPAN_DEG): boolean {
  const span = spanOf(bounds);
  return span.lng > max || span.lat > max;
}

/**
 * Pads the viewport, then clamps it to the API limit (≤ `max`° per axis, centred on the viewport) and to
 * valid coordinates. Returns null when the viewport itself is too large (the caller shows a hint).
 */
export function toQueryBounds(bounds: Bounds, { padding = VIEWPORT_PADDING, max = MAX_BBOX_SPAN_DEG } = {}): Bounds | null {
  if (isTooLarge(bounds, max)) return null;
  const span = spanOf(bounds);
  const lngSpan = Math.min(max, span.lng * (1 + 2 * padding));
  const latSpan = Math.min(max, span.lat * (1 + 2 * padding));
  let centerLng = bounds.west + span.lng / 2;
  if (centerLng > 180) centerLng -= 360;
  const centerLat = (bounds.north + bounds.south) / 2;

  // The API rejects bboxes that wrap the antimeridian, so the box is clipped at ±180 instead.
  const west = clamp(centerLng - lngSpan / 2, -180, 180);
  const east = clamp(centerLng + lngSpan / 2, -180, 180);
  const south = clamp(centerLat - latSpan / 2, -90, 90);
  const north = clamp(centerLat + latSpan / 2, -90, 90);
  return roundOutward({ west, south, east, north }, max);
}

/** Rounds edges outward to PRECISION decimals, keeping the span within `max` and the box non-empty. */
function roundOutward(bounds: Bounds, max: number): Bounds {
  const f = 10 ** PRECISION;
  let west = Math.floor(bounds.west * f) / f;
  let east = Math.ceil(bounds.east * f) / f;
  let south = Math.floor(bounds.south * f) / f;
  let north = Math.ceil(bounds.north * f) / f;
  // Outward rounding can add up to 2 × 0.001°; trim it back if that crosses the limit.
  if (east - west > max) east = west + max;
  if (north - south > max) north = south + max;
  west = clamp(west, -180, 180);
  east = clamp(east, -180, 180);
  south = clamp(south, -90, 90);
  north = clamp(north, -90, 90);
  if (east <= west) east = Math.min(180, west + 1 / f);
  if (north <= south) north = Math.min(90, south + 1 / f);
  return { west: round(west), south: round(south), east: round(east), north: round(north) };
}

const round = (value: number) => Number(value.toFixed(PRECISION));

export function bboxParam(bounds: Bounds): string {
  return [bounds.west, bounds.south, bounds.east, bounds.north].join(',');
}

/** Approximate positions are snapped to a ~500 m grid (API.md §2); the soft circle shows that radius. */
export const APPROXIMATE_RADIUS_M = 250;

/**
 * Pixels per metre at a latitude and zoom for MapLibre's 512-px tiles.
 * Used to size the approximate-location circle so it matches ~500 m on the ground.
 */
export function metersToPixels(meters: number, lat: number, zoom: number): number {
  const earthCircumference = 40_075_016.686;
  const metersPerPixel = (earthCircumference * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
  return meters / metersPerPixel;
}

export { distanceMeters } from '@/lib/geo';
