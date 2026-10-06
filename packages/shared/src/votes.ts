import { z } from 'zod';
import { INVISIBLE_RE, paginationQuerySchema } from './schemas';
import type { UserMini } from './types';

/* Phase 9 — driver votes (+/−). Voter identities are never public (admins see them). */

export const VOTE_LIMITS = {
  commentMax: 200,
  /** One vote per voter → target pair per this many days. */
  cooldownDays: 30,
  perDay: 20,
  voterMinAccountAgeDays: 7,
  voterMinRating: 40,
} as const;

export const VOTE_POSITIVE_REASONS = ['helped_on_road', 'polite', 'good_driver'] as const;
export const VOTE_NEGATIVE_REASONS = ['rude', 'dangerous_driving', 'scam'] as const;
export const VOTE_REASONS = [...VOTE_POSITIVE_REASONS, ...VOTE_NEGATIVE_REASONS, 'other'] as const;
export type VoteReason = (typeof VOTE_REASONS)[number];
export type VoteValue = 1 | -1;

/** Positive reasons go with +1, negative ones with −1; `other` with either. */
export function voteReasonFits(value: VoteValue, reason: VoteReason): boolean {
  if (reason === 'other') return true;
  return value === 1 ? (VOTE_POSITIVE_REASONS as readonly string[]).includes(reason) : (VOTE_NEGATIVE_REASONS as readonly string[]).includes(reason);
}

export const createVoteSchema = z
  .object({
    value: z.union([z.literal(1), z.literal(-1)]),
    reason: z.enum(VOTE_REASONS),
    comment: z
      .string()
      .trim()
      .max(VOTE_LIMITS.commentMax)
      .refine((v) => !INVISIBLE_RE.test(v), 'Contains invalid characters')
      .optional()
      .transform((v) => (v ? v : undefined)),
  })
  .refine((v) => voteReasonFits(v.value, v.reason), { path: ['reason'], message: 'This reason does not match the vote' });
export type CreateVoteInput = z.output<typeof createVoteSchema>;

/** The caller's own vote (the voter always sees their vote; the target never sees who voted). */
export type MyVoteDto = {
  id: string;
  value: VoteValue;
  reason: VoteReason;
  comment: string | null;
  createdAt: string;
  /** When the caller may vote on this user again. */
  canVoteAgainAt: string;
};

/** Why the caller can't vote right now (`ok` when they can). */
export const VOTE_ELIGIBILITY = ['ok', 'self', 'account_too_new', 'rating_too_low', 'already_voted', 'daily_limit'] as const;
export type VoteEligibility = (typeof VOTE_ELIGIBILITY)[number];

export type VoteSummaryDto = {
  userId: string;
  /** All-time counts. */
  up: number;
  down: number;
  byReason: Record<VoteReason, number>;
  /** The caller's vote of the last 30 days, or null. */
  myVote: MyVoteDto | null;
  eligibility: VoteEligibility;
};

/** Admin view: includes the voter. */
export type AdminVoteDto = {
  id: string;
  voter: UserMini;
  target: UserMini;
  value: VoteValue;
  reason: VoteReason;
  comment: string | null;
  /** The weight the vote carries in the rating (fixed at creation from the voter's rating). */
  weight: number;
  createdAt: string;
};

export const adminVotesQuerySchema = paginationQuerySchema.extend({ value: z.union([z.literal('1'), z.literal('-1')]).transform(Number).optional() });

/** `vote_received` notification (downvotes only). Carries no voter. */
export type VoteReceivedPayload = { voteId: string; value: -1; reason: VoteReason };
