import { RATING_TIER_MIN, RATING_TIERS, tierForRating, type RatingTier } from '@autoc/shared';

/**
 * Rating tiers (API.md §9.0) as the web draws them. UserPublic / Me carry `tier`; UserMini only has the
 * rating, so the same shared `tierForRating` decides.
 */
export type TierUser = { rating?: number | null; tier?: RatingTier | null };

export function resolveTier(user: TierUser): RatingTier {
  if (user.tier && (RATING_TIERS as readonly string[]).includes(user.tier)) return user.tier;
  return typeof user.rating === 'number' ? tierForRating(user.rating) : 'none';
}

/** Premium decoration: the profile frame on UserPublic/Me, `isPremium` everywhere else (missing → false). */
export type PremiumUser = { isPremium?: boolean | null; profileFrame?: 'premium' | null };

export function hasPremium(user: PremiumUser): boolean {
  return user.profileFrame === 'premium' || user.isPremium === true;
}

/** Tiers with a visible decoration (`none` has nothing). */
export function tierIsDecorated(tier: RatingTier): boolean {
  return tier !== 'none';
}

export type TierRange = { tier: RatingTier; min: number; max: number };

/** The legend: every tier with its inclusive rating range, lowest first. */
export function tierRanges(): TierRange[] {
  return RATING_TIERS.map((tier, i) => {
    const next = RATING_TIERS[i + 1];
    return { tier, min: RATING_TIER_MIN[tier], max: next ? RATING_TIER_MIN[next] - 1 : 100 };
  });
}

/** Ring utility per tier (static strings so Tailwind sees them). */
export const TIER_RING: Record<RatingTier, string> = {
  warning: 'ring-danger',
  none: '',
  bronze: 'ring-tier-bronze',
  silver: 'ring-tier-silver',
  gold: 'ring-tier-gold',
  platinum: 'ring-tier-platinum',
};

export const TIER_BADGE: Record<RatingTier, string> = {
  warning: 'bg-danger-soft text-danger-soft-foreground',
  none: 'bg-muted text-muted-foreground',
  bronze: 'bg-tier-bronze-soft text-tier-bronze-foreground',
  silver: 'bg-tier-silver-soft text-tier-silver-foreground',
  gold: 'bg-tier-gold-soft text-tier-gold-foreground',
  platinum: 'bg-tier-platinum-soft text-tier-platinum-foreground',
};
