import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  RESERVED_NICKNAMES,
  type Me,
  type Paginated,
  type UpdateMeInput,
  type UpdateSettingsInput,
  type UserPublic,
  type VehicleDto,
} from '@autoc/shared';
import { SessionService } from '../../common/auth/session.service';
import { UserStateService } from '../../common/auth/user-state.service';
import { Errors } from '../../common/errors/api-exception';
import { decodeCursor, splitPage } from '../../common/pagination/cursor';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AccountDeletionHooks } from '../../infra/tasks/account-deletion-hooks';
import { UploadsService } from '../uploads/uploads.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { RelationService } from './relation.service';
import { UserViewService, userViewInclude, type UserWithView } from './user-view.service';

export const DELETED_USER_NAME = 'Deleted user';
/** Notification payload keys holding a UserMini of the actor. */
export const ACTOR_PAYLOAD_KEYS = ['user', 'helper', 'requester', 'actor', 'author'] as const;

const isUniqueViolationOn = (err: unknown, field: string) =>
  err instanceof Prisma.PrismaClientKnownRequestError &&
  err.code === 'P2002' &&
  JSON.stringify(err.meta?.target ?? '').includes(field);

/** Escapes LIKE wildcards so user input is matched literally. */
const likePrefix = (q: string) => `${q.replace(/[\\%_]/g, '\\$&')}%`;
/** Highest code point: every string starting with `q` sorts (bytewise) below `q + MAX_CHAR`. */
const MAX_CHAR = String.fromCodePoint(0x10ffff);

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly view: UserViewService,
    private readonly relations: RelationService,
    private readonly uploads: UploadsService,
    private readonly vehicles: VehiclesService,
    private readonly userState: UserStateService,
    private readonly sessions: SessionService,
    private readonly deletionHooks: AccountDeletionHooks,
  ) {}

  getMe(userId: string): Promise<Me> {
    return this.view.loadMe(userId);
  }

  async updateMe(userId: string, input: UpdateMeInput): Promise<Me> {
    const current = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { nickname: true, avatarUploadId: true },
    });
    if (input.nickname !== undefined && input.nickname !== current.nickname) {
      await this.assertNicknameFree(userId, input.nickname);
    }
    if (input.avatarUploadId) {
      await this.uploads.requireOwn(userId, input.avatarUploadId, ['avatar']);
      const usedBy = await this.prisma.user.count({ where: { avatarUploadId: input.avatarUploadId, id: { not: userId } } });
      if (usedBy) throw Errors.badRequest('INVALID_UPLOAD', 'This upload is already used elsewhere');
    }
    let user: UserWithView;
    try {
      user = await this.prisma.user.update({
        where: { id: userId },
        data: {
          name: input.name,
          nickname: input.nickname,
          city: input.city,
          bio: input.bio === '' ? null : input.bio,
          avatarUploadId: input.avatarUploadId,
          locale: input.locale,
        },
        include: userViewInclude,
      });
    } catch (err) {
      if (isUniqueViolationOn(err, 'nickname')) throw nicknameTaken();
      if (isUniqueViolationOn(err, 'avatar')) throw Errors.badRequest('INVALID_UPLOAD', 'This upload is already used elsewhere');
      throw err;
    }
    const replacedAvatar = input.avatarUploadId !== undefined && current.avatarUploadId !== input.avatarUploadId;
    if (replacedAvatar && current.avatarUploadId) await this.uploads.remove(current.avatarUploadId);
    return this.view.toMe(user);
  }

  async updateSettings(userId: string, input: UpdateSettingsInput): Promise<Me> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { privacyMode: input.privacyMode, receiveSos: input.receiveSos },
      include: userViewInclude,
    });
    return this.view.toMe(user);
  }

  async completeOnboarding(userId: string): Promise<Me> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: userViewInclude });
    const missing = [!user.name.trim() && 'name', !user.nickname && 'nickname'].filter(Boolean);
    if (missing.length) {
      throw Errors.badRequest('ONBOARDING_INCOMPLETE', 'Name and nickname are required', { missing });
    }
    if (user.onboardedAt) return this.view.toMe(user);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { onboardedAt: new Date() },
      include: userViewInclude,
    });
    return this.view.toMe(updated);
  }

  /**
   * Account deletion: the row stays (content, reviews and audit keep their foreign keys) but every
   * piece of personal data is removed and the account can never sign in again.
   */
  async deleteAccount(userId: string): Promise<void> {
    // Feature clean-up with its normal side effects first (e.g. open SOS cancelled, responses withdrawn).
    await this.deletionHooks.run(userId);
    const avatarUploads = await this.prisma.$transaction(async (tx) => {
      const avatars = await tx.upload.findMany({
        where: { ownerId: userId, purpose: 'avatar' },
        select: { id: true, key: true, thumbKey: true },
      });
      await tx.user.update({
        where: { id: userId },
        data: {
          name: DELETED_USER_NAME,
          nickname: null,
          phone: null,
          phoneVerifiedAt: null,
          avatarUploadId: null,
          city: null,
          bio: null,
          status: 'deleted',
          privacyMode: 'hidden',
          receiveSos: false,
        },
      });
      await tx.userLocation.deleteMany({ where: { userId } });
      await tx.vehicle.deleteMany({ where: { userId } });
      await tx.pushSubscription.deleteMany({ where: { userId } });
      await tx.authIdentity.deleteMany({ where: { userId } });
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.friendship.deleteMany({ where: { OR: [{ requesterId: userId }, { addresseeId: userId }] } });
      // Communities: leave every community (keeping memberCount right) and close the ones the user owns.
      await tx.$executeRaw`
        UPDATE communities c SET member_count = c.member_count - 1
        FROM community_members m
        WHERE m.community_id = c.id AND m.user_id = ${userId}::uuid AND m.status = 'active' AND c.owner_id <> ${userId}::uuid`;
      await tx.$executeRaw`
        DELETE FROM chat_members cm USING chats ch, communities c
        WHERE cm.chat_id = ch.id AND ch.type = 'community' AND ch.ref_id = c.id::text
          AND c.owner_id = ${userId}::uuid AND c.deleted_at IS NULL`;
      await tx.$executeRaw`UPDATE communities SET deleted_at = now() WHERE owner_id = ${userId}::uuid AND deleted_at IS NULL`;
      await tx.$executeRaw`
        DELETE FROM chat_members cm USING chats ch
        WHERE cm.chat_id = ch.id AND ch.type = 'community' AND cm.user_id = ${userId}::uuid`;
      await tx.communityMember.deleteMany({ where: { userId } });
      // Notifications: the user's own are personal data; in others' notifications the user appears as the
      // actor (payload.user) — those become an anonymous "Deleted user", and dead friend requests go away.
      await tx.notification.deleteMany({ where: { userId } });
      await tx.$executeRaw`
        DELETE FROM notifications WHERE type = 'friend_request' AND payload->'user'->>'id' = ${userId}`;
      const anonymous = { id: userId, nickname: '', name: DELETED_USER_NAME, avatarUrl: null, rating: 0 };
      // Every key a UserMini of an actor is stored under (friends, communities, SOS, reviews).
      for (const key of ACTOR_PAYLOAD_KEYS) {
        await tx.$executeRaw`
          UPDATE notifications SET payload = jsonb_set(payload, ARRAY[${key}]::text[], ${JSON.stringify(anonymous)}::jsonb)
          WHERE payload->${key}->>'id' = ${userId}`;
      }
      await tx.upload.deleteMany({ where: { id: { in: avatars.map((a) => a.id) } } });
      return avatars;
    });
    await this.userState.invalidate(userId);
    await this.sessions.markRevoked(userId);
    await this.uploads.removeObjects(avatarUploads.flatMap((a) => [a.key, a.thumbKey]));
  }

  async getPublic(viewerId: string, userId: string): Promise<UserPublic> {
    return this.view.toPublic(viewerId, await this.requireVisible(viewerId, userId));
  }

  async listVehicles(viewerId: string, userId: string): Promise<VehicleDto[]> {
    await this.requireVisible(viewerId, userId);
    const relation = await this.relations.relationFor(viewerId, userId);
    return this.vehicles.list(userId, relation === 'self' || relation === 'friend');
  }

  /** Prefix search over nickname and name among active, onboarded users. */
  async search(viewerId: string, q: string, cursor: string | undefined, limit: number): Promise<Paginated<UserPublic>> {
    const after = decodeCursor(cursor);
    const prefix = q.toLowerCase();
    const pattern = likePrefix(prefix);
    const upper = prefix + MAX_CHAR;
    const rows = await this.prisma.$queryRaw<{ id: string; createdAt: Date }[]>`
      SELECT id, created_at AS "createdAt"
      FROM users
      WHERE status = 'active'
        AND onboarded_at IS NOT NULL
        -- The explicit ~>=~/~<~ range lets prepared (generic) plans use the text_pattern_ops indexes,
        -- which a parameterized LIKE alone cannot; LIKE then keeps the match exact.
        AND (
          (lower(nickname::text) ~>=~ ${prefix} AND lower(nickname::text) ~<~ ${upper} AND lower(nickname::text) LIKE ${pattern} ESCAPE '\\')
          OR (lower(name) ~>=~ ${prefix} AND lower(name) ~<~ ${upper} AND lower(name) LIKE ${pattern} ESCAPE '\\')
        )
        ${after ? Prisma.sql`AND (created_at, id) < (${after.createdAt}, ${after.id}::uuid)` : Prisma.empty}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit + 1}`;
    const page = splitPage(rows, limit);
    const users = await this.prisma.user.findMany({
      where: { id: { in: page.rows.map((r) => r.id) } },
      include: userViewInclude,
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    const ordered = page.rows.map((r) => byId.get(r.id)).filter((u): u is UserWithView => !!u);
    return { items: await this.view.toPublicMany(viewerId, ordered), nextCursor: page.nextCursor };
  }

  /** Others are visible once onboarded and not deleted; blocked users stay visible with status "blocked". */
  private async requireVisible(viewerId: string, userId: string): Promise<UserWithView> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: userViewInclude });
    if (!user) throw Errors.notFound('User not found');
    if (user.id !== viewerId && (user.status === 'deleted' || !user.onboardedAt)) throw Errors.notFound('User not found');
    return user;
  }

  private async assertNicknameFree(userId: string, nickname: string): Promise<void> {
    if (RESERVED_NICKNAMES.includes(nickname.toLowerCase())) throw nicknameTaken();
    // nickname is citext, so equality is case-insensitive.
    const owner = await this.prisma.user.findFirst({ where: { nickname, id: { not: userId } }, select: { id: true } });
    if (owner) throw nicknameTaken();
  }
}

const nicknameTaken = () => Errors.conflict('NICKNAME_TAKEN', 'This nickname is already taken');
