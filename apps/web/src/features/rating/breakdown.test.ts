import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { reasonsFor, reportError } from '@/features/reports/reasons';
import { breakdownRows, formatPoints, unlocks } from './breakdown';
import { reviewErrorKey } from './review-sheet';

describe('breakdownRows', () => {
  it('orders components and fills bars relative to their caps', () => {
    const rows = breakdownRows({ base: 50, help: 12.5, reviews: -7.5, activity: 5, tenure: 0, votes: 0, penalties: -10 });
    expect(rows.map((r) => r.key)).toEqual(['base', 'help', 'reviews', 'activity', 'tenure', 'votes', 'penalties']);
    expect(rows.find((r) => r.key === 'help')).toMatchObject({ fill: 0.5, sign: 'positive' });
    expect(rows.find((r) => r.key === 'reviews')).toMatchObject({ fill: 0.5, sign: 'negative' });
    expect(rows.find((r) => r.key === 'tenure')).toMatchObject({ fill: 0, sign: 'zero' });
    expect(rows.find((r) => r.key === 'penalties')).toMatchObject({ fill: 0.1, sign: 'negative' });
  });
  it('formats signed points', () => {
    expect(formatPoints(3.24)).toBe('+3.2');
    expect(formatPoints(-10)).toBe('−10');
    expect(formatPoints(0.01)).toBe('0');
    expect(formatPoints(1.5, 'ru')).toBe('+1,5');
  });
  it('lists what the rating unlocks', () => {
    const nextThresholds = { sosCreate: 20, sosHelp: 30 };
    expect(unlocks({ rating: 25, nextThresholds }).map((u) => u.unlocked)).toEqual([true, false]);
    expect(unlocks({ rating: 30, nextThresholds }).map((u) => u.unlocked)).toEqual([true, true]);
  });
});

describe('reports and reviews errors', () => {
  it('offers fake_sos only for SOS, first', () => {
    expect(reasonsFor('sos')[0]).toBe('fake_sos');
    expect(reasonsFor('user')).not.toContain('fake_sos');
    expect(reasonsFor('message')).toHaveLength(6);
  });
  it('maps report errors', () => {
    expect(reportError(new ApiError({ status: 409, code: 'ALREADY_REPORTED', message: '' }))).toEqual({ key: 'alreadyReported' });
    expect(reportError(new ApiError({ status: 429, code: 'RATE_LIMITED', message: '', details: { retryAfterSec: 90 } }))).toEqual({ key: 'rateLimited', minutes: 2 });
    expect(reportError(new ApiError({ status: 429, code: 'RATE_LIMITED', message: '' }))).toEqual({ key: 'rateLimitedShort' });
    expect(reportError(new ApiError({ status: 400, code: 'INVALID_TARGET', message: '' }))).toEqual({ key: 'invalidTarget' });
    expect(reportError(new ApiError({ status: 500, code: 'INTERNAL', message: '' }))).toBeNull();
  });
  it('maps review errors', () => {
    expect(reviewErrorKey(new ApiError({ status: 409, code: 'ALREADY_REVIEWED', message: '' }))).toBe('alreadyReviewed');
    expect(reviewErrorKey(new ApiError({ status: 409, code: 'REVIEW_WINDOW_CLOSED', message: '' }))).toBe('windowClosed');
    expect(reviewErrorKey(new ApiError({ status: 403, code: 'REVIEW_NOT_ALLOWED', message: '' }))).toBe('notAllowed');
    expect(reviewErrorKey(new Error('x'))).toBeNull();
  });
});
