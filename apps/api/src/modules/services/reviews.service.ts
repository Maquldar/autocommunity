import { Injectable } from '@nestjs/common';
import { SERVICE_LIMITS, type Paginated, type ServiceReviewDto, type VisitMethod } from '@autoc/shared';
import type { z } from 'zod';
import type { createServiceReviewSchema } from '@autoc/shared';
import type { AuthUser } from '../../common/auth/decorators';
import { Errors } from '../../common/errors/api-exception';
import { newId } from '../../common/ids';
import { decodeCursor, keysetOrderBy, keysetWhere, splitPage } from '../../common/pagination/cursor';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RateLimiterService } from '../../infra/rate-limit/rate-limiter.service';
import { UserViewService, userViewInclude } from '../users/user-view.service';
import { lockService, recomputeServiceStats } from './service-rating';
import { ServicesService } from './services.service';

type ReviewInput = z.output<typeof createServiceReviewSchema>;

const visitRequired = () => Errors.forbidden('A verified visit of yours that has no review yet is required', 'VISIT_REQUIRED');

@Injectable()
export class ServiceReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly services: ServicesService,
    private readonly view: UserViewService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async list(viewer: AuthUser, serviceId: string, cursor: string | undefined, limit: number): Promise<Paginated<ServiceReviewDto>> {
    await this.services.requireVisible(viewer, serviceId);
    const after = decodeCursor(cursor);
    const rows = await this.prisma.review.findMany({
      where: { targetType: 'service', targetId: serviceId, ...keysetWhere(after) },
      orderBy: keysetOrderBy,
      take: limit + 1,
      include: { author: { include: userViewInclude } },
    });
    const { rows: page, nextCursor } = splitPage(rows, limit);
    const visits = await this.prisma.serviceVisit.findMany({
      where: { id: { in: page.map((r) => r.refId) } },
      select: { id: true, method: true },
    });
    const methods = new Map(visits.map((v) => [v.id, v.method]));
    return {
      items: page.map((r) => ({
        id: r.id,
        author: this.view.toMini(r.author),
        stars: r.stars,
        comment: r.comment,
        visitMethod: methods.get(r.refId) ?? 'geo',
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor,
    };
  }

  async create(viewer: AuthUser, serviceId: string, input: ReviewInput): Promise<ServiceReviewDto> {
    await this.rateLimiter.consumeOrThrow([
      { key: `svc:review:${viewer.id}`, limit: SERVICE_LIMITS.reviewsPerDay, windowSec: 86_400 },
    ]);
    const { reviewId, method } = await this.prisma.$transaction(async (tx) => {
      const service = await lockService(tx, serviceId);
      if (!service || service.status !== 'verified') throw Errors.notFound('Service not found');

      const visit = await tx.serviceVisit.findUnique({ where: { id: input.visitId } });
      if (!visit || visit.userId !== viewer.id || visit.serviceId !== serviceId || visit.status !== 'verified') {
        throw visitRequired();
      }
      const used = await tx.review.findFirst({ where: { targetType: 'service', targetId: serviceId, refId: visit.id }, select: { id: true } });
      if (used) throw visitRequired();

      const since = new Date(Date.now() - SERVICE_LIMITS.reviewCooldownDays * 86_400_000);
      const recent = await tx.review.findFirst({
        where: { authorId: viewer.id, targetType: 'service', targetId: serviceId, createdAt: { gt: since } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      if (recent) {
        const availableAt = new Date(recent.createdAt.getTime() + SERVICE_LIMITS.reviewCooldownDays * 86_400_000);
        throw Errors.conflict('REVIEW_COOLDOWN', 'You can review this service once per 30 days', { availableAt: availableAt.toISOString() });
      }

      const review = await tx.review.create({
        data: {
          id: newId(),
          authorId: viewer.id,
          targetType: 'service',
          targetId: serviceId,
          refId: visit.id,
          stars: input.stars,
          comment: input.comment,
        },
      });
      await recomputeServiceStats(tx, serviceId);
      return { reviewId: review.id, method: visit.method as VisitMethod };
    });

    const review = await this.prisma.review.findUniqueOrThrow({
      where: { id: reviewId },
      include: { author: { include: userViewInclude } },
    });
    return {
      id: review.id,
      author: this.view.toMini(review.author),
      stars: review.stars,
      comment: review.comment,
      visitMethod: method,
      createdAt: review.createdAt.toISOString(),
    };
  }
}
