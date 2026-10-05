/**
 * Trust rating (SPEC A-8, API.md §5). Pure: the same inputs and `now` always give the same result, so the
 * server, the seed and the tests share one implementation.
 */

export const RATING_FORMULA = {
  base: 50,
  min: 0,
  max: 100,
  help: { perHelp: 3, cap: 25, halfLifeDays: 180, unreviewedQuality: 0.6 },
  reviews: { priorMean: 4.0, priorWeight: 3, neutral: 3.5, scale: 10, cap: 15 },
  activity: { windowDays: 30, daysPerPoint: 4, cap: 5 },
  /** A "month" is 30 days. */
  tenure: { pointsPerMonth: 0.5, cap: 5, daysPerMonth: 30 },
  penalties: { windowDays: 365 },
} as const;

/** Penalty amounts Phase 6 records (negative). */
export const RATING_PENALTIES = { report_confirmed: -10, fake_sos: -50 } as const;
export type RatingPenaltyKind = keyof typeof RATING_PENALTIES;

export const RATING_EVENT_REASONS = ['help_confirmed', 'review_received', 'penalty', 'recalc_daily', 'recalc'] as const;
export type RatingEventReason = (typeof RATING_EVENT_REASONS)[number];

export type RatingInput = {
  /** null → no tenure. */
  onboardedAt: Date | null;
  /** Confirmed helps: the user's response reached `arrived` on an SOS that ended `closed`. */
  helps: { closedAt: Date; requesterStars: number | null }[];
  /** Stars of every user review received (both SOS directions). */
  reviewStars: number[];
  /** Distinct days in the last 30 with a message sent, an SOS response, an SOS created or a review written. */
  activeDays30: number;
  /** Penalty points (negative) with their time; only the last 365 days count. */
  penalties: { points: number; createdAt: Date }[];
};

export type RatingBreakdown = { base: number; help: number; reviews: number; activity: number; tenure: number; penalties: number };
export type RatingResult = { rating: number; breakdown: RatingBreakdown };

const DAY_MS = 24 * 3600 * 1000;
const clamp = (min: number, max: number, v: number) => Math.min(max, Math.max(min, v));
/** Components are reported with 2 decimals; the rating is computed from the unrounded values. */
const r2 = (v: number) => Math.round(v * 100) / 100 + 0; // + 0 turns -0 into 0

export function computeRating(input: RatingInput, now: Date): RatingResult {
  const F = RATING_FORMULA;
  const t = now.getTime();

  const helpRaw = input.helps.reduce((sum, h) => {
    const ageDays = Math.max(0, (t - h.closedAt.getTime()) / DAY_MS);
    const q = h.requesterStars === null ? F.help.unreviewedQuality : clamp(1, 5, h.requesterStars) / 5;
    return sum + F.help.perHelp * q * 0.5 ** (ageDays / F.help.halfLifeDays);
  }, 0);
  const help = Math.min(F.help.cap, helpRaw);

  const n = input.reviewStars.length;
  const reviews =
    n === 0
      ? 0
      : clamp(
          -F.reviews.cap,
          F.reviews.cap,
          ((input.reviewStars.reduce((s, x) => s + x, 0) + F.reviews.priorMean * F.reviews.priorWeight) / (n + F.reviews.priorWeight) - F.reviews.neutral) *
            F.reviews.scale,
        );

  const activity = Math.min(F.activity.cap, Math.max(0, input.activeDays30) / F.activity.daysPerPoint);

  const months = input.onboardedAt ? Math.max(0, (t - input.onboardedAt.getTime()) / DAY_MS / F.tenure.daysPerMonth) : 0;
  const tenure = Math.min(F.tenure.cap, months * F.tenure.pointsPerMonth);

  const since = t - F.penalties.windowDays * DAY_MS;
  const penalties = input.penalties.filter((p) => p.points < 0 && p.createdAt.getTime() > since).reduce((s, p) => s + p.points, 0);

  const rating = clamp(F.min, F.max, Math.round(F.base + help + reviews + activity + tenure + penalties));
  return { rating, breakdown: { base: F.base, help: r2(help), reviews: r2(reviews), activity: r2(activity), tenure: r2(tenure), penalties: r2(penalties) } };
}

/* ---------- API DTOs ---------- */

export type RatingDto = RatingResult & { nextThresholds: { sosCreate: number; sosHelp: number } };
export type RatingEventDto = { id: string; delta: number; reason: RatingEventReason; refId: string | null; createdAt: string };
