import { RATING } from '@autoc/shared';

export type TrustLevel = 'low' | 'medium' | 'high';

/**
 * Trust bands. "medium" starts where a user may respond to SOS (RATING.sosHelpMin = 30),
 * so a "low" badge also tells helpers why someone can't help yet.
 */
export const TRUST_THRESHOLDS = { medium: RATING.sosHelpMin, high: 70 } as const;

export function clampRating(value: number): number {
  if (!Number.isFinite(value)) return RATING.min;
  return Math.min(RATING.max, Math.max(RATING.min, Math.round(value)));
}

export function getTrustLevel(rating: number): TrustLevel {
  const value = clampRating(rating);
  if (value >= TRUST_THRESHOLDS.high) return 'high';
  if (value >= TRUST_THRESHOLDS.medium) return 'medium';
  return 'low';
}
