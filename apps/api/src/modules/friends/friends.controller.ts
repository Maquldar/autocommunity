import { Controller, Delete, Get, HttpCode, Post, Res } from '@nestjs/common';
import {
  friendRequestSchema,
  friendRequestsQuerySchema,
  paginationQuerySchema,
  type FriendRequestDto,
  type Paginated,
  type UserPublic,
} from '@autoc/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../common/auth/decorators';
import { RequireOnboarded } from '../../common/auth/onboarded.guard';
import { IdParam, ZBody, ZQuery } from '../../common/validation/zod.pipe';
import { FriendsService, type FriendRequestResult } from './friends.service';

@Controller('friends')
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @ZQuery(paginationQuerySchema) query: z.output<typeof paginationQuerySchema>,
  ): Promise<Paginated<UserPublic>> {
    return this.friends.listFriends(user.id, query.cursor, query.limit);
  }

  @Get('requests')
  requests(
    @CurrentUser() user: AuthUser,
    @ZQuery(friendRequestsQuerySchema) query: z.output<typeof friendRequestsQuerySchema>,
  ): Promise<Paginated<FriendRequestDto>> {
    return this.friends.listRequests(user.id, query.direction, query.cursor, query.limit);
  }

  @RequireOnboarded()
  /** 201 with `pending` for a new request; 200 with `accepted` when it accepted the target's request. */
  @Post('requests')
  async send(
    @CurrentUser() user: AuthUser,
    @ZBody(friendRequestSchema) body: z.output<typeof friendRequestSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<FriendRequestResult> {
    const result = await this.friends.sendRequest(user.id, body.userId);
    res.status(result.status === 'accepted' ? 200 : 201);
    return result;
  }

  @Post('requests/:id/accept')
  @HttpCode(204)
  accept(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<void> {
    return this.friends.accept(user.id, id);
  }

  @Post('requests/:id/decline')
  @HttpCode(204)
  decline(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<void> {
    return this.friends.decline(user.id, id);
  }

  @Delete('requests/:id')
  @HttpCode(204)
  cancel(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<void> {
    return this.friends.cancel(user.id, id);
  }

  @Delete(':userId')
  @HttpCode(204)
  unfriend(@CurrentUser() user: AuthUser, @IdParam('userId') userId: string): Promise<void> {
    return this.friends.unfriend(user.id, userId);
  }
}
