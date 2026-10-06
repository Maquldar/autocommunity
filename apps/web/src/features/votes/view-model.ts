import {
  VOTE_LIMITS,
  VOTE_NEGATIVE_REASONS,
  VOTE_POSITIVE_REASONS,
  type MyVoteDto,
  type VoteEligibility,
  type VoteReason,
  type VoteSummaryDto,
  type VoteValue,
} from '@autoc/shared';
import { getRetryAfterSec, isApiError, numberDetail, stringDetail } from '@/lib/api/errors';

const DAY_MS = 24 * 3600 * 1000;

/** Reasons offered for a thumbs up / down (positive or negative ones, then `other`). */
export function reasonsFor(value: VoteValue): VoteReason[] {
  return value === 1 ? [...VOTE_POSITIVE_REASONS, 'other'] : [...VOTE_NEGATIVE_REASONS, 'other'];
}

/** Whole days until `iso` (at least 1 while it is in the future, 0 once passed). */
export function daysUntil(iso: string | null | undefined, now = Date.now()): number {
  if (!iso) return 0;
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.max(1, Math.ceil(ms / DAY_MS));
}

export type VoteNotice =
  | { key: 'self' }
  | { key: 'accountTooNew'; values: { days: number } }
  | { key: 'ratingTooLow'; values: { min: number } }
  | { key: 'alreadyVoted'; values: { days: number } }
  | { key: 'dailyLimit' };

/** What to tell the viewer instead of the vote buttons (null → show the buttons). */
export function voteNotice(summary: Pick<VoteSummaryDto, 'eligibility' | 'myVote'>, now = Date.now()): VoteNotice | null {
  switch (summary.eligibility) {
    case 'ok':
      return null;
    case 'self':
      return { key: 'self' };
    case 'account_too_new':
      return { key: 'accountTooNew', values: { days: VOTE_LIMITS.voterMinAccountAgeDays } };
    case 'rating_too_low':
      return { key: 'ratingTooLow', values: { min: VOTE_LIMITS.voterMinRating } };
    case 'already_voted':
      return { key: 'alreadyVoted', values: { days: Math.max(1, daysUntil(summary.myVote?.canVoteAgainAt, now)) } };
    case 'daily_limit':
      return { key: 'dailyLimit' };
    default:
      return null;
  }
}

/** Errors of POST /users/:id/votes → `votes.errors.*` (null → the shared mapping). */
export type VoteErrorKey = 'alreadyVoted' | 'accountTooNew' | 'accountTooNewIn' | 'ratingTooLow' | 'dailyLimit' | 'self' | 'reasonMismatch';

export function voteError(error: unknown, now = Date.now()): { key: VoteErrorKey; values?: Record<string, number> } | null {
  if (!isApiError(error)) return null;
  switch (error.code) {
    case 'ALREADY_VOTED': {
      const at = stringDetail(error, 'canVoteAgainAt');
      const sec = getRetryAfterSec(error);
      const days = at ? daysUntil(at, now) : sec !== null ? Math.max(1, Math.ceil(sec / 86_400)) : VOTE_LIMITS.cooldownDays;
      return { key: 'alreadyVoted', values: { days: Math.max(1, days) } };
    }
    case 'ACCOUNT_TOO_NEW': {
      const sec = getRetryAfterSec(error);
      return sec === null
        ? { key: 'accountTooNew', values: { days: numberDetail(error, 'minDays') ?? VOTE_LIMITS.voterMinAccountAgeDays } }
        : { key: 'accountTooNewIn', values: { days: Math.max(1, Math.ceil(sec / 86_400)) } };
    }
    case 'RATING_TOO_LOW':
      return { key: 'ratingTooLow', values: { min: numberDetail(error, 'min') ?? VOTE_LIMITS.voterMinRating } };
    case 'RATE_LIMITED':
      return { key: 'dailyLimit', values: { max: VOTE_LIMITS.perDay } };
    case 'INVALID_TARGET':
      return { key: 'self' };
    case 'VALIDATION_ERROR':
      return { key: 'reasonMismatch' };
    default:
      return null;
  }
}

export type ReasonChip = { reason: VoteReason; count: number; tone: 'positive' | 'negative' | 'neutral' };

/** Reasons with at least one vote, positive first, each group by count (desc). */
export function reasonChips(byReason: Partial<Record<VoteReason, number>>): ReasonChip[] {
  const tone = (r: VoteReason): ReasonChip['tone'] =>
    (VOTE_POSITIVE_REASONS as readonly string[]).includes(r) ? 'positive' : (VOTE_NEGATIVE_REASONS as readonly string[]).includes(r) ? 'negative' : 'neutral';
  const order = { positive: 0, neutral: 1, negative: 2 } as const;
  return (Object.entries(byReason) as [VoteReason, number][])
    .filter(([, count]) => typeof count === 'number' && count > 0)
    .map(([reason, count]) => ({ reason, count, tone: tone(reason) }))
    .sort((a, b) => order[a.tone] - order[b.tone] || b.count - a.count);
}

/** Share of upvotes 0..1 (null without votes). */
export function upShare(summary: Pick<VoteSummaryDto, 'up' | 'down'>): number | null {
  const total = summary.up + summary.down;
  return total === 0 ? null : summary.up / total;
}

export type { MyVoteDto, VoteEligibility };
