import { REPORT_REASONS, type ReportReason, type ReportTargetType } from '@autoc/shared';
import { getRetryAfterSec, isApiError } from '@/lib/api/errors';

/** Reasons offered for a target: `fake_sos` only for SOS (the API rejects it elsewhere), and first there. */
export function reasonsFor(targetType: ReportTargetType): ReportReason[] {
  if (targetType === 'sos') return ['fake_sos', ...REPORT_REASONS.filter((r) => r !== 'fake_sos')];
  return REPORT_REASONS.filter((r) => r !== 'fake_sos');
}

export type ReportErrorKey = 'alreadyReported' | 'rateLimited' | 'rateLimitedShort' | 'invalidTarget' | 'notFound';

/** Report-specific errors → `reports.errors.*`; null for everything else (generic message). */
export function reportError(error: unknown): { key: ReportErrorKey; minutes?: number } | null {
  if (!isApiError(error)) return null;
  switch (error.code) {
    case 'ALREADY_REPORTED':
      return { key: 'alreadyReported' };
    case 'RATE_LIMITED': {
      const sec = getRetryAfterSec(error);
      return sec === null ? { key: 'rateLimitedShort' } : { key: 'rateLimited', minutes: Math.max(1, Math.ceil(sec / 60)) };
    }
    case 'INVALID_TARGET':
      return { key: 'invalidTarget' };
    case 'NOT_FOUND':
      return { key: 'notFound' };
    default:
      return null;
  }
}
