import { describe, expect, it } from 'vitest';
import { bboxParam, distanceMeters, isTooLarge, MAX_BBOX_SPAN_DEG, metersToPixels, spanOf, toQueryBounds } from './bbox';

const almaty = { west: 76.85, south: 43.2, east: 76.95, north: 43.28 };

describe('isTooLarge', () => {
  it('accepts a city viewport', () => {
    expect(isTooLarge(almaty)).toBe(false);
  });

  it('rejects viewports wider or taller than 2°', () => {
    expect(isTooLarge({ west: 75, south: 43, east: 77.5, north: 44 })).toBe(true);
    expect(isTooLarge({ west: 76, south: 42, east: 77, north: 44.01 })).toBe(true);
  });

  it('accepts exactly 2°', () => {
    expect(isTooLarge({ west: 76, south: 42, east: 78, north: 44 })).toBe(false);
  });

  it('measures spans across the antimeridian', () => {
    expect(spanOf({ west: 179, south: 0, east: -179, north: 1 })).toEqual({ lng: 2, lat: 1 });
  });
});

describe('toQueryBounds', () => {
  it('returns null when zoomed out past the limit', () => {
    expect(toQueryBounds({ west: 70, south: 40, east: 80, north: 46 })).toBeNull();
  });

  it('pads the viewport and contains it', () => {
    const q = toQueryBounds(almaty)!;
    expect(q.west).toBeLessThan(almaty.west);
    expect(q.east).toBeGreaterThan(almaty.east);
    expect(q.south).toBeLessThan(almaty.south);
    expect(q.north).toBeGreaterThan(almaty.north);
  });

  it('never exceeds 2° × 2° even after padding', () => {
    const q = toQueryBounds({ west: 76, south: 42.2, east: 77.9, north: 44.1 })!;
    expect(q.east - q.west).toBeLessThanOrEqual(MAX_BBOX_SPAN_DEG);
    expect(q.north - q.south).toBeLessThanOrEqual(MAX_BBOX_SPAN_DEG);
    // Clamped around the viewport centre.
    expect((q.east + q.west) / 2).toBeCloseTo(76.95, 2);
  });

  it('clips to valid coordinates and keeps min < max', () => {
    const q = toQueryBounds({ west: 179.5, south: 89.5, east: 180, north: 90 })!;
    expect(q.east).toBeLessThanOrEqual(180);
    expect(q.north).toBeLessThanOrEqual(90);
    expect(q.west).toBeLessThan(q.east);
    expect(q.south).toBeLessThan(q.north);
  });

  it('is stable for tiny pans (rounded to ~100 m)', () => {
    const a = bboxParam(toQueryBounds(almaty)!);
    const b = bboxParam(toQueryBounds({ ...almaty, west: almaty.west + 0.00001, east: almaty.east + 0.00001 })!);
    expect(a).toBe(b);
  });

  it('formats as minLng,minLat,maxLng,maxLat', () => {
    expect(bboxParam({ west: 1, south: 2, east: 3, north: 4 })).toBe('1,2,3,4');
  });
});

describe('geometry helpers', () => {
  it('computes haversine distance', () => {
    // ~111 m per 0.001° of latitude.
    expect(distanceMeters({ lat: 43, lng: 76 }, { lat: 43.001, lng: 76 })).toBeCloseTo(111.2, 0);
    expect(distanceMeters({ lat: 43, lng: 76 }, { lat: 43, lng: 76 })).toBe(0);
  });

  it('converts metres to pixels, doubling per zoom level', () => {
    const z12 = metersToPixels(250, 43.24, 12);
    expect(metersToPixels(250, 43.24, 13)).toBeCloseTo(z12 * 2, 5);
    expect(z12).toBeGreaterThan(10);
    expect(z12).toBeLessThan(40);
  });
});
