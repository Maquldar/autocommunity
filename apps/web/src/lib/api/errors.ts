/** Error codes from API.md §0 and §1, plus client-side NETWORK_ERROR. Unknown codes are still accepted. */
export const KNOWN_ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'ACCOUNT_BLOCKED',
  'INTERNAL',
  'OTP_INVALID',
  'OTP_EXPIRED',
  'SESSION_EXPIRED',
  'CSRF_FAILED',
  'PROVIDER_DISABLED',
  'INVALID_ID_TOKEN',
  'SMS_UNAVAILABLE',
  'NICKNAME_TAKEN',
  'PHONE_IN_USE',
  'PHONE_ALREADY_VERIFIED',
  'PHONE_NOT_SUPPORTED',
  'PAYLOAD_TOO_LARGE',
  'VEHICLE_LIMIT',
  'ONBOARDING_INCOMPLETE',
  'INVALID_UPLOAD',
  'FILE_TOO_LARGE',
  'UNSUPPORTED_FILE_TYPE',
  'NETWORK_ERROR',
] as const;

export type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];
// `string & {}` keeps autocompletion for known codes while accepting new server codes.
export type ApiErrorCode = KnownErrorCode | (string & {});

export type ValidationIssue = { path: Array<string | number>; message: string };

/** Fallback code when a response has no parseable error body (proxy pages, empty 502s). */
const STATUS_CODES: Record<number, KnownErrorCode> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'FILE_TOO_LARGE',
  415: 'UNSUPPORTED_FILE_TYPE',
  429: 'RATE_LIMITED',
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: unknown;

  constructor(init: { status: number; code: ApiErrorCode; message: string; details?: unknown }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function hasErrorCode(error: unknown, code: ApiErrorCode): error is ApiError {
  return isApiError(error) && error.code === code;
}

export function networkError(cause?: unknown): ApiError {
  const message = cause instanceof Error ? cause.message : 'Network request failed';
  return new ApiError({ status: 0, code: 'NETWORK_ERROR', message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Builds an ApiError from a non-2xx response with the `{ error: { code, message, details? } }` shape. */
export async function parseApiError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON (HTML error page, empty body); fall back to the status.
  }
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  const code = error && typeof error.code === 'string' ? error.code : (STATUS_CODES[response.status] ?? (response.status >= 500 ? 'INTERNAL' : 'ERROR'));
  const message = error && typeof error.message === 'string' ? error.message : response.statusText || `HTTP ${response.status}`;
  let details: unknown = error?.details;

  // 429 always carries Retry-After; use it when the body didn't include retryAfterSec.
  const hasRetryAfter = isRecord(details) && typeof details.retryAfterSec === 'number';
  if (response.status === 429 && !hasRetryAfter) {
    const header = Number(response.headers.get('Retry-After'));
    if (Number.isFinite(header) && header > 0) details = { ...(isRecord(details) ? details : {}), retryAfterSec: header };
  }
  return new ApiError({ status: response.status, code, message, details });
}

function numberDetail(error: unknown, key: string): number | null {
  if (!isApiError(error) || !isRecord(error.details)) return null;
  const value = error.details[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Seconds until a RATE_LIMITED action may be retried. */
export function getRetryAfterSec(error: unknown): number | null {
  return numberDetail(error, 'retryAfterSec');
}

/** Remaining tries for OTP_INVALID. */
export function getAttemptsLeft(error: unknown): number | null {
  return numberDetail(error, 'attemptsLeft');
}

/** Field issues of a VALIDATION_ERROR (zod issues from the server). */
export function getValidationIssues(error: unknown): ValidationIssue[] {
  if (!hasErrorCode(error, 'VALIDATION_ERROR') || !Array.isArray(error.details)) return [];
  return error.details.flatMap((issue: unknown) => {
    if (!isRecord(issue) || !Array.isArray(issue.path)) return [];
    const path = issue.path.filter((p): p is string | number => typeof p === 'string' || typeof p === 'number');
    return [{ path, message: typeof issue.message === 'string' ? issue.message : '' }];
  });
}
