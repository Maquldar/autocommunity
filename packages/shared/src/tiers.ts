/**
 * Rating decorations (Phase 9). Pure: the API puts `tier` on UserPublic / Me, and the web computes it for
 * UserMini (which only carries `rating`) with the same function.
 */

export const RATING_TIERS = ['warning', 'none', 'bronze', 'silver', 'gold', 'platinum'] as const;
export type RatingTier = (typeof RATING_TIERS)[number];

/** Lowest rating of each tier (inclusive); a tier ends where the next one starts. */
export const RATING_TIER_MIN: Record<RatingTier, number> = {
  warning: 0,
  none: 30,
  bronze: 50,
  silver: 65,
  gold: 80,
  platinum: 90,
};

/**
 * 0–29 `warning` (a visible red "низкое доверие" marker), 30–49 `none`, 50–64 `bronze`, 65–79 `silver`,
 * 80–89 `gold`, 90–100 `platinum`. Out-of-range values clamp to the nearest tier; a non-finite value is `none`.
 */
export function tierForRating(rating: number): RatingTier {
  if (!Number.isFinite(rating)) return 'none';
  if (rating >= RATING_TIER_MIN.platinum) return 'platinum';
  if (rating >= RATING_TIER_MIN.gold) return 'gold';
  if (rating >= RATING_TIER_MIN.silver) return 'silver';
  if (rating >= RATING_TIER_MIN.bronze) return 'bronze';
  if (rating >= RATING_TIER_MIN.none) return 'none';
  return 'warning';
}
