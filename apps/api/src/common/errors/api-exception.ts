import { HttpException, HttpStatus } from '@nestjs/common';

/** Error with a stable machine-readable `code`; rendered as `{ error: { code, message, details? } }`. */
export class ApiException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message, status);
  }
}

export const Errors = {
  validation: (message: string, details?: unknown) =>
    new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', message, details),
  badRequest: (code: string, message: string, details?: unknown) =>
    new ApiException(HttpStatus.BAD_REQUEST, code, message, details),
  unauthorized: (message = 'Authentication required', code = 'UNAUTHORIZED') =>
    new ApiException(HttpStatus.UNAUTHORIZED, code, message),
  forbidden: (message = 'Forbidden', code = 'FORBIDDEN') => new ApiException(HttpStatus.FORBIDDEN, code, message),
  accountBlocked: () => new ApiException(HttpStatus.FORBIDDEN, 'ACCOUNT_BLOCKED', 'This account is blocked'),
  notFound: (message = 'Not found', code = 'NOT_FOUND') => new ApiException(HttpStatus.NOT_FOUND, code, message),
  conflict: (code: string, message: string, details?: unknown) =>
    new ApiException(HttpStatus.CONFLICT, code, message, details),
  rateLimited: (retryAfterSec: number) =>
    new ApiException(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', 'Too many requests, try again later', {
      retryAfterSec,
    }),
  payloadTooLarge: (message = 'File is too large') =>
    new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, 'FILE_TOO_LARGE', message),
  unsupportedMedia: (message = 'Unsupported file type') =>
    new ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'UNSUPPORTED_FILE_TYPE', message),
  unavailable: (code: string, message: string) => new ApiException(HttpStatus.SERVICE_UNAVAILABLE, code, message),
};
