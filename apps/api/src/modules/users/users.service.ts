import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  Me,
  Paginated,
  UpdateMeInput,
  UpdateSettingsInput,
  UserPublic,
  VehicleDto,
} from '@autoc/shared';
import { SessionService } from '../../common/auth/session.service';
import { UserStateService } from '../../common/auth/user-state.service';
import { Errors } from '../../common/errors/api-exception';
import { decodeCursor, splitPage } from '../../common/pagination/cursor';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { RelationService } from './relation.service';
import { UserViewService, userViewInclude, type UserWithView } from './user-view.service';

export const DELETED_USER_NAME = 'Deleted user';

const isUniqueViolationOn = (err: unknown, field: string) =>
  err instanceof Prisma.PrismaClientKnownRequestError &&
  err.code === 'P2002' &&
  JSON.stringify(err.meta?.target ?? '').includes(field);

/** Escapes LIKE wildcards so user input is matched literally. */
const likePrefix = (q: string) => `${q.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;

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
  ) {}

  getMe(userId: string): Promise<Me> {
    return this.view.loadMe(userId);
  }

  async updateMe(userId: string, input: UpdateMeInput): Promise<Me> {
    if (input.nickname !== undefined) await this.assertNicknameFree(userId, input.nickname);
    if (input.avatarUploadId) await this.uploads.requireOwn(userId, input.avatarUploadId, ['avatar']);
    try {
      const user = await this.prisma.user.update({
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
      return this.view.toMe(user);
    } catch (err) {
      if (isUniqueViolationOn(err, 'nickname')) throw nicknameTaken();
      throw err;
    }
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
    const pattern = likePrefix(q);
    const rows = await this.prisma.$queryRaw<{ id: string; createdAt: Date }[]>`
      SELECT id, created_at AS "createdAt"
      FROM users
      WHERE status = 'active'
        AND onboarded_at IS NOT NULL
        AND (lower(nickname::text) LIKE ${pattern} ESCAPE '\\' OR lower(name) LIKE ${pattern} ESCAPE '\\')
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
    // nickname is citext, so equality is case-insensitive.
    const owner = await this.prisma.user.findFirst({ where: { nickname, id: { not: userId } }, select: { id: true } });
    if (owner) throw nicknameTaken();
  }
}

const nicknameTaken = () => Errors.conflict('NICKNAME_TAKEN', 'This nickname is already taken');
