import { RATING } from '@autoc/shared';
import { getRetryAfterSec, isApiError } from '@/lib/api/errors';

/**
 * Gate and conflict errors from the SOS endpoints → what to tell the driver and what they can do next
 * (keys in `sos.guidance.*`). Pure, so the mapping is unit-tested; `<SosGuidanceNotice>` renders it.
 */

export type SosGuidanceKey =
  | 'phoneNotVerified'
  | 'ratingTooLowCreate'
  | 'ratingTooLowHelp'
  | 'banned'
  | 'rateLimit'
  | 'alreadyOpen'
  | 'locationRequired'
  | 'helperLimit'
  | 'helperBusy'
  | 'offerLimit'
  | 'invalidState'
  | 'notFound';

export type SosGuidanceAction =
  | { kind: 'link'; href: string; label: 'linkPhone' | 'viewActive' | 'findOthers' }
  /** Open the user's own open SOS (looked up through GET /sos/active). */
  | { kind: 'open_active' }
  /** Turn on location sharing (LocationProvider.enable). */
  | { kind: 'share_location' }
  | { kind: 'reload' };

export type SosGuidance = {
  key: SosGuidanceKey;
  /** `danger` for "you can't do this", `warning` for "not right now", `info` for state changes. */
  tone: 'danger' | 'warning' | 'info';
  values?: { min?: number; until?: Date; retryAt?: Date };
  action?: SosGuidanceAction;
};

/** Where the guidance is shown: creating an SOS, or helping with one (respond/withdraw/arrived). */
export type SosGuidanceContext = 'create' | 'help' | 'requester' | 'nearby';

function detailString(error: unknown, key: string): string | null {
  if (!isApiError(error) || typeof error.details !== 'object' || error.details === null) return null;
  const value = (error.details as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

/** Returns null for errors that aren't SOS-specific (the generic `errors.*` message applies). */
export function sosGuidance(error: unknown, context: SosGuidanceContext, nowMs = Date.now()): SosGuidance | null {
  if (!isApiError(error)) return null;
  switch (error.code) {
    case 'PHONE_NOT_VERIFIED':
      return { key: 'phoneNotVerified', tone: 'warning', action: { kind: 'link', href: '/settings#settings-phone', label: 'linkPhone' } };
    case 'RATING_TOO_LOW':
      return context === 'create'
        ? { key: 'ratingTooLowCreate', tone: 'danger', values: { min: RATING.sosCreateMin } }
        : { key: 'ratingTooLowHelp', tone: 'danger', values: { min: RATING.sosHelpMin } };
    case 'SOS_BANNED': {
      const raw = detailString(error, 'until');
      const until = raw ? new Date(raw) : null;
      return { key: 'banned', tone: 'danger', values: until && !Number.isNaN(until.getTime()) ? { until } : {} };
    }
    case 'SOS_RATE_LIMIT': {
      const seconds = getRetryAfterSec(error);
      return { key: 'rateLimit', tone: 'warning', values: seconds !== null ? { retryAt: new Date(nowMs + seconds * 1000) } : {} };
    }
    case 'SOS_ALREADY_OPEN':
      return { key: 'alreadyOpen', tone: 'info', action: { kind: 'open_active' } };
    case 'LOCATION_REQUIRED':
      return { key: 'locationRequired', tone: 'warning', action: { kind: 'share_location' } };
    case 'SOS_HELPER_LIMIT':
      return { key: 'helperLimit', tone: 'warning' };
    case 'SOS_HELPER_BUSY':
      return { key: 'helperBusy', tone: 'warning', action: { kind: 'link', href: '/sos', label: 'viewActive' } };
    case 'SOS_OFFER_LIMIT':
      return { key: 'offerLimit', tone: 'info', action: { kind: 'link', href: '/sos/nearby', label: 'findOthers' } };
    case 'SOS_INVALID_STATE':
      return { key: 'invalidState', tone: 'info', action: { kind: 'reload' } };
    case 'NOT_FOUND':
      return context === 'create' ? null : { key: 'notFound', tone: 'info' };
    default:
      return null;
  }
}
