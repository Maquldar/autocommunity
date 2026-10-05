import { Controller, Get } from '@nestjs/common';
import { paginationQuerySchema, type Paginated, type RatingDto, type RatingEventDto } from '@autoc/shared';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../common/auth/decorators';
import { Errors } from '../../common/errors/api-exception';
import { IdParam, ZQuery } from '../../common/validation/zod.pipe';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RatingService } from './rating.service';

@Controller('me/rating')
export class MyRatingController {
  constructor(private readonly rating: RatingService) {}

  @Get()
  get(@CurrentUser() user: AuthUser): Promise<RatingDto> {
    return this.rating.get(user.id);
  }

  @Get('events')
  events(@CurrentUser() user: AuthUser, @ZQuery(paginationQuerySchema) q: z.output<typeof paginationQuerySchema>): Promise<Paginated<RatingEventDto>> {
    return this.rating.events(user.id, q.cursor, q.limit);
  }
}

@Controller('users')
export class UserRatingController {
  constructor(
    private readonly rating: RatingService,
    private readonly prisma: PrismaService,
  ) {}

  /** Public breakdown (transparency); same visibility as the profile. The ledger stays private. */
  @Get(':id/rating')
  async get(@CurrentUser() viewer: AuthUser, @IdParam() id: string): Promise<RatingDto> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { status: true, onboardedAt: true } });
    if (!user || (id !== viewer.id && (user.status === 'deleted' || !user.onboardedAt))) throw Errors.notFound('User not found');
    return this.rating.get(id);
  }
}
