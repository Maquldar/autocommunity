import { describe, expect, it } from 'vitest';
import { distanceParts, formatCountdown, formatPhone, navigateUrl, nextRadiusStep, radiusKm, telHref } from './format';

describe('formatCountdown', () => {
  it('formats m:ss under an hour and h:mm:ss above', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-5)).toBe('0:00');
    expect(formatCountdown(65)).toBe('1:05');
    expect(formatCountdown(3599)).toBe('59:59');
    expect(formatCountdown(3600)).toBe('1:00:00');
    expect(formatCountdown(7199.9)).toBe('1:59:59');
  });
});

describe('radius', () => {
  const created = '2026-10-05T10:00:00Z';
  const at = (min: number) => Date.parse(created) + min * 60_000;
  it('rounds to km', () => {
    expect(radiusKm(5000)).toBe(5);
    expect(radiusKm(20000)).toBe(20);
  });
  it('predicts the next expansion 5 → 10 → 20 km', () => {
    expect(nextRadiusStep(5000, created, at(2))).toEqual({ radiusM: 10000, inSec: 180 });
    expect(nextRadiusStep(5000, created, at(6))).toEqual({ radiusM: 10000, inSec: 0 });
    expect(nextRadiusStep(10000, created, at(7))).toEqual({ radiusM: 20000, inSec: 180 });
    expect(nextRadiusStep(20000, created, at(30))).toBeNull();
  });
});

describe('helpers', () => {
  it('distance parts', () => {
    expect(distanceParts(4)).toEqual({ value: 10, unit: 'meter' });
    expect(distanceParts(356)).toEqual({ value: 360, unit: 'meter' });
    expect(distanceParts(1249)).toEqual({ value: 1.2, unit: 'kilometer' });
  });
  it('phone and links', () => {
    expect(formatPhone('+77071234567')).toBe('+7 707 123 45 67');
    expect(telHref('+7 707 123-45-67')).toBe('tel:+77071234567');
    expect(navigateUrl(43.2, 76.9)).toContain('destination=43.2,76.9');
  });
});
