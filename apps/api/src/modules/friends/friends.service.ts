import { Injectable } from '@nestjs/common';
import { Prisma, type Friendship } from '@prisma/client';
import type { FriendRequestDto, Paginated, UserPublic } from '@autoc/shared';
import { isUserBlocked } from '../../common/auth/user-state.service';
import { Errors } from '../../common/errors/api-exception';
import { newId } from '../../common/ids';
import { decodeCursor, keysetOrderBy, keysetWhere, splitPage } from '../../common/pagination/cursor';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RateLimiterService } from '../../infra/rate-limit/rate-limiter.service';
import { RedisService } from '../../infra/redis/redis.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { friendPairKey } from '../users/relation.service';
import { UserViewService, userViewInclude } from '../users/user-view.service';

export type FriendRequestResult = { id: string; status: 'pending' | 'accepted' };

/** Sending friend requests is rate limited per user (spam protection). */
export const FRIEND_REQUESTS_PER_HOUR = 50;
/** After a decline or cancel the same requester can't ask the same person again for this long. */
export const FRIEND_REQUEST_COOLDOWN_SEC = 24 * 3600;

export const friendCooldownKey = (requesterId: string, addresseeId: string) => `friend-cooldown:${requesterId}:${addresseeId}`;

const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly view: UserViewService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly rateLimiter: RateLimiterService,
    private readonly redis: RedisService,
  ) {}

  /** Accepted friends, most recently accepted first. */
  async listFriends(userId: string, cursor: string | undefined, limit: number): Promise<Paginated<UserPublic>> {
    const after = decodeCursor(cursor);
    const rows = await this.prisma.friendship.findMany({
      where: {
        status: 'accepted',
        OR: [{ requesterId: userId }, { addresseeId: userId }],
        ...(after
          ? { AND: [{ OR: [{ acceptedAt: { lt: after.createdAt } }, { acceptedAt: after.createdAt, id: { lt: after.id } }] }] }
          : {}),
      },
      orderBy: [{ acceptedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { requester: { include: userViewInclude }, addressee: { include: userViewInclude } },
    });
    const page = splitPage(rows, limit, (f) => ({ createdAt: f.acceptedAt ?? f.createdAt, id: f.id }));
    return {
      items: page.rows.map((f) => this.view.toPublicWithRelation(f.requesterId === userId ? f.addressee : f.requester, 'friend')),
      nextCursor: page.nextCursor,
    };
  }

  /** Pending requests: `in` = sent to me, `out` = sent by me; newest first. */
  async listRequests(userId: string, direction: 'in' | 'out', cursor: string | undefined, limit: number): Promise<Paginated<FriendRequestDto>> {
    const after = decodeCursor(cursor);
    const query = {
      where: { status: 'pending' as const, ...(direction === 'in' ? { addresseeId: userId } : { requesterId: userId }), ...keysetWhere(after) },
      orderBy: keysetOrderBy,
      take: limit + 1,
    };
    const rows =
      direction === 'in'
        ? (await this.prisma.friendship.findMany({ ...query, include: { requester: { include: userViewInclude } } })).map(({ id, createdAt, requester }) => ({ id, createdAt, other: requester }))
        : (await this.prisma.friendship.findMany({ ...query, include: { addressee: { include: userViewInclude } } })).map(({ id, createdAt, addressee }) => ({ id, createdAt, other: addressee }));
    const page = splitPage(rows, limit);
    const relation = direction === 'in' ? 'request_in' : 'request_out';
    return {
      items: page.rows.map((f) => ({ id: f.id, user: this.view.toPublicWithRelation(f.other, relation), createdAt: f.createdAt.toISOString() })),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * Sends a request, or accepts the target's pending request to the caller (both people want it).
   * One row per pair (unique pairKey): a concurrent insert for the same pair loses the race with P2002 and
   * is retried, so two simultaneous mutual requests end as one accepted friendship.
   */
  async sendRequest(userId: string, targetId: string): Promise<FriendRequestResult> {
    if (userId === targetId) throw Errors.badRequest('INVALID_TARGET', "You can't add yourself as a friend");
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { onboardedAt: true, name: true, nickname: true } });
    if (!me.onboardedAt) {
      const missing = [!me.name.trim() && 'name', !me.nickname && 'nickname'].filter(Boolean);
      throw Errors.badRequest('ONBOARDING_INCOMPLETE', 'Complete your profile first', { missing });
    }
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { status: true, blockedUntil: true, onboardedAt: true },
    });
    const targetBlocked =
      target && isUserBlocked({ status: target.status, blockedUntil: target.blockedUntil?.toISOString() ?? null });
    if (!target || targetBlocked || !target.onboardedAt) throw Errors.notFound('User not found');
    await this.rateLimiter.consumeOrThrow([{ key: `friend-req:${userId}`, limit: FRIEND_REQUESTS_PER_HOUR, windowSec: 3600 }]);

    for (let attempt = 0; ; attempt++) {
      try {
        const result = await this.prisma.$transaction(async (tx) => {
          const pairKey = friendPairKey(userId, targetId);
          const existing = await tx.friendship.findUnique({ where: { pairKey } });
          if (existing?.status === 'accepted') throw Errors.conflict('ALREADY_FRIENDS', 'You are already friends');
          if (existing && existing.requesterId === userId) throw Errors.conflict('ALREADY_REQUESTED', 'Friend request already sent');
          if (existing) {
            // Reverse pending request → accept it.
            const { count } = await tx.friendship.updateMany({
              where: { id: existing.id, status: 'pending' },
              data: { status: 'accepted', acceptedAt: new Date() },
            });
            if (!count) throw new RetryableRace();
            return { row: existing, status: 'accepted' as const };
          }
          const cooldownMs = await this.redis.pttl(friendCooldownKey(userId, targetId));
          if (cooldownMs > 0) {
            throw Errors.conflict('FRIEND_REQUEST_COOLDOWN', 'You can send this person a new request later', {
              retryAfterSec: Math.ceil(cooldownMs / 1000),
            });
          }
          const row = await tx.friendship.create({
            data: { id: newId(), requesterId: userId, addresseeId: targetId, pairKey, status: 'pending' },
          });
          return { row, status: 'pending' as const };
        });
        if (result.status === 'accepted') await this.afterAccepted(result.row);
        else await this.afterRequested(result.row);
        return { id: result.row.id, status: result.status };
      } catch (err) {
        if ((isUniqueViolation(err) || err instanceof RetryableRace) && attempt < 2) continue;
        throw err;
      }
    }
  }

  /** Only the addressee of a pending request may accept it; anyone else gets 404. */
  async accept(userId: string, requestId: string): Promise<void> {
    const row = await this.prisma.friendship.findFirst({
      where: { id: requestId, addresseeId: userId, status: 'pending' },
      include: { requester: { select: { status: true, blockedUntil: true, onboardedAt: true } } },
    });
    if (!row) throw Errors.notFound('Friend request not found');
    // The requester may have been blocked or deleted since sending.
    const r = row.requester;
    if (!r.onboardedAt || isUserBlocked({ status: r.status, blockedUntil: r.blockedUntil?.toISOString() ?? null })) {
      throw Errors.notFound('Friend request not found');
    }
    const { count } = await this.prisma.friendship.updateMany({
      where: { id: row.id, status: 'pending' },
      data: { status: 'accepted', acceptedAt: new Date() },
    });
    if (!count) throw Errors.notFound('Friend request not found');
    await this.afterAccepted(row);
  }

  async decline(userId: string, requestId: string): Promise<void> {
    await this.removePending(requestId, { addresseeId: userId });
  }

  async cancel(userId: string, requestId: string): Promise<void> {
    await this.removePending(requestId, { requesterId: userId });
  }

  /** Per-pair, directional: the requester of a declined/cancelled request waits before asking again. */
  private async startCooldown(requesterId: string, addresseeId: string): Promise<void> {
    await this.redis.set(friendCooldownKey(requesterId, addresseeId), '1', 'EX', FRIEND_REQUEST_COOLDOWN_SEC);
  }

  async unfriend(userId: string, otherId: string): Promise<void> {
    const { count } = await this.prisma.friendship.deleteMany({ where: { pairKey: friendPairKey(userId, otherId), status: 'accepted' } });
    if (!count) throw Errors.notFound('Not friends with this user');
    this.realtime.emitToUsers([userId, otherId], 'friends:changed', {});
  }

  private async removePending(requestId: string, owner: { addresseeId: string } | { requesterId: string }): Promise<void> {
    const row = await this.prisma.friendship.findFirst({ where: { id: requestId, status: 'pending', ...owner } });
    if (!row) throw Errors.notFound('Friend request not found');
    const { count } = await this.prisma.friendship.deleteMany({ where: { id: row.id, status: 'pending' } });
    if (!count) throw Errors.notFound('Friend request not found');
    await this.startCooldown(row.requesterId, row.addresseeId);
    await this.notifications.removeFriendRequest(row.addresseeId, row.id);
    this.realtime.emitToUsers([row.requesterId, row.addresseeId], 'friends:changed', {});
  }

  private async afterRequested(row: Friendship): Promise<void> {
    const requester = await this.prisma.user.findUniqueOrThrow({ where: { id: row.requesterId }, include: userViewInclude });
    await this.notifications.create(row.addresseeId, 'friend_request', { requestId: row.id, user: this.view.toMini(requester) });
    this.realtime.emitToUsers([row.requesterId, row.addresseeId], 'friends:changed', {});
  }

  /** The original requester learns their request was accepted (also when accepted via a reverse request). */
  private async afterAccepted(row: Friendship): Promise<void> {
    await this.notifications.removeFriendRequest(row.addresseeId, row.id);
    const addressee = await this.prisma.user.findUniqueOrThrow({ where: { id: row.addresseeId }, include: userViewInclude });
    await this.notifications.create(row.requesterId, 'friend_accepted', { user: this.view.toMini(addressee) });
    this.realtime.emitToUsers([row.requesterId, row.addresseeId], 'friends:changed', {});
  }
}

/** The pending row changed between read and update (concurrent accept/cancel); re-evaluate. */
class RetryableRace extends Error {}
