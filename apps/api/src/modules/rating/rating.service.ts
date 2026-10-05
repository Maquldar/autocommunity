import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  computeRating,
  RATING,
  RATING_PENALTIES,
  type Paginated,
  type RatingDto,
  type RatingEventDto,
  type RatingEventReason,
  type RatingPenaltyKind,
} from '@autoc/shared';
import { newId } from '../../common/ids';
import { decodeCursor, keysetOrderBy, keysetWhere, splitPage } from '../../common/pagination/cursor';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { loadRatingInput } from './rating-input';

type Tx = Prisma.TransactionClient;

@Injectable()
export class RatingService {
  private readonly logger = new Logger(RatingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recomputes the user's rating inside the caller's transaction (row-locked), updates the `users.rating`
   * cache and writes a ledger row when the rating changed. Returns the new rating.
   */
  async recompute(tx: Tx, userId: string, reason: RatingEventReason, refId: string | null = null, now = new Date()): Promise<number | null> {
    const locked = await tx.$queryRaw<{ rating: number; status: string }[]>`SELECT rating, status FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    const old = locked[0];
    if (!old || old.status === 'deleted') return null;
    const input = await loadRatingInput(tx, userId, now);
    if (!input) return null;
    const { rating } = computeRating(input, now);
    if (rating !== old.rating) {
      await tx.user.update({ where: { id: userId }, data: { rating } });
      await tx.ratingEvent.create({ data: { id: newId(), userId, delta: rating - old.rating, reason, refId, createdAt: now } });
    }
    return rating;
  }

  /**
   * Records a penalty (Phase 6: confirmed report, fake SOS) and recomputes. The ledger row carries the
   * penalty points; its `delta` is the actual rating change (it can be smaller near 0).
   */
  async applyPenalty(userId: string, kind: RatingPenaltyKind, refId: string | null, now = new Date()): Promise<number | null> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ rating: number }[]>`SELECT rating FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      if (!locked[0]) return null;
      const id = newId();
      await tx.ratingEvent.create({
        data: { id, userId, delta: 0, reason: 'penalty', refId, penaltyPoints: RATING_PENALTIES[kind], penaltyKind: kind, createdAt: now },
      });
      const input = (await loadRatingInput(tx, userId, now))!;
      const { rating } = computeRating(input, now);
      await tx.user.update({ where: { id: userId }, data: { rating } });
      await tx.ratingEvent.update({ where: { id }, data: { delta: rating - locked[0].rating } });
      return rating;
    });
  }

  /** Live breakdown. If the cache drifted (decay since the last job), it is refreshed first so both agree. */
  async get(userId: string, now = new Date()): Promise<RatingDto> {
    return this.prisma.$transaction(async (tx) => {
      const input = await loadRatingInput(tx, userId, now);
      const result = computeRating(input!, now);
      const cached = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { rating: true, status: true } });
      if (cached.rating !== result.rating && cached.status !== 'deleted') await this.recompute(tx, userId, 'recalc', null, now);
      return { ...result, nextThresholds: { sosCreate: RATING.sosCreateMin, sosHelp: RATING.sosHelpMin } };
    });
  }

  async events(userId: string, cursor: string | undefined, limit: number): Promise<Paginated<RatingEventDto>> {
    const after = decodeCursor(cursor);
    const rows = await this.prisma.ratingEvent.findMany({ where: { userId, ...keysetWhere(after) }, orderBy: keysetOrderBy, take: limit + 1 });
    const page = splitPage(rows, limit);
    return {
      items: page.rows.map((e) => ({ id: e.id, delta: e.delta, reason: e.reason as RatingEventReason, refId: e.refId, createdAt: e.createdAt.toISOString() })),
      nextCursor: page.nextCursor,
    };
  }

  /** Daily job body: every onboarded, non-deleted user, one short transaction each. Returns how many changed. */
  async recomputeAll(now = new Date()): Promise<number> {
    let changed = 0;
    let lastId: string | null = null;
    for (;;) {
      const batch: { id: string; rating: number }[] = await this.prisma.user.findMany({
        where: { status: { not: 'deleted' }, onboardedAt: { not: null }, ...(lastId ? { id: { gt: lastId } } : {}) },
        orderBy: { id: 'asc' },
        take: 500,
        select: { id: true, rating: true },
      });
      if (!batch.length) break;
      for (const u of batch) {
        try {
          const rating = await this.prisma.$transaction((tx) => this.recompute(tx, u.id, 'recalc_daily', null, now));
          if (rating !== null && rating !== u.rating) changed++;
        } catch (err) {
          this.logger.warn({ err, userId: u.id }, 'Rating recompute failed');
        }
      }
      lastId = batch[batch.length - 1]!.id;
    }
    return changed;
  }
}
