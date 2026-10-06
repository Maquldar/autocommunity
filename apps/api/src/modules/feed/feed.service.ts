import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  FEED_LIMITS,
  textPreview,
  type CreateCommentInput,
  type CreatePostInput,
  type FeedQuery,
  type LikeResult,
  type Paginated,
  type PollDto,
  type PostCommentDto,
  type PostDto,
  type PostNotificationPayload,
  type UploadDto,
} from '@autoc/shared';
import { Errors } from '../../common/errors/api-exception';
import { newId } from '../../common/ids';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RateLimiterService } from '../../infra/rate-limit/rate-limiter.service';
import { RedisService } from '../../infra/redis/redis.service';
import { Storage } from '../../infra/storage/storage';
import { BackgroundTasks } from '../../infra/tasks/background-tasks';
import { NotificationsService } from '../notifications/notifications.service';
import { toUploadDto } from '../uploads/upload.mapper';
import { UserViewService, userViewInclude } from '../users/user-view.service';

type Tx = Prisma.TransactionClient;

/** A visible post (visibility applied in SQL) plus the viewer's role in its community. */
type PostRow = {
  id: string;
  authorId: string;
  communityId: string | null;
  communityName: string | null;
  text: string;
  mediaUploadIds: string[];
  likeCount: number;
  commentCount: number;
  createdAt: Date;
  myRole: string | null;
};

const postNotFound = () => Errors.notFound('Post not found');
const isMod = (role: string | null | undefined) => role === 'owner' || role === 'moderator';
const invalidUpload = (message = 'Upload not found or not allowed here') => Errors.badRequest('INVALID_UPLOAD', message);

@Injectable()
export class FeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: Storage,
    private readonly redis: RedisService,
    private readonly rateLimiter: RateLimiterService,
    private readonly userView: UserViewService,
    private readonly notifications: NotificationsService,
    private readonly tasks: BackgroundTasks,
  ) {}

  /* ------------------------------------------------------------------ feed */

  /**
   * Newest first. `all` = global posts + public communities' posts + the viewer's communities' posts;
   * `communities` = the viewer's (active) communities only; `friends` = posts by friends (still subject to
   * community visibility). `communityId` / `authorId` narrow any scope.
   */
  async feed(viewerId: string, query: FeedQuery): Promise<Paginated<PostDto>> {
    if (query.communityId) await this.assertCommunityVisible(viewerId, query.communityId);
    const after = decodeCursor(query.cursor);
    const me = Prisma.sql`${viewerId}::uuid`;
    const where = Prisma.sql`
      ${query.scope === 'communities' ? Prisma.sql`AND p.community_id IS NOT NULL AND vm.user_id IS NOT NULL` : Prisma.empty}
      ${
        query.scope === 'friends'
          ? Prisma.sql`AND EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted'
              AND ((f.requester_id = ${me} AND f.addressee_id = p.author_id) OR (f.addressee_id = ${me} AND f.requester_id = p.author_id)))`
          : Prisma.empty
      }
      ${query.communityId ? Prisma.sql`AND p.community_id = ${query.communityId}::uuid` : Prisma.empty}
      ${query.authorId ? Prisma.sql`AND p.author_id = ${query.authorId}::uuid` : Prisma.empty}
      ${after ? Prisma.sql`AND (p.created_at, p.id) < (${after.createdAt}, ${after.id}::uuid)` : Prisma.empty}`;
    const rows = await this.query(viewerId, where, query.limit + 1);
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return { items: await this.toDtos(viewerId, page), nextCursor: hasMore && last ? encodeCursor(last) : null };
  }

  async get(viewerId: string, id: string): Promise<PostDto> {
    return (await this.toDtos(viewerId, [await this.requireVisible(viewerId, id)]))[0]!;
  }

  /* ------------------------------------------------------------------ posts */

  async create(userId: string, input: CreatePostInput): Promise<PostDto> {
    const communityId = input.communityId ?? null;
    if (communityId) {
      const community = await this.prisma.community.findFirst({ where: { id: communityId, deletedAt: null }, select: { id: true } });
      if (!community) throw Errors.notFound('Community not found');
      if (!(await this.activeRole(communityId, userId))) throw Errors.forbidden('Only members can post in this community');
    }
    const mediaIds = input.mediaUploadIds ?? [];
    if (mediaIds.length) await this.assertMedia(userId, mediaIds);
    await this.rateLimiter.consumeOrThrow([{ key: `feed-post:${userId}`, limit: FEED_LIMITS.postsPerDay, windowSec: 86_400 }]);

    const id = newId();
    await this.prisma.$transaction(async (tx) => {
      if (mediaIds.length) {
        // One post per upload: lock the uploads, then make sure no live or deleted post holds them.
        await tx.$queryRaw`SELECT id FROM uploads WHERE id = ANY(${mediaIds}::uuid[]) FOR UPDATE`;
        const [used] = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM posts WHERE media_upload_ids && ${mediaIds}::uuid[]`;
        if (used && used.n > 0) throw invalidUpload('This upload is already used in another post');
      }
      await tx.post.create({ data: { id, authorId: userId, communityId, text: input.text ?? '', mediaUploadIds: mediaIds } });
      if (input.poll) {
        const pollId = newId();
        await tx.poll.create({
          data: {
            id: pollId,
            postId: id,
            question: input.poll.question,
            multiple: input.poll.multiple,
            options: { create: input.poll.options.map((text, position) => ({ id: newId(), text, position })) },
          },
        });
      }
    });
    return this.get(userId, id);
  }

  /** Soft delete by the author, or by an owner/moderator of the post's community. */
  async remove(userId: string, id: string): Promise<void> {
    const post = await this.requireVisible(userId, id);
    if (post.authorId !== userId && !(post.communityId && isMod(post.myRole))) {
      throw Errors.forbidden('Only the author or a community moderator can delete this post');
    }
    await this.prisma.post.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
  }

  /* ------------------------------------------------------------------ likes */

  async like(userId: string, id: string): Promise<LikeResult> {
    const post = await this.requireVisible(userId, id);
    const inserted = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.postLike.createMany({ data: [{ postId: id, userId }], skipDuplicates: true });
      if (count) await tx.post.update({ where: { id }, data: { likeCount: { increment: 1 } } });
      return count > 0;
    });
    if (inserted && post.authorId !== userId) {
      this.tasks.run('post_like notification', () => this.notifyThrottled('post_like', post, userId, null, FEED_LIMITS.likeNotifyThrottleSec));
    }
    return this.likeState(userId, id);
  }

  async unlike(userId: string, id: string): Promise<LikeResult> {
    await this.requireVisible(userId, id);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.postLike.deleteMany({ where: { postId: id, userId } });
      if (count) await tx.post.update({ where: { id }, data: { likeCount: { decrement: count } } });
    });
    return this.likeState(userId, id);
  }

  /* ------------------------------------------------------------------ comments */

  /** Oldest first (keyset on createdAt, id). Deleted comments are left out. */
  async comments(viewerId: string, postId: string, cursor: string | undefined, limit: number): Promise<Paginated<PostCommentDto>> {
    const post = await this.requireVisible(viewerId, postId);
    const after = decodeCursor(cursor);
    const rows = await this.prisma.postComment.findMany({
      where: {
        postId,
        deletedAt: null,
        ...(after ? { OR: [{ createdAt: { gt: after.createdAt } }, { createdAt: after.createdAt, id: { gt: after.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      include: { author: { include: userViewInclude } },
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return { items: page.map((c) => this.toCommentDto(viewerId, post, c)), nextCursor: hasMore && last ? encodeCursor(last) : null };
  }

  async addComment(userId: string, postId: string, input: CreateCommentInput): Promise<PostCommentDto> {
    const post = await this.requireVisible(userId, postId);
    await this.rateLimiter.consumeOrThrow([{ key: `feed-comment:${userId}`, limit: FEED_LIMITS.commentsPerHour, windowSec: 3600 }]);
    const comment = await this.prisma.$transaction(async (tx) => {
      const c = await tx.postComment.create({ data: { id: newId(), postId, authorId: userId, text: input.text }, include: { author: { include: userViewInclude } } });
      await tx.post.update({ where: { id: postId }, data: { commentCount: { increment: 1 } } });
      return c;
    });
    if (post.authorId !== userId) {
      this.tasks.run('post_comment notification', () =>
        this.notifyThrottled('post_comment', post, userId, { id: comment.id, text: comment.text }, FEED_LIMITS.commentNotifyThrottleSec),
      );
    }
    return this.toCommentDto(userId, post, comment);
  }

  /** Soft delete by the comment author, the post author or a moderator of the post's community. */
  async removeComment(userId: string, commentId: string): Promise<void> {
    const comment = await this.prisma.postComment.findFirst({ where: { id: commentId, deletedAt: null }, select: { postId: true, authorId: true } });
    if (!comment) throw Errors.notFound('Comment not found');
    const post = await this.requireVisible(userId, comment.postId).catch(() => {
      throw Errors.notFound('Comment not found');
    });
    if (!canDeleteComment(userId, post, comment.authorId)) {
      throw Errors.forbidden('Only the comment author, the post author or a community moderator can delete this comment');
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.postComment.updateMany({ where: { id: commentId, deletedAt: null }, data: { deletedAt: new Date() } });
      if (count) await tx.post.update({ where: { id: comment.postId }, data: { commentCount: { decrement: count } } });
    });
  }

  /* ------------------------------------------------------------------ polls */

  /** Votes are final: one vote per user per poll (several options only when `multiple`). */
  async vote(userId: string, postId: string, optionIds: string[]): Promise<PollDto> {
    await this.requireVisible(userId, postId);
    const poll = await this.prisma.poll.findUnique({ where: { postId }, select: { id: true, multiple: true } });
    if (!poll) throw Errors.notFound('This post has no poll');
    if (!poll.multiple && optionIds.length > 1) {
      throw Errors.validation('This poll allows one option', [{ path: ['optionIds'], message: 'Choose one option' }]);
    }
    await this.prisma.$transaction(async (tx) => {
      // Serializes votes on this poll: the "already voted" check and the counters can't race.
      await tx.$queryRaw`SELECT id FROM polls WHERE id = ${poll.id}::uuid FOR UPDATE`;
      if (await tx.pollVote.count({ where: { pollId: poll.id, userId } })) throw Errors.conflict('ALREADY_VOTED', 'You have already voted in this poll');
      const valid = await tx.pollOption.count({ where: { pollId: poll.id, id: { in: optionIds } } });
      if (valid !== optionIds.length) throw Errors.badRequest('INVALID_OPTION', 'Unknown poll option');
      await tx.pollVote.createMany({ data: optionIds.map((optionId) => ({ optionId, userId, pollId: poll.id })) });
      await tx.pollOption.updateMany({ where: { id: { in: optionIds } }, data: { voteCount: { increment: 1 } } });
      await tx.poll.update({ where: { id: poll.id }, data: { totalVoters: { increment: 1 } } });
    });
    return (await this.polls(userId, [postId])).get(postId)!;
  }

  /* ------------------------------------------------------------------ helpers */

  /** Whether the viewer may read the post (used by reports). Returns the author, or null when not visible. */
  async visibleAuthor(viewerId: string, postId: string): Promise<string | null> {
    const [row] = await this.query(viewerId, Prisma.sql`AND p.id = ${postId}::uuid`, 1);
    return row?.authorId ?? null;
  }

  /** The comment's author when the viewer may read its post (used by reports), else null. */
  async visibleCommentAuthor(viewerId: string, commentId: string): Promise<string | null> {
    const c = await this.prisma.postComment.findFirst({ where: { id: commentId, deletedAt: null }, select: { postId: true, authorId: true } });
    if (!c) return null;
    return (await this.visibleAuthor(viewerId, c.postId)) ? c.authorId : null;
  }

  private async likeState(userId: string, id: string): Promise<LikeResult> {
    const [post, mine] = await Promise.all([
      this.prisma.post.findUniqueOrThrow({ where: { id }, select: { likeCount: true } }),
      this.prisma.postLike.count({ where: { postId: id, userId } }),
    ]);
    return { likeCount: post.likeCount, likedByMe: mine > 0 };
  }

  /**
   * `post_like` / `post_comment` to the post author, at most one per post per `throttleSec` (Redis SET NX):
   * later likes / comments inside the window are collapsed into the first notification.
   */
  private async notifyThrottled(
    type: 'post_like' | 'post_comment',
    post: PostRow,
    actorId: string,
    comment: { id: string; text: string } | null,
    throttleSec: number,
  ): Promise<void> {
    const fresh = await this.redis.set(`notify:${type}:${post.id}`, actorId, 'EX', throttleSec, 'NX');
    if (fresh !== 'OK') return;
    const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: actorId }, include: userViewInclude });
    const payload: PostNotificationPayload = {
      postId: post.id,
      preview: textPreview(comment ? comment.text : post.text),
      user: this.userView.toMini(actor),
      ...(comment ? { commentId: comment.id } : {}),
    };
    await this.notifications.create(post.authorId, type, payload);
  }

  /** Every image is the caller's `post` upload (≤ 6), or there is exactly one `video` upload. */
  private async assertMedia(userId: string, ids: string[]): Promise<void> {
    const uploads = await this.prisma.upload.findMany({ where: { id: { in: ids } }, select: { id: true, ownerId: true, purpose: true } });
    if (uploads.length !== ids.length || uploads.some((u) => u.ownerId !== userId || (u.purpose !== 'post' && u.purpose !== 'video'))) {
      throw invalidUpload();
    }
    const videos = uploads.filter((u) => u.purpose === 'video').length;
    if (videos && ids.length > 1) {
      throw Errors.validation('A post has up to 6 photos or one video', [{ path: ['mediaUploadIds'], message: 'Up to 6 photos or one video' }]);
    }
  }

  private async activeRole(communityId: string, userId: string): Promise<string | null> {
    const m = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId } },
      select: { role: true, status: true },
    });
    return m?.status === 'active' ? m.role : null;
  }

  private async assertCommunityVisible(viewerId: string, communityId: string): Promise<void> {
    const c = await this.prisma.community.findFirst({ where: { id: communityId, deletedAt: null }, select: { isPrivate: true } });
    if (!c) throw Errors.notFound('Community not found');
    if (c.isPrivate && !(await this.activeRole(communityId, viewerId))) {
      throw Errors.forbidden('Posts of a private community are visible to its members only');
    }
  }

  private async requireVisible(viewerId: string, id: string, db: Tx = this.prisma): Promise<PostRow> {
    const [row] = await this.query(viewerId, Prisma.sql`AND p.id = ${id}::uuid`, 1, db);
    if (!row) throw postNotFound();
    return row;
  }

  /**
   * Visible, non-deleted posts newest first: global ones, public communities' ones and those of the
   * viewer's active communities (live communities only; deleted authors' posts are hidden).
   */
  private query(viewerId: string, where: Prisma.Sql, limit: number, db: Tx = this.prisma): Promise<PostRow[]> {
    const me = Prisma.sql`${viewerId}::uuid`;
    return db.$queryRaw<PostRow[]>`
      SELECT p.id, p.author_id AS "authorId", p.community_id AS "communityId", c.name AS "communityName", p.text,
             p.media_upload_ids::text[] AS "mediaUploadIds", p.like_count AS "likeCount", p.comment_count AS "commentCount",
             p.created_at AS "createdAt", vm.role::text AS "myRole"
      FROM posts p
      JOIN users a ON a.id = p.author_id
      LEFT JOIN communities c ON c.id = p.community_id
      LEFT JOIN community_members vm ON vm.community_id = p.community_id AND vm.user_id = ${me} AND vm.status = 'active'
      WHERE p.deleted_at IS NULL AND a.status <> 'deleted'
        AND (p.community_id IS NULL OR (c.deleted_at IS NULL AND (c.is_private = false OR vm.user_id IS NOT NULL)))
        ${where}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ${limit}::int`;
  }

  /** Authors, media, polls and the viewer's likes for a page: one query each. */
  private async toDtos(viewerId: string, rows: PostRow[]): Promise<PostDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const mediaIds = rows.flatMap((r) => r.mediaUploadIds);
    const [authors, uploads, likes, polls] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } }, include: userViewInclude }),
      mediaIds.length ? this.prisma.upload.findMany({ where: { id: { in: mediaIds } } }) : Promise.resolve([]),
      this.prisma.postLike.findMany({ where: { userId: viewerId, postId: { in: ids } }, select: { postId: true } }),
      this.polls(viewerId, ids),
    ]);
    const authorById = new Map(authors.map((a) => [a.id, this.userView.toMini(a)]));
    const uploadById = new Map<string, UploadDto>(uploads.map((u) => [u.id, toUploadDto(u, this.storage)]));
    const liked = new Set(likes.map((l) => l.postId));
    return rows.map((r) => ({
      id: r.id,
      author: authorById.get(r.authorId)!,
      community: r.communityId ? { id: r.communityId, name: r.communityName ?? '' } : null,
      text: r.text,
      media: r.mediaUploadIds.map((m) => uploadById.get(m)).filter((u): u is UploadDto => !!u),
      poll: polls.get(r.id) ?? null,
      likeCount: r.likeCount,
      commentCount: r.commentCount,
      likedByMe: liked.has(r.id),
      createdAt: r.createdAt.toISOString(),
      canDelete: r.authorId === viewerId || (!!r.communityId && isMod(r.myRole)),
    }));
  }

  private async polls(viewerId: string, postIds: string[]): Promise<Map<string, PollDto>> {
    const polls = await this.prisma.poll.findMany({
      where: { postId: { in: postIds } },
      include: { options: { orderBy: { position: 'asc' } } },
    });
    if (!polls.length) return new Map();
    const votes = await this.prisma.pollVote.findMany({ where: { userId: viewerId, pollId: { in: polls.map((p) => p.id) } }, select: { pollId: true, optionId: true } });
    return new Map(
      polls.map((p) => [
        p.postId,
        {
          question: p.question,
          multiple: p.multiple,
          options: p.options.map((o) => ({ id: o.id, text: o.text, voteCount: o.voteCount })),
          myVotes: votes.filter((v) => v.pollId === p.id).map((v) => v.optionId),
          totalVoters: p.totalVoters,
        },
      ]),
    );
  }

  private toCommentDto(
    viewerId: string,
    post: PostRow,
    c: { id: string; postId: string; authorId: string; text: string; createdAt: Date; author: Parameters<UserViewService['toMini']>[0] },
  ): PostCommentDto {
    return {
      id: c.id,
      postId: c.postId,
      author: this.userView.toMini(c.author),
      text: c.text,
      createdAt: c.createdAt.toISOString(),
      canDelete: canDeleteComment(viewerId, post, c.authorId),
    };
  }
}

function canDeleteComment(viewerId: string, post: PostRow, commentAuthorId: string): boolean {
  return commentAuthorId === viewerId || post.authorId === viewerId || (!!post.communityId && isMod(post.myRole));
}
