'use client';

import { SERVICE_LIMITS } from '@autoc/shared';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { useErrorMessage } from '@/hooks/use-error-message';
import { isApiError } from '@/lib/api/errors';
import { distanceParts } from './format';

/** Thrown for browser geolocation failures (not API errors). */
export class GeoError extends Error {
  constructor(readonly reason: 'denied' | 'unavailable') {
    super(`Geolocation ${reason}`);
    this.name = 'GeoError';
  }
}

const detail = (error: unknown, key: string): unknown =>
  isApiError(error) && error.details && typeof error.details === 'object' ? (error.details as Record<string, unknown>)[key] : undefined;

/** Phase 7 error codes → `services.errors.*`; everything else falls back to the shared `errors.*` mapping. */
export function useServiceErrorMessage(): (error: unknown) => string {
  const t = useTranslations('services.errors');
  const format = useFormatter();
  const generic = useErrorMessage();
  return useCallback(
    (error: unknown) => {
      if (error instanceof GeoError) return error.reason === 'denied' ? t('geoDenied') : t('geoUnavailable');
      if (!isApiError(error)) return generic(error);
      switch (error.code) {
        case 'TOO_FAR': {
          const meters = Number(detail(error, 'distanceM'));
          const { value, unit } = distanceParts(Number.isFinite(meters) ? meters : 0);
          return t('tooFar', {
            distance: format.number(value, { style: 'unit', unit, unitDisplay: 'short' }),
            radius: SERVICE_LIMITS.geoVisitRadiusM,
          });
        }
        case 'INVALID_QR':
          return t('invalidQr');
        case 'VISIT_EXISTS':
          return t('visitExists');
        case 'VISIT_REQUIRED':
          return t('visitRequired');
        case 'REVIEW_COOLDOWN': {
          const at = detail(error, 'availableAt');
          const date = typeof at === 'string' ? new Date(at) : new Date(Date.now() + SERVICE_LIMITS.reviewCooldownDays * 86_400_000);
          return t('reviewCooldown', { date: format.dateTime(date, { dateStyle: 'long' }) });
        }
        case 'BBOX_TOO_LARGE':
          return t('bboxTooLarge');
        default:
          return generic(error);
      }
    },
    [t, format, generic],
  );
}
