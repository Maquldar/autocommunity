import { describe, expect, it } from 'vitest';
import { ALMATY_BOUNDS, DEMO_LOOP_STEPS, demoStep } from './demo-path';

const metersBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const dLat = (b.lat - a.lat) * 111_320;
  const dLng = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
};

describe('demoStep', () => {
  const id = '0192f0c0-1234-7000-8000-00000000abcd';

  it('is deterministic and moves at most ~50 m per tick', () => {
    const start = { lat: 43.2389, lng: 76.8897 };
    expect(demoStep(id, start.lat, start.lng, 7)).toEqual(demoStep(id, start.lat, start.lng, 7));
    let p = start;
    for (let tick = 0; tick < 100; tick++) {
      const next = demoStep(id, p.lat, p.lng, tick);
      const d = metersBetween(p, next);
      expect(d).toBeGreaterThan(5);
      expect(d).toBeLessThanOrEqual(50);
      p = next;
    }
  });

  it('closes the loop after DEMO_LOOP_STEPS ticks', () => {
    let p = { lat: 43.25, lng: 76.92 };
    for (let tick = 1000; tick < 1000 + DEMO_LOOP_STEPS; tick++) p = demoStep(id, p.lat, p.lng, tick);
    expect(metersBetween(p, { lat: 43.25, lng: 76.92 })).toBeLessThan(1);
  });

  it('stays within Almaty and walks back in from outside', () => {
    let p = { lat: ALMATY_BOUNDS.maxLat - 0.0001, lng: ALMATY_BOUNDS.maxLng - 0.0001 };
    for (let tick = 0; tick < 200; tick++) {
      p = demoStep(id, p.lat, p.lng, tick);
      expect(p.lat).toBeLessThanOrEqual(ALMATY_BOUNDS.maxLat);
      expect(p.lng).toBeLessThanOrEqual(ALMATY_BOUNDS.maxLng);
    }
    const outside = { lat: 51.16, lng: 71.47 }; // Astana
    const next = demoStep(id, outside.lat, outside.lng, 0);
    expect(next.lat).toBeLessThan(outside.lat);
    expect(next.lng).toBeGreaterThan(outside.lng);
  });
});
