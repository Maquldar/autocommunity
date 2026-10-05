import { Controller, Get, Post } from '@nestjs/common';
import { createSosReviewSchema, paginationQuerySchema, type CreateSosReviewInput, type Paginated, type ReviewDto } from '@autoc/shared';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../common/auth/decorators';
import { IdParam, ZBody, ZQuery } from '../../common/validation/zod.pipe';
import { ReviewsService } from './reviews.service';

@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post('sos/:id/reviews')
  create(@CurrentUser() user: AuthUser, @IdParam() id: string, @ZBody(createSosReviewSchema) body: CreateSosReviewInput): Promise<ReviewDto> {
    return this.reviews.createForSos(user.id, id, body);
  }

  @Get('users/:id/reviews')
  list(@CurrentUser() user: AuthUser, @IdParam() id: string, @ZQuery(paginationQuerySchema) q: z.output<typeof paginationQuerySchema>): Promise<Paginated<ReviewDto>> {
    return this.reviews.listForUser(user.id, id, q.cursor, q.limit);
  }
}
