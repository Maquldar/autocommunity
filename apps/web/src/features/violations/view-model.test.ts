import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { checkDisputeText, checkViolationDraft, defaultCodeType, occurredAtFromDate, showsStatus, submitEligibility, toDateInput, violationError, type ViolationDraft } from './view-model';

const DAY = 86_400_000;
const now = new Date('2026-10-06T15:00:00');
const ok: ViolationDraft = { category: 'speeding', codeType: 'koap', article: ' ст. 592 ', date: '2026-10-01', description: 'Ехал 140 в городе по Аль-Фараби', photoIds: ['00000000-0000-4000-8000-000000000001'] };
const err = (code: string, status = 403, details?: unknown) => new ApiError({ status, code, message: code, details });

describe('violations view-model', () => {
  it('turns the date input into occurredAt, never in the future', () => {
    expect(occurredAtFromDate('2026-10-01', now)).toBe(new Date(2026, 9, 1, 12).toISOString());
    expect(occurredAtFromDate('2026-10-06', new Date('2026-10-06T08:00:00'))).toBe(new Date('2026-10-06T08:00:00').toISOString());
    expect(occurredAtFromDate('', now)).toBeNull();
    expect(toDateInput(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
  it('validates with the shared schema and trims the article', () => {
    const result = checkViolationDraft(ok, now);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body).toMatchObject({ category: 'speeding', codeType: 'koap', article: 'ст. 592', photoUploadIds: ok.photoIds });
  });
  it('reports every problem with a message key', () => {
    const result = checkViolationDraft({ ...ok, category: null, description: 'short', photoIds: [], article: 'x'.repeat(61), date: '' }, now);
    expect(result).toEqual({
      ok: false,
      errors: { category: 'categoryRequired', date: 'dateRequired', description: 'descriptionShort', photos: 'photosRequired', article: 'articleLong' },
    });
    const old = checkViolationDraft({ ...ok, date: '2020-01-01' }, now);
    expect(old).toEqual({ ok: false, errors: { date: 'dateRange' } });
    const many = checkViolationDraft({ ...ok, photoIds: ['a', 'b', 'c', 'd'].map((c) => `00000000-0000-4000-8000-00000000000${c}`) }, now);
    expect(many).toEqual({ ok: false, errors: { photos: 'photosTooMany' } });
  });
  it('checks dispute text', () => {
    expect(checkDisputeText('too short')).toBe('short');
    expect(checkDisputeText('Это была не моя машина, номер перепутан')).toBeNull();
    expect(checkDisputeText('x'.repeat(1001))).toBe('long');
  });
  it('gates non-owners by account age and rating', () => {
    const me = { id: 'me', createdAt: new Date(now.getTime() - 3 * DAY).toISOString(), rating: 60 };
    expect(submitEligibility(me, 'me', now.getTime())).toEqual({ key: 'ok' });
    expect(submitEligibility(me, 'other', now.getTime())).toEqual({ key: 'accountTooNew', days: 4 });
    expect(submitEligibility({ ...me, createdAt: new Date(now.getTime() - 30 * DAY).toISOString(), rating: 39 }, 'other', now.getTime())).toEqual({ key: 'ratingTooLow', min: 40 });
    expect(submitEligibility({ ...me, createdAt: new Date(now.getTime() - 30 * DAY).toISOString() }, 'other', now.getTime())).toEqual({ key: 'ok' });
  });
  it('maps errors and defaults', () => {
    expect(violationError(err('ACCOUNT_TOO_NEW', 403, { minDays: 7, retryAfterSec: 86400 * 2 }))).toEqual({ key: 'accountTooNew', values: { days: 2 } });
    expect(violationError(err('RATING_TOO_LOW', 403, { min: 40 }))).toEqual({ key: 'ratingTooLow', values: { min: 40 } });
    expect(violationError(err('RATE_LIMITED', 429))).toEqual({ key: 'rateLimited', values: { max: 5 } });
    expect(violationError(err('ALREADY_DISPUTED', 409))).toEqual({ key: 'alreadyDisputed' });
    expect(violationError(err('VIOLATION_INVALID_STATE', 409))).toEqual({ key: 'invalidState' });
    expect(violationError(err('FORBIDDEN'))).toEqual({ key: 'notOwner' });
    expect(violationError(err('INVALID_UPLOAD', 400))).toEqual({ key: 'invalidUpload' });
    expect(violationError(err('INTERNAL', 500))).toBeNull();
    expect(defaultCodeType('drunk_driving')).toBe('uk');
    expect(defaultCodeType('parking')).toBe('koap');
    expect(showsStatus({ status: 'approved' }, false)).toBe(false);
    expect(showsStatus({ status: 'approved' }, true)).toBe(true);
    expect(showsStatus({ status: 'pending' }, false)).toBe(true);
  });
});
