import { describe, expect, it } from 'vitest';
import { hasPremium, resolveTier, tierIsDecorated, tierRanges } from './tier';

describe('tiers', () => {
  it('prefers the API tier and computes it for UserMini', () => {
    expect(resolveTier({ tier: 'gold', rating: 10 })).toBe('gold');
    expect(resolveTier({ rating: 29 })).toBe('warning');
    expect(resolveTier({ rating: 30 })).toBe('none');
    expect(resolveTier({ rating: 64 })).toBe('bronze');
    expect(resolveTier({ rating: 79 })).toBe('silver');
    expect(resolveTier({ rating: 85 })).toBe('gold');
    expect(resolveTier({ rating: 90 })).toBe('platinum');
    expect(resolveTier({})).toBe('none');
    expect(resolveTier({ tier: 'bogus' as never, rating: 95 })).toBe('platinum');
  });
  it('treats a missing isPremium as false (pre-Phase 9 payloads)', () => {
    expect(hasPremium({})).toBe(false);
    expect(hasPremium({ isPremium: true })).toBe(true);
    expect(hasPremium({ profileFrame: 'premium' })).toBe(true);
    expect(hasPremium({ isPremium: false, profileFrame: null })).toBe(false);
  });
  it('lists contiguous ranges for the legend', () => {
    const ranges = tierRanges();
    expect(ranges[0]).toEqual({ tier: 'warning', min: 0, max: 29 });
    expect(ranges.at(-1)).toEqual({ tier: 'platinum', min: 90, max: 100 });
    for (let i = 1; i < ranges.length; i += 1) expect(ranges[i]!.min).toBe(ranges[i - 1]!.max + 1);
    expect(tierIsDecorated('none')).toBe(false);
    expect(tierIsDecorated('warning')).toBe(true);
  });
});
