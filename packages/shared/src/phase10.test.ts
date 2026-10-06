import { describe, expect, it } from 'vitest';
import { RATING_TIER_NAMES, RATING_TIERS, tierForRating, tierNameForRating } from './tiers';
import {
  computeVoteTraits,
  createVoteSchema,
  VOTE_NEGATIVE_REASONS,
  VOTE_POSITIVE_REASONS,
  VOTE_REASON_SIGN,
  VOTE_REASONS,
  voteReasonFits,
  type VoteTraitCounts,
} from './votes';

describe('tier names (Phase 10)', () => {
  it('maps every tier to the client wording, keys and thresholds unchanged', () => {
    expect(RATING_TIER_NAMES).toEqual({
      warning: { ru: 'Злостный нарушитель', en: 'Repeat offender' },
      none: { ru: 'Обычный водитель', en: 'Regular driver' },
      bronze: { ru: 'Надёжный водитель', en: 'Reliable driver' },
      silver: { ru: 'Уважаемый водитель', en: 'Respected driver' },
      gold: { ru: 'Образцовый водитель', en: 'Exemplary driver' },
      platinum: { ru: 'Легенда дорог', en: 'Road legend' },
    });
    expect(Object.keys(RATING_TIER_NAMES).sort()).toEqual([...RATING_TIERS].sort());
  });

  it.each([
    [0, 'Злостный нарушитель', 'Repeat offender'],
    [29, 'Злостный нарушитель', 'Repeat offender'],
    [30, 'Обычный водитель', 'Regular driver'],
    [49, 'Обычный водитель', 'Regular driver'],
    [50, 'Надёжный водитель', 'Reliable driver'],
    [64, 'Надёжный водитель', 'Reliable driver'],
    [65, 'Уважаемый водитель', 'Respected driver'],
    [79, 'Уважаемый водитель', 'Respected driver'],
    [80, 'Образцовый водитель', 'Exemplary driver'],
    [89, 'Образцовый водитель', 'Exemplary driver'],
    [90, 'Легенда дорог', 'Road legend'],
    [100, 'Легенда дорог', 'Road legend'],
  ] as const)('%i → %s / %s', (rating, ru, en) => {
    expect(tierNameForRating(rating, 'ru')).toBe(ru);
    expect(tierNameForRating(rating, 'en')).toBe(en);
  });

  it('0–29 is still the red `warning` tier', () => {
    expect(tierForRating(29)).toBe('warning');
  });
});

describe('vote reason signs (Phase 10)', () => {
  const NEW_NEGATIVE = ['cuts_off', 'no_turn_signals', 'speeding', 'tailgating', 'bad_parking', 'aggressive', 'phone_while_driving'] as const;
  const NEW_POSITIVE = ['lets_merge', 'careful_driver', 'signals_properly'] as const;

  it('keeps the Phase 9 reasons and adds the driving ones', () => {
    for (const r of ['helped_on_road', 'polite', 'good_driver', 'rude', 'dangerous_driving', 'scam', 'other']) expect(VOTE_REASONS).toContain(r);
    for (const r of [...NEW_NEGATIVE, ...NEW_POSITIVE]) expect(VOTE_REASONS).toContain(r);
    expect(new Set(VOTE_REASONS).size).toBe(VOTE_REASONS.length);
  });

  it('every reason has a sign; each must match the vote', () => {
    for (const r of NEW_NEGATIVE) expect(VOTE_REASON_SIGN[r]).toBe(-1);
    for (const r of NEW_POSITIVE) expect(VOTE_REASON_SIGN[r]).toBe(1);
    expect(VOTE_REASON_SIGN.other).toBe(0);
    for (const r of VOTE_POSITIVE_REASONS) {
      expect(voteReasonFits(1, r)).toBe(true);
      expect(voteReasonFits(-1, r)).toBe(false);
    }
    for (const r of VOTE_NEGATIVE_REASONS) {
      expect(voteReasonFits(-1, r)).toBe(true);
      expect(voteReasonFits(1, r)).toBe(false);
    }
    expect(Object.keys(VOTE_REASON_SIGN).sort()).toEqual([...VOTE_REASONS].sort());
  });

  it('the schema rejects a mismatched sign', () => {
    expect(createVoteSchema.safeParse({ value: -1, reason: 'cuts_off' }).success).toBe(true);
    expect(createVoteSchema.safeParse({ value: 1, reason: 'lets_merge' }).success).toBe(true);
    expect(createVoteSchema.safeParse({ value: 1, reason: 'cuts_off' }).success).toBe(false);
    expect(createVoteSchema.safeParse({ value: -1, reason: 'signals_properly' }).success).toBe(false);
  });
});

describe('computeVoteTraits', () => {
  const counts = (patch: Partial<VoteTraitCounts>): VoteTraitCounts => ({ voters: 0, upVoters: 0, downVoters: 0, reasons: [], ...patch });

  it('nothing below 3 voters, even when one reason is unanimous', () => {
    expect(computeVoteTraits(counts({ voters: 2, downVoters: 2, reasons: [{ value: -1, reason: 'cuts_off', voters: 2 }] }))).toEqual({ negative: [], positive: [] });
  });

  it('needs ≥ 2 voters and ≥ 25% of the sign', () => {
    const t = computeVoteTraits(
      counts({
        voters: 12,
        downVoters: 10,
        upVoters: 2,
        reasons: [
          { value: -1, reason: 'cuts_off', voters: 5 },
          { value: -1, reason: 'no_turn_signals', voters: 3 }, // 30%
          { value: -1, reason: 'speeding', voters: 2 }, // 20% → out
          { value: -1, reason: 'other', voters: 4 }, // never a trait
          { value: 1, reason: 'lets_merge', voters: 2 },
          { value: 1, reason: 'polite', voters: 1 }, // < 2 → out
        ],
      }),
    );
    expect(t).toEqual({
      negative: [
        { reason: 'cuts_off', count: 5 },
        { reason: 'no_turn_signals', count: 3 },
      ],
      positive: [{ reason: 'lets_merge', count: 2 }],
    });
  });

  it('at most 3 per sign, ties in reason order, and a reason never counts for the wrong sign', () => {
    const t = computeVoteTraits(
      counts({
        voters: 8,
        downVoters: 8,
        reasons: [
          { value: -1, reason: 'speeding', voters: 2 },
          { value: -1, reason: 'cuts_off', voters: 2 },
          { value: -1, reason: 'tailgating', voters: 2 },
          { value: -1, reason: 'aggressive', voters: 2 },
          { value: 1, reason: 'cuts_off', voters: 9 },
        ],
      }),
    );
    expect(t.negative.map((x) => x.reason)).toEqual(['cuts_off', 'speeding', 'tailgating']);
    expect(t.positive).toEqual([]);
  });
});
