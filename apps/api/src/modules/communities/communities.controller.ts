import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  communitiesQuerySchema,
  communityMembersQuerySchema,
  createCommunitySchema,
  updateCommunitySchema,
  updateMemberRoleSchema,
  type CommunitiesQuery,
  type CommunityDto,
  type CommunityMemberDto,
  type CreateCommunityInput,
  type MembershipStatus,
  type Paginated,
  type UpdateCommunityInput,
} from '@autoc/shared';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../common/auth/decorators';
import { IdParam, ZBody, ZQuery } from '../../common/validation/zod.pipe';
import { CommunitiesService } from './communities.service';

@Controller('communities')
export class CommunitiesController {
  constructor(private readonly communities: CommunitiesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @ZQuery(communitiesQuerySchema) query: CommunitiesQuery): Promise<Paginated<CommunityDto>> {
    return this.communities.list(user.id, query);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @ZBody(createCommunitySchema) body: CreateCommunityInput): Promise<CommunityDto> {
    return this.communities.create(user.id, body);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<CommunityDto> {
    return this.communities.get(user.id, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @IdParam() id: string, @ZBody(updateCommunitySchema) body: UpdateCommunityInput): Promise<CommunityDto> {
    return this.communities.update(user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<void> {
    return this.communities.remove(user.id, id);
  }

  @Post(':id/join')
  @HttpCode(200)
  join(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<{ status: MembershipStatus }> {
    return this.communities.join(user.id, id);
  }

  @Post(':id/leave')
  @HttpCode(204)
  leave(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<void> {
    return this.communities.leave(user.id, id);
  }

  @Get(':id/members')
  members(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @ZQuery(communityMembersQuerySchema) q: z.output<typeof communityMembersQuerySchema>,
  ): Promise<Paginated<CommunityMemberDto>> {
    return this.communities.members(user.id, id, q.status, q.cursor, q.limit);
  }

  @Post(':id/requests/:userId/approve')
  @HttpCode(204)
  approve(@CurrentUser() user: AuthUser, @IdParam() id: string, @IdParam('userId') userId: string): Promise<void> {
    return this.communities.approve(user.id, id, userId);
  }

  @Post(':id/requests/:userId/reject')
  @HttpCode(204)
  reject(@CurrentUser() user: AuthUser, @IdParam() id: string, @IdParam('userId') userId: string): Promise<void> {
    return this.communities.reject(user.id, id, userId);
  }

  @Patch(':id/members/:userId')
  @HttpCode(204)
  setRole(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @IdParam('userId') userId: string,
    @ZBody(updateMemberRoleSchema) body: z.output<typeof updateMemberRoleSchema>,
  ): Promise<void> {
    return this.communities.setRole(user.id, id, userId, body.role);
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  removeMember(@CurrentUser() user: AuthUser, @IdParam() id: string, @IdParam('userId') userId: string): Promise<void> {
    return this.communities.removeMember(user.id, id, userId);
  }
}
