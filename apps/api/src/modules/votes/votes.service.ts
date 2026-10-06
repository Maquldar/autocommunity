import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma, UserVote } from '@prisma/client';
import {
  VOTE_LIMITS,
  VOTE_REASONS,
  voteWeight,
  type CreateVoteInput,
  type MyVoteDto,
  type VoteEligibility,
  type VoteReason,
  type VoteReceivedPayload,
  type VoteSummaryDto,
  type VoteValue,
} from '@autoc/shared';
import { ApiException, Errors } from '../../common/errors/api-exception';
import { newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AntifraudService } from '../antifraud/antifraud.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RatingService } from '../rating/rating.service';

const DAY_MS = 24 * 3600 * 1000;
const cooldownMs = VOTE_LIMITS.cooldownDays * DAY_MS;

export const toMyVote = (v: UserVote): MyVoteDto => ({
  id: v.id,
  value: v.value as VoteValue,
  reason: v.reason as VoteReason,
  comment: v.comment,
  createdAt: v.createdAt.toISOString(),
  canVoteAgainAt: new Date(v.createdAt.getTime() + cooldownMs).toISOString(),
});

type Voter = { id: string; createdAt: Date; rating: number };

/** Driver votes (API.md §9.3). Voters stay anonymous to everyone but admins. */
@Injectable()
export class VotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rating: RatingService,
    private readonly notifications: NotificationsService,
    private readonly antifraud: AntifraudService,
  ) {}

  async create(voterId: string, targetId: string, input: CreateVoteInput, now = new Date()): Promise<MyVoteDto> {
    if (voterId === targetId) throw Errors.badRequest('INVALID_TARGET', "You can't vote for yourself");
    await this.requireVisibleTarget(targetId);
    const voter = await this.prisma.user.findUniqueOrThrow({ where: { id: voterId }, select: { id: true, createdAt: true, rating: true } });
    this.assertVoterGates(voter, now);

    const vote = await this.prisma.$transaction(async (tx) => {
      // One voter at a time: the pair cooldown and the daily limit are checked and written atomically.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`vote:${voterId}`}))`;
      const recent = await tx.userVote.findFirst({
        where: { voterId, targetId, createdAt: { gt: new Date(now.getTime() - cooldownMs) } },
        orderBy: { createdAt: 'desc' },
      });
      if (recent) {
        const again = recent.createdAt.getTime() + cooldownMs;
        throw Errors.conflict('ALREADY_VOTED', 'You already voted for this driver recently', {
          canVoteAgainAt: new Date(again).toISOString(),
          retryAfterSec: Math.ceil((again - now.getTime()) / 1000),
        });
      }
      const today = await tx.userVote.findMany({
        where: { voterId, createdAt: { gt: new Date(now.getTime() - DAY_MS) } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
        take: VOTE_LIMITS.perDay,
      });
      if (today.length >= VOTE_LIMITS.perDay) throw Errors.rateLimited(Math.max(1, Math.ceil((today[0]!.createdAt.getTime() + DAY_MS - now.getTime()) / 1000)));
      const created = await tx.userVote.create({
        data: { id: newId(), voterId, targetId, value: input.value, reason: input.reason, comment: input.comment ?? null, weight: voteWeight(voter.rating), createdAt: now },
      });
      await this.rating.recompute(tx, targetId, 'vote_received', created.id, now);
      return created;
    });

    if (vote.value === -1) {
      const payload: VoteReceivedPayload = { voteId: vote.id, value: -1, reason: vote.reason as VoteReason };
      await this.notifications.create(targetId, 'vote_received', payload);
      this.antifraud.voteDown(targetId);
    }
    return toMyVote(vote);
  }

  async summary(viewerId: string, targetId: string, now = new Date()): Promise<VoteSummaryDto> {
    await this.requireVisibleTarget(targetId, viewerId);
    const [groups, mine, viewer, today] = await Promise.all([
      this.prisma.userVote.groupBy({ by: ['value', 'reason'], where: { targetId }, _count: { _all: true } }),
      this.prisma.userVote.findFirst({
        where: { voterId: viewerId, targetId, createdAt: { gt: new Date(now.getTime() - cooldownMs) } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.findUniqueOrThrow({ where: { id: viewerId }, select: { id: true, createdAt: true, rating: true } }),
      this.prisma.userVote.count({ where: { voterId: viewerId, createdAt: { gt: new Date(now.getTime() - DAY_MS) } } }),
    ]);
    const byReason = Object.fromEntries(VOTE_REASONS.map((r) => [r, 0])) as Record<VoteReason, number>;
    let up = 0;
    let down = 0;
    for (const g of groups) {
      if (g.value === 1) up += g._count._all;
      else down += g._count._all;
      if (g.reason in byReason) byReason[g.reason as VoteReason] += g._count._all;
    }
    return { userId: targetId, up, down, byReason, myVote: mine ? toMyVote(mine) : null, eligibility: this.eligibility(viewer, targetId, !!mine, today, now) };
  }

  private eligibility(viewer: Voter, targetId: string, voted: boolean, today: number, now: Date): VoteEligibility {
    if (viewer.id === targetId) return 'self';
    if (now.getTime() - viewer.createdAt.getTime() < VOTE_LIMITS.voterMinAccountAgeDays * DAY_MS) return 'account_too_new';
    if (viewer.rating < VOTE_LIMITS.voterMinRating) return 'rating_too_low';
    if (voted) return 'already_voted';
    if (today >= VOTE_LIMITS.perDay) return 'daily_limit';
    return 'ok';
  }

  private assertVoterGates(voter: Voter, now: Date): void {
    const minAgeMs = VOTE_LIMITS.voterMinAccountAgeDays * DAY_MS;
    const ageMs = now.getTime() - voter.createdAt.getTime();
    if (ageMs < minAgeMs) {
      throw new ApiException(HttpStatus.FORBIDDEN, 'ACCOUNT_TOO_NEW', 'Your account is too new to vote', {
        minDays: VOTE_LIMITS.voterMinAccountAgeDays,
        retryAfterSec: Math.ceil((minAgeMs - ageMs) / 1000),
      });
    }
    if (voter.rating < VOTE_LIMITS.voterMinRating) {
      throw new ApiException(HttpStatus.FORBIDDEN, 'RATING_TOO_LOW', `Your rating must be at least ${VOTE_LIMITS.voterMinRating}`, { min: VOTE_LIMITS.voterMinRating });
    }
  }

  /** Same visibility as GET /users/:id (deleted / un-onboarded → 404, self excepted). */
  private async requireVisibleTarget(targetId: string, viewerId?: string): Promise<void> {
    const u = await this.prisma.user.findUnique({ where: { id: targetId }, select: { status: true, onboardedAt: true } });
    if (!u || (targetId !== viewerId && (u.status === 'deleted' || !u.onboardedAt))) throw Errors.notFound('User not found');
  }

  /** Admin: deletes a vote and recomputes its target (inside the caller's transaction). */
  async removeTx(tx: Prisma.TransactionClient, voteId: string): Promise<UserVote> {
    const vote = await tx.userVote.findUnique({ where: { id: voteId } });
    if (!vote) throw Errors.notFound('Vote not found');
    await tx.userVote.delete({ where: { id: voteId } });
    await this.rating.recompute(tx, vote.targetId, 'recalc', vote.id);
    return vote;
  }
}
