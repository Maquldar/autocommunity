import { describe, expect, it } from 'vitest';
import { ApiError, getAttemptsLeft, getRetryAfterSec, getValidationIssues, parseApiError } from './errors';

const response = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('parseApiError', () => {
  it('reads code, message and details from the API error shape', async () => {
    const error = await parseApiError(
      response(409, JSON.stringify({ error: { code: 'NICKNAME_TAKEN', message: 'This nickname is already taken' } })),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'NICKNAME_TAKEN', message: 'This nickname is already taken' });
  });

  it('falls back to a code derived from the status when the body is not JSON', async () => {
    expect(await parseApiError(response(413, '<html>Too large</html>'))).toMatchObject({ code: 'FILE_TOO_LARGE', status: 413 });
    expect(await parseApiError(response(502, ''))).toMatchObject({ code: 'INTERNAL', status: 502 });
  });

  it('uses Retry-After when a 429 body has no retryAfterSec', async () => {
    const error = await parseApiError(response(429, JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Slow down' } }), { 'Retry-After': '42' }));
    expect(getRetryAfterSec(error)).toBe(42);
  });

  it('keeps retryAfterSec and attemptsLeft from details', async () => {
    const limited = await parseApiError(
      response(429, JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'x', details: { retryAfterSec: 17 } } }), { 'Retry-After': '99' }),
    );
    expect(getRetryAfterSec(limited)).toBe(17);
    const otp = await parseApiError(response(400, JSON.stringify({ error: { code: 'OTP_INVALID', message: 'x', details: { attemptsLeft: 3 } } })));
    expect(getAttemptsLeft(otp)).toBe(3);
  });

  it('exposes server validation issues', async () => {
    const error = await parseApiError(
      response(400, JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'Invalid', details: [{ path: ['nickname'], message: 'bad', code: 'x' }, 'junk'] } })),
    );
    expect(getValidationIssues(error)).toEqual([{ path: ['nickname'], message: 'bad' }]);
  });
});
