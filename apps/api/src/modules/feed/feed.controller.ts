import { Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import {
  createCommentSchema,
  createPostSchema,
  feedQuerySchema,
  paginationQuerySchema,
  pollVoteSchema,
  type CreateCommentInput,
  type CreatePostInput,
  type FeedQuery,
  type LikeResult,
  type Paginated,
  type PollDto,
  type PollVoteInput,
  type PostCommentDto,
  type PostDto,
} from '@autoc/shared';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../common/auth/decorators';
import { RequireOnboarded } from '../../common/auth/onboarded.guard';
import { IdParam, ZBody, ZQuery } from '../../common/validation/zod.pipe';
import { FeedService } from './feed.service';

@Controller('feed')
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @ZQuery(feedQuerySchema) query: FeedQuery): Promise<Paginated<PostDto>> {
    return this.feed.feed(user.id, query);
  }
}

@Controller('posts')
export class PostsController {
  constructor(private readonly feed: FeedService) {}

  @RequireOnboarded()
  @Post()
  create(@CurrentUser() user: AuthUser, @ZBody(createPostSchema) body: CreatePostInput): Promise<PostDto> {
    return this.feed.create(user.id, body);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<PostDto> {
    return this.feed.get(user.id, id, { asAdmin: user.role === 'admin' });
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<void> {
    return this.feed.remove(user.id, id);
  }

  @RequireOnboarded()
  @Post(':id/like')
  @HttpCode(200)
  like(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<LikeResult> {
    return this.feed.like(user.id, id);
  }

  @Delete(':id/like')
  @HttpCode(200)
  unlike(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<LikeResult> {
    return this.feed.unlike(user.id, id);
  }

  @Get(':id/comments')
  comments(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @ZQuery(paginationQuerySchema) q: z.output<typeof paginationQuerySchema>,
  ): Promise<Paginated<PostCommentDto>> {
    return this.feed.comments(user.id, id, q.cursor, q.limit, { asAdmin: user.role === 'admin' });
  }

  @RequireOnboarded()
  @Post(':id/comments')
  addComment(@CurrentUser() user: AuthUser, @IdParam() id: string, @ZBody(createCommentSchema) body: CreateCommentInput): Promise<PostCommentDto> {
    return this.feed.addComment(user.id, id, body);
  }

  @RequireOnboarded()
  @Post(':id/poll/vote')
  @HttpCode(200)
  vote(@CurrentUser() user: AuthUser, @IdParam() id: string, @ZBody(pollVoteSchema) body: PollVoteInput): Promise<PollDto> {
    return this.feed.vote(user.id, id, body.optionIds);
  }
}

@Controller('comments')
export class CommentsController {
  constructor(private readonly feed: FeedService) {}

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<void> {
    return this.feed.removeComment(user.id, id);
  }
}
