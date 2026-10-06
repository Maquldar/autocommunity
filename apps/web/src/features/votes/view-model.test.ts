import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { daysUntil, reasonChips, reasonsFor, upShare, voteError, voteNotice } from './view-model';

const DAY = 86_400_000;
const now = Date.parse('2026-10-06T12:00:00Z');
const err = (code: string, status = 409, details?: unknown) => new ApiError({ status, code, message: code, details });

describe('votes view-model', () => {
  it('filters reasons by sign, `other` for both', () => {
    expect(reasonsFor(1)).toEqual(['helped_on_road', 'polite', 'good_driver', 'lets_merge', 'careful_driver', 'signals_properly', 'other']);
    expect(reasonsFor(-1)).toEqual([
      'rude',
      'dangerous_driving',
      'scam',
      'cuts_off',
      'no_turn_signals',
      'speeding',
      'tailgating',
      'bad_parking',
      'aggressive',
      'phone_while_driving',
      'other',
    ]);
  });
  it('counts whole days until a date', () => {
    expect(daysUntil(new Date(now + 29.2 * DAY).toISOString(), now)).toBe(30);
    expect(daysUntil(new Date(now + 1000).toISOString(), now)).toBe(1);
    expect(daysUntil(new Date(now - 1000).toISOString(), now)).toBe(0);
    expect(daysUntil(null, now)).toBe(0);
  });
  it('explains why the buttons are hidden', () => {
    const myVote = { id: 'v', value: 1 as const, reason: 'polite' as const, comment: null, createdAt: '', canVoteAgainAt: new Date(now + 3 * DAY).toISOString() };
    expect(voteNotice({ eligibility: 'ok', myVote: null }, now)).toBeNull();
    expect(voteNotice({ eligibility: 'self', myVote: null }, now)).toEqual({ key: 'self' });
    expect(voteNotice({ eligibility: 'account_too_new', myVote: null }, now)).toEqual({ key: 'accountTooNew', values: { days: 7 } });
    expect(voteNotice({ eligibility: 'rating_too_low', myVote: null }, now)).toEqual({ key: 'ratingTooLow', values: { min: 40 } });
    expect(voteNotice({ eligibility: 'already_voted', myVote }, now)).toEqual({ key: 'alreadyVoted', values: { days: 3 } });
    expect(voteNotice({ eligibility: 'daily_limit', myVote: null }, now)).toEqual({ key: 'dailyLimit' });
  });
  it('maps vote errors', () => {
    expect(voteError(err('ALREADY_VOTED', 409, { canVoteAgainAt: new Date(now + 10 * DAY).toISOString(), retryAfterSec: 864000 }), now)).toEqual({ key: 'alreadyVoted', values: { days: 10 } });
    expect(voteError(err('ALREADY_VOTED'), now)).toEqual({ key: 'alreadyVoted', values: { days: 30 } });
    expect(voteError(err('ACCOUNT_TOO_NEW', 403, { minDays: 7, retryAfterSec: 2 * 86400 }))).toEqual({ key: 'accountTooNewIn', values: { days: 2 } });
    expect(voteError(err('ACCOUNT_TOO_NEW', 403, { minDays: 7 }))).toEqual({ key: 'accountTooNew', values: { days: 7 } });
    expect(voteError(err('RATING_TOO_LOW', 403, { min: 40 }))).toEqual({ key: 'ratingTooLow', values: { min: 40 } });
    expect(voteError(err('RATE_LIMITED', 429))).toEqual({ key: 'dailyLimit', values: { max: 20 } });
    expect(voteError(err('INVALID_TARGET', 400))).toEqual({ key: 'self' });
    expect(voteError(err('VALIDATION_ERROR', 400))).toEqual({ key: 'reasonMismatch' });
    expect(voteError(err('INTERNAL', 500))).toBeNull();
  });
  it('builds reason chips (positive first, by count) and the up share', () => {
    const chips = reasonChips({ helped_on_road: 1, polite: 3, good_driver: 0, rude: 2, dangerous_driving: 0, scam: 0, other: 1 });
    expect(chips.map((c) => [c.reason, c.count, c.tone])).toEqual([
      ['polite', 3, 'positive'],
      ['helped_on_road', 1, 'positive'],
      ['other', 1, 'neutral'],
      ['rude', 2, 'negative'],
    ]);
    expect(upShare({ up: 3, down: 1 })).toBe(0.75);
    expect(upShare({ up: 0, down: 0 })).toBeNull();
  });
});
