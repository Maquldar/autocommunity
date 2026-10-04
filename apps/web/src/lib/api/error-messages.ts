import { LIMITS } from '@autoc/shared';
import { getAttemptsLeft, getRetryAfterSec, isApiError } from './errors';

/** Keys in the `errors` message namespace that API errors map to. */
export type ErrorMessageKey =
  | 'generic'
  | 'network'
  | 'server'
  | 'unauthorized'
  | 'forbidden'
  | 'notFound'
  | 'conflict'
  | 'validation'
  | 'rateLimited'
  | 'rateLimitedShort'
  | 'otpInvalid'
  | 'otpExpired'
  | 'sessionExpired'
  | 'providerDisabled'
  | 'invalidIdToken'
  | 'smsUnavailable'
  | 'nicknameTaken'
  | 'phoneInUse'
  | 'phoneAlreadyVerified'
  | 'phoneNotSupported'
  | 'payloadTooLarge'
  | 'vehicleLimit'
  | 'onboardingIncomplete'
  | 'invalidUpload'
  | 'fileTooLarge'
  | 'unsupportedFileType'
  | 'accountBlocked';

export type ErrorMessage = { key: ErrorMessageKey; values?: Record<string, number> };

const BY_CODE: Partial<Record<string, ErrorMessageKey>> = {
  NETWORK_ERROR: 'network',
  INTERNAL: 'server',
  UNAUTHORIZED: 'unauthorized',
  SESSION_EXPIRED: 'sessionExpired',
  CSRF_FAILED: 'sessionExpired',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'notFound',
  CONFLICT: 'conflict',
  VALIDATION_ERROR: 'validation',
  OTP_EXPIRED: 'otpExpired',
  PROVIDER_DISABLED: 'providerDisabled',
  INVALID_ID_TOKEN: 'invalidIdToken',
  SMS_UNAVAILABLE: 'smsUnavailable',
  NICKNAME_TAKEN: 'nicknameTaken',
  PHONE_IN_USE: 'phoneInUse',
  PHONE_ALREADY_VERIFIED: 'phoneAlreadyVerified',
  PHONE_NOT_SUPPORTED: 'phoneNotSupported',
  PAYLOAD_TOO_LARGE: 'payloadTooLarge',
  ONBOARDING_INCOMPLETE: 'onboardingIncomplete',
  INVALID_UPLOAD: 'invalidUpload',
  UNSUPPORTED_FILE_TYPE: 'unsupportedFileType',
  ACCOUNT_BLOCKED: 'accountBlocked',
};

/** Maps any thrown value to a localized message descriptor (pure, so it is unit-testable). */
export function describeError(error: unknown): ErrorMessage {
  if (!isApiError(error)) return { key: 'generic' };
  switch (error.code) {
    case 'OTP_INVALID': {
      const attemptsLeft = getAttemptsLeft(error);
      return attemptsLeft === null ? { key: 'otpExpired' } : { key: 'otpInvalid', values: { attemptsLeft } };
    }
    case 'RATE_LIMITED': {
      const seconds = getRetryAfterSec(error);
      return seconds === null ? { key: 'rateLimitedShort' } : { key: 'rateLimited', values: { seconds } };
    }
    case 'VEHICLE_LIMIT':
      return { key: 'vehicleLimit', values: { max: LIMITS.vehiclesPerUser } };
    case 'FILE_TOO_LARGE':
      return { key: 'fileTooLarge', values: { maxMb: Math.round(LIMITS.imageMaxBytes / (1024 * 1024)) } };
    default:
      break;
  }
  const mapped = BY_CODE[error.code];
  if (mapped) return { key: mapped };
  if (error.status >= 500) return { key: 'server' };
  return { key: 'generic' };
}
