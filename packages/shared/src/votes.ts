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

/**
 * Reasons by sign. Phase 9 had the first three of each; Phase 10 added the specific driving ones
 * (API.md §10.2). The order is the order the vote dialog offers them in.
 */
export const VOTE_POSITIVE_REASONS = ['helped_on_road', 'polite', 'good_driver', 'lets_merge', 'careful_driver', 'signals_properly'] as const;
export const VOTE_NEGATIVE_REASONS = [
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
] as const;
export const VOTE_REASONS = [...VOTE_POSITIVE_REASONS, ...VOTE_NEGATIVE_REASONS, 'other'] as const;
export type VoteReason = (typeof VOTE_REASONS)[number];
export type VoteValue = 1 | -1;

/** The sign each reason goes with: +1, −1, or 0 for `other` (either). */
export const VOTE_REASON_SIGN: Record<VoteReason, VoteValue | 0> = Object.fromEntries([
  ...VOTE_POSITIVE_REASONS.map((r) => [r, 1]),
  ...VOTE_NEGATIVE_REASONS.map((r) => [r, -1]),
  ['other', 0],
]) as Record<VoteReason, VoteValue | 0>;

/** Positive reasons go with +1, negative ones with −1; `other` with either. */
export function voteReasonFits(value: VoteValue, reason: VoteReason): boolean {
  const sign = VOTE_REASON_SIGN[reason];
  return sign === 0 || sign === value;
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

/* Phase 10 — "what people say": the reasons that make up a notable share of a driver's recent votes. */

export const VOTE_TRAIT_RULES = {
  /** Only votes of the last this many days count (the same window as the rating). */
  windowDays: 180,
  /** No traits at all until this many different voters voted in the window (one hater can't label anyone). */
  minVoters: 3,
  /** A reason needs at least this many different voters… */
  minCount: 2,
  /** …and at least this share of the voters of its sign. */
  minShare: 0.25,
  /** At most this many traits per sign. */
  maxPerSign: 3,
} as const;

export type VoteTrait = { reason: VoteReason; count: number };
/** Sorted by count (desc), then by reason order. Carries no voter. */
export type VoteTraitsDto = { negative: VoteTrait[]; positive: VoteTrait[] };

/** Distinct-voter counts over the trait window (input of `computeVoteTraits`). */
export type VoteTraitCounts = {
  /** Different voters in the window. */
  voters: number;
  upVoters: number;
  downVoters: number;
  /** Different voters per (value, reason). */
  reasons: { value: VoteValue; reason: VoteReason; voters: number }[];
};

/**
 * Traits from distinct-voter counts: nothing below `minVoters`; otherwise every signed reason (not `other`)
 * with ≥ `minCount` voters that is ≥ `minShare` of the voters of its sign, top `maxPerSign` per sign.
 * Counts are of different voters, so a voter who voted again after the cooldown counts once.
 */
export function computeVoteTraits(counts: VoteTraitCounts, rules: typeof VOTE_TRAIT_RULES = VOTE_TRAIT_RULES): VoteTraitsDto {
  const empty: VoteTraitsDto = { negative: [], positive: [] };
  if (counts.voters < rules.minVoters) return empty;
  const pick = (value: VoteValue, signVoters: number): VoteTrait[] => {
    if (signVoters <= 0) return [];
    const byReason = new Map<VoteReason, number>();
    for (const r of counts.reasons) {
      if (r.value !== value || VOTE_REASON_SIGN[r.reason] !== value) continue;
      byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + r.voters);
    }
    return [...byReason]
      .filter(([, n]) => n >= rules.minCount && n / signVoters >= rules.minShare)
      .sort(([ra, a], [rb, b]) => b - a || VOTE_REASONS.indexOf(ra) - VOTE_REASONS.indexOf(rb))
      .slice(0, rules.maxPerSign)
      .map(([reason, count]) => ({ reason, count }));
  };
  return { negative: pick(-1, counts.downVoters), positive: pick(1, counts.upVoters) };
}

export type VoteSummaryDto = {
  userId: string;
  /** All-time counts. */
  up: number;
  down: number;
  byReason: Record<VoteReason, number>;
  /** The caller's vote of the last 30 days, or null. */
  myVote: MyVoteDto | null;
  eligibility: VoteEligibility;
  /** Phase 10: what other drivers often say (last 180 days, distinct voters; see VOTE_TRAIT_RULES). */
  traits: VoteTraitsDto;
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
