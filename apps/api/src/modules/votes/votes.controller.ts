import { Controller, Get, Post } from '@nestjs/common';
import { createVoteSchema, type CreateVoteInput, type MyVoteDto, type VoteSummaryDto } from '@autoc/shared';
import { CurrentUser, type AuthUser } from '../../common/auth/decorators';
import { IdParam, ZBody } from '../../common/validation/zod.pipe';
import { VotesService } from './votes.service';

/** API.md §9.3 */
@Controller('users')
export class VotesController {
  constructor(private readonly votes: VotesService) {}

  @Post(':id/votes')
  create(@CurrentUser() user: AuthUser, @IdParam() id: string, @ZBody(createVoteSchema) body: CreateVoteInput): Promise<MyVoteDto> {
    return this.votes.create(user.id, id, body);
  }

  @Get(':id/votes/summary')
  summary(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<VoteSummaryDto> {
    return this.votes.summary(user.id, id);
  }
}
