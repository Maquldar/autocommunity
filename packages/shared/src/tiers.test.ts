import { describe, expect, it } from 'vitest';
import { RATING_TIERS, tierForRating } from './tiers';

describe('tierForRating', () => {
  it.each([
    [0, 'warning'],
    [29, 'warning'],
    [30, 'none'],
    [49, 'none'],
    [50, 'bronze'],
    [64, 'bronze'],
    [65, 'silver'],
    [79, 'silver'],
    [80, 'gold'],
    [89, 'gold'],
    [90, 'platinum'],
    [100, 'platinum'],
  ] as const)('%i → %s', (rating, tier) => expect(tierForRating(rating)).toBe(tier));

  it('handles fractions, out-of-range and non-finite values', () => {
    expect(tierForRating(29.9)).toBe('warning');
    expect(tierForRating(-5)).toBe('warning');
    expect(tierForRating(150)).toBe('platinum');
    expect(tierForRating(Number.NaN)).toBe('none');
  });

  it('every tier is reachable', () => {
    const seen = new Set(Array.from({ length: 101 }, (_, r) => tierForRating(r)));
    expect([...seen].sort()).toEqual([...RATING_TIERS].sort());
  });
});
