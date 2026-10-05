import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { REVIEW_LIMITS, type CreateSosReviewInput, type Paginated, type ReviewDto } from '@autoc/shared';
import { Errors } from '../../common/errors/api-exception';
import { newId } from '../../common/ids';
import { decodeCursor, keysetOrderBy, keysetWhere, splitPage } from '../../common/pagination/cursor';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RatingService } from '../rating/rating.service';
import { SosBroadcastService } from '../sos/sos-broadcast.service';
import { UserViewService, userViewInclude } from '../users/user-view.service';

const notAllowed = () => Errors.forbidden('You can only review the other side of a help you took part in', 'REVIEW_NOT_ALLOWED');
const alreadyReviewed = () => Errors.conflict('ALREADY_REVIEWED', 'You have already reviewed this person for this SOS');
const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rating: RatingService,
    private readonly notifications: NotificationsService,
    private readonly userView: UserViewService,
    private readonly broadcast: SosBroadcastService,
  ) {}

  /**
   * requester → a helper whose response reached `arrived`, or such a helper → requester; SOS `closed`.
   * Checks, in order: SOS exists (404) → pair allowed (403) → not reviewed yet (409) → 14-day window (409).
   */
  async createForSos(authorId: string, sosId: string, input: CreateSosReviewInput): Promise<ReviewDto> {
    const sos = await this.prisma.sosRequest.findUnique({
      where: { id: sosId },
      select: { userId: true, status: true, closedAt: true, responses: { where: { status: 'arrived' }, select: { helperId: true } } },
    });
    if (!sos) throw Errors.notFound('SOS not found');
    const arrived = new Set(sos.responses.map((r) => r.helperId));
    const pairOk =
      sos.status === 'closed' &&
      input.targetUserId !== authorId &&
      ((authorId === sos.userId && arrived.has(input.targetUserId)) || (arrived.has(authorId) && input.targetUserId === sos.userId));
    if (!pairOk) throw notAllowed();
    const existing = await this.prisma.review.count({ where: { authorId, targetType: 'user', targetId: input.targetUserId, refId: sosId } });
    if (existing) throw alreadyReviewed();
    if (!sos.closedAt || Date.now() - sos.closedAt.getTime() > REVIEW_LIMITS.windowDays * 24 * 3600 * 1000) {
      throw Errors.conflict('REVIEW_WINDOW_CLOSED', `Reviews can be left within ${REVIEW_LIMITS.windowDays} days after the SOS closed`);
    }
    let review;
    try {
      review = await this.prisma.$transaction(async (tx) => {
        const row = await tx.review.create({
          data: { id: newId(), authorId, targetType: 'user', targetId: input.targetUserId, refId: sosId, stars: input.stars, comment: input.comment ?? null },
        });
        await this.rating.recompute(tx, input.targetUserId, 'review_received', row.id);
        return row;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw alreadyReviewed();
      throw err;
    }
    const author = this.userView.toMini(await this.prisma.user.findUniqueOrThrow({ where: { id: authorId }, include: userViewInclude }));
    await this.notifications.create(input.targetUserId, 'review_received', { reviewId: review.id, sosId, stars: review.stars, author });
    this.broadcast.update(sosId); // canReview / reviewTargets changed
    return { id: review.id, author, stars: review.stars, comment: review.comment, refType: 'sos', createdAt: review.createdAt.toISOString() };
  }

  /** Reviews received by a user, newest first; same visibility as the profile. */
  async listForUser(viewerId: string, userId: string, cursor: string | undefined, limit: number): Promise<Paginated<ReviewDto>> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true, onboardedAt: true } });
    if (!user || (userId !== viewerId && (user.status === 'deleted' || !user.onboardedAt))) throw Errors.notFound('User not found');
    const after = decodeCursor(cursor);
    const rows = await this.prisma.review.findMany({
      where: { targetType: 'user', targetId: userId, ...keysetWhere(after) },
      orderBy: keysetOrderBy,
      take: limit + 1,
      include: { author: { include: userViewInclude } },
    });
    const page = splitPage(rows, limit);
    return {
      items: page.rows.map((r) => ({
        id: r.id,
        author: this.userView.toMini(r.author),
        stars: r.stars,
        comment: r.comment,
        refType: 'sos' as const,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }
}
