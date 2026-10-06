import { describe, expect, it } from 'vitest';
import { computeRating, RATING_PENALTIES, voteWeight, type RatingInput } from './rating';

const NOW = new Date('2026-10-05T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 3600 * 1000);
const empty: RatingInput = { onboardedAt: null, helps: [], reviewStars: [], activeDays30: 0, penalties: [], votes: [] };
const run = (patch: Partial<RatingInput>) => computeRating({ ...empty, ...patch }, NOW);

describe('computeRating', () => {
  it('starts at 50 for a new user', () => {
    expect(run({})).toEqual({ rating: 50, breakdown: { base: 50, help: 0, reviews: 0, activity: 0, tenure: 0, votes: 0, penalties: 0 } });
    expect(run({ onboardedAt: NOW }).rating).toBe(50);
  });

  it('help: 3 × stars/5, 0.6 quality without review, halves every 180 days, capped at 25', () => {
    expect(run({ helps: [{ closedAt: NOW, requesterStars: 5 }] }).breakdown.help).toBe(3);
    expect(run({ helps: [{ closedAt: NOW, requesterStars: 4 }] }).breakdown.help).toBe(2.4);
    expect(run({ helps: [{ closedAt: NOW, requesterStars: null }] }).breakdown.help).toBe(1.8);
    expect(run({ helps: [{ closedAt: daysAgo(180), requesterStars: 5 }] }).breakdown.help).toBe(1.5);
    expect(run({ helps: [{ closedAt: daysAgo(360), requesterStars: 5 }] }).breakdown.help).toBe(0.75);
    expect(run({ helps: [{ closedAt: daysAgo(90), requesterStars: 5 }] }).breakdown.help).toBeCloseTo(3 * 2 ** -0.5, 2);
    const many = Array.from({ length: 20 }, () => ({ closedAt: NOW, requesterStars: 5 }));
    expect(run({ helps: many })).toMatchObject({ rating: 75, breakdown: { help: 25 } });
  });

  it('reviews: Bayesian mean with prior 4.0 × 3, (m − 3.5) × 10, clamped ±15, 0 without reviews', () => {
    // one 5★: m = (5 + 12) / 4 = 4.25 → 7.5
    expect(run({ reviewStars: [5] }).breakdown.reviews).toBe(7.5);
    // one 1★: m = 13/4 = 3.25 → −2.5
    expect(run({ reviewStars: [1] }).breakdown.reviews).toBe(-2.5);
    // many 5★: m approaches 5 (→ +15) but never passes it: (500 + 12) / 103 = 4.971 → 14.71
    expect(run({ reviewStars: Array(100).fill(5) }).breakdown.reviews).toBe(14.71);
    expect(run({ reviewStars: Array(1000).fill(5) }).breakdown.reviews).toBe(14.97);
    expect(run({ reviewStars: Array(1000).fill(1) }).breakdown.reviews).toBe(-15);
    expect(run({ reviewStars: [3, 4] }).breakdown.reviews).toBe(3); // (7 + 12) / 5 = 3.8 → 3
  });

  it('activity: days / 4, capped at 5', () => {
    expect(run({ activeDays30: 6 }).breakdown.activity).toBe(1.5);
    expect(run({ activeDays30: 20 }).breakdown.activity).toBe(5);
    expect(run({ activeDays30: 30 }).breakdown.activity).toBe(5);
  });

  it('tenure: 0.5 per 30-day month, capped at 5', () => {
    expect(run({ onboardedAt: daysAgo(90) }).breakdown.tenure).toBe(1.5);
    expect(run({ onboardedAt: daysAgo(300) }).breakdown.tenure).toBe(5);
    expect(run({ onboardedAt: daysAgo(3000) }).breakdown.tenure).toBe(5);
  });

  it('penalties: negative points of the last 365 days; older ones expire', () => {
    expect(run({ penalties: [{ points: -10, createdAt: daysAgo(10) }] })).toMatchObject({ rating: 40, breakdown: { penalties: -10 } });
    expect(run({ penalties: [{ points: -10, createdAt: daysAgo(364) }, { points: -50, createdAt: daysAgo(366) }] }).breakdown.penalties).toBe(-10);
    expect(run({ penalties: [{ points: 5, createdAt: daysAgo(1) }] }).breakdown.penalties).toBe(0);
  });

  it('clamps to 0..100 and rounds the sum', () => {
    expect(run({ penalties: [{ points: -50, createdAt: NOW }, { points: -50, createdAt: NOW }] }).rating).toBe(0);
    const max = run({
      onboardedAt: daysAgo(1000),
      helps: Array.from({ length: 30 }, () => ({ closedAt: NOW, requesterStars: 5 })),
      reviewStars: Array(1000).fill(5),
      activeDays30: 30,
    });
    expect(max).toEqual({ rating: 100, breakdown: { base: 50, help: 25, reviews: 14.97, activity: 5, tenure: 5, votes: 0, penalties: 0 } });
    // 50 + 1.8 + 0.25 tenure(15 days) = 52.05 → 52
    expect(run({ helps: [{ closedAt: NOW, requesterStars: null }], onboardedAt: daysAgo(15) }).rating).toBe(52);
  });

  it('combines every component', () => {
    const r = run({
      onboardedAt: daysAgo(60), // tenure 1
      helps: [{ closedAt: daysAgo(180), requesterStars: 5 }], // 1.5
      reviewStars: [5], // 7.5
      activeDays30: 8, // 2
      penalties: [{ points: -10, createdAt: daysAgo(30) }],
    });
    expect(r).toEqual({ rating: 52, breakdown: { base: 50, help: 1.5, reviews: 7.5, activity: 2, tenure: 1, votes: 0, penalties: -10 } });
  });

  it('votes: value × weight, halving every 180 days, only the last 180 days, clamped ±15', () => {
    expect(run({ votes: [{ value: 1, weight: 1, createdAt: NOW }] }).breakdown.votes).toBe(1);
    expect(run({ votes: [{ value: -1, weight: 1.5, createdAt: NOW }] })).toMatchObject({ rating: 49, breakdown: { votes: -1.5 } });
    expect(run({ votes: [{ value: 1, weight: 1, createdAt: daysAgo(90) }] }).breakdown.votes).toBeCloseTo(2 ** -0.5, 2);
    expect(run({ votes: [{ value: 1, weight: 1, createdAt: daysAgo(179) }] }).breakdown.votes).toBeCloseTo(0.5, 2);
    expect(run({ votes: [{ value: 1, weight: 1, createdAt: daysAgo(181) }] }).breakdown.votes).toBe(0);
    // ups and downs cancel out
    expect(run({ votes: [{ value: 1, weight: 1, createdAt: NOW }, { value: -1, weight: 1, createdAt: NOW }] }).breakdown.votes).toBe(0);
    const ups = Array.from({ length: 40 }, () => ({ value: 1, weight: 1.5, createdAt: NOW }));
    expect(run({ votes: ups })).toMatchObject({ rating: 65, breakdown: { votes: 15 } });
    const downs = Array.from({ length: 40 }, () => ({ value: -1, weight: 1.5, createdAt: NOW }));
    expect(run({ votes: downs })).toMatchObject({ rating: 35, breakdown: { votes: -15 } });
  });

  it('voteWeight: 0.5 below 60, 1 for 60–79, 1.5 from 80', () => {
    expect(voteWeight(40)).toBe(0.5);
    expect(voteWeight(59)).toBe(0.5);
    expect(voteWeight(60)).toBe(1);
    expect(voteWeight(79)).toBe(1);
    expect(voteWeight(80)).toBe(1.5);
    expect(voteWeight(100)).toBe(1.5);
  });

  it('violation penalties: −5 each, at most −20 in total, expiring after 365 days; other penalties stack on top', () => {
    const v = (d: number) => ({ points: RATING_PENALTIES.violation, createdAt: daysAgo(d), kind: 'violation' as const });
    expect(RATING_PENALTIES.violation).toBe(-5);
    expect(run({ penalties: [v(1)] })).toMatchObject({ rating: 45, breakdown: { penalties: -5 } });
    expect(run({ penalties: [v(1), v(2), v(3), v(4)] }).breakdown.penalties).toBe(-20);
    expect(run({ penalties: [v(1), v(2), v(3), v(4), v(5), v(6)] }).breakdown.penalties).toBe(-20);
    expect(run({ penalties: [v(1), v(400)] }).breakdown.penalties).toBe(-5);
    expect(run({ penalties: [v(1), v(2), v(3), v(4), v(5), { points: -10, createdAt: daysAgo(1), kind: 'report_confirmed' }] })).toMatchObject({
      rating: 20,
      breakdown: { penalties: -30 },
    });
    // a penalty without a kind (pre-Phase 9 rows) is never capped
    expect(run({ penalties: [{ points: -50, createdAt: daysAgo(1) }] }).breakdown.penalties).toBe(-50);
  });
});
