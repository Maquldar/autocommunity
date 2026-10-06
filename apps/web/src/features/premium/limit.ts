import { isApiError, numberDetail } from '@/lib/api/errors';

/** Limit errors that premium doubles (API.md §9.2); they carry `details { limit, premiumLimit }`. */
export const PREMIUM_LIMIT_CODES = ['VEHICLE_LIMIT', 'MEDIA_LIMIT', 'COMMUNITY_LIMIT', 'MEMBERSHIP_LIMIT'] as const;
export type PremiumLimitCode = (typeof PREMIUM_LIMIT_CODES)[number];

export type PremiumLimitInfo = { code: PremiumLimitCode; limit: number; premiumLimit: number };

/**
 * The upgrade hint for a limit error, or null when there is nothing to upgrade to (no details, or the
 * limit that applied is already the premium one).
 */
export function premiumLimitInfo(error: unknown): PremiumLimitInfo | null {
  if (!isApiError(error) || !(PREMIUM_LIMIT_CODES as readonly string[]).includes(error.code)) return null;
  const limit = numberDetail(error, 'limit');
  const premiumLimit = numberDetail(error, 'premiumLimit');
  if (limit === null || premiumLimit === null || premiumLimit <= limit) return null;
  return { code: error.code as PremiumLimitCode, limit, premiumLimit };
}
