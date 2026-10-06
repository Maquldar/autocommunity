import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LOCALES, tierForRating, type Locale, type Me, type Relation, type UserMini, type UserPublic } from '@autoc/shared';
import { isUserBlocked } from '../../common/auth/user-state.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { Storage } from '../../infra/storage/storage';
import { toVehicleDto } from '../vehicles/vehicle.mapper';
import { RelationService } from './relation.service';

/** Relations needed to render any user view; use with `include` on every user query that feeds the mapper. */
export const userViewInclude = {
  avatar: { select: { key: true, thumbKey: true } },
  vehicles: { where: { isPrimary: true }, take: 1 },
} satisfies Prisma.UserInclude;

export type UserWithView = Prisma.UserGetPayload<{ include: typeof userViewInclude }>;

/** AdminAction.action value for warnings; counted into Me.warningsCount. */
export const WARN_ACTION = 'user.warn';

const canSeePlate = (relation: Relation) => relation === 'self' || relation === 'friend';

/** Single mapper for UserPublic / Me / UserMini so every endpoint renders users identically. */
@Injectable()
export class UserViewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly relations: RelationService,
    private readonly storage: Storage,
  ) {}

  avatarUrl(user: Pick<UserWithView, 'avatar'>): string | null {
    const a = user.avatar;
    return a ? this.storage.publicUrl(a.thumbKey ?? a.key) : null;
  }

  toMini(user: UserWithView): UserMini {
    // Phase 9 step B: isPremium from the subscription.
    return { id: user.id, nickname: user.nickname ?? '', name: user.name, avatarUrl: this.avatarUrl(user), rating: user.rating, isPremium: false };
  }

  toPublicWithRelation(user: UserWithView, relation: Relation): UserPublic {
    const primary = user.vehicles[0];
    return {
      id: user.id,
      nickname: user.nickname ?? '',
      name: user.name,
      avatarUrl: this.avatarUrl(user),
      city: user.city,
      bio: user.bio,
      rating: user.rating,
      createdAt: user.createdAt.toISOString(),
      primaryVehicle: primary ? toVehicleDto(primary, canSeePlate(relation)) : null,
      relation,
      status: isUserBlocked({ status: user.status, blockedUntil: user.blockedUntil?.toISOString() ?? null }) ? 'blocked' : 'active',
      // Phase 9 step B: isPremium / profileFrame from the subscription.
      isPremium: false,
      profileFrame: null,
      tier: tierForRating(user.rating),
    };
  }

  /** Maps a list with one batched relation query (no N+1). Order is preserved. */
  async toPublicMany(viewerId: string, users: UserWithView[]): Promise<UserPublic[]> {
    const relations = await this.relations.relationsFor(
      viewerId,
      users.map((u) => u.id),
    );
    return users.map((u) => this.toPublicWithRelation(u, relations.get(u.id) ?? 'none'));
  }

  async toPublic(viewerId: string, user: UserWithView): Promise<UserPublic> {
    return (await this.toPublicMany(viewerId, [user]))[0]!;
  }

  async toMe(user: UserWithView): Promise<Me> {
    const warningsCount = await this.prisma.adminAction.count({ where: { targetUserId: user.id, action: WARN_ACTION } });
    const locale: Locale = (LOCALES as readonly string[]).includes(user.locale) ? (user.locale as Locale) : 'ru';
    return {
      ...this.toPublicWithRelation(user, 'self'),
      nickname: user.nickname,
      phone: user.phone,
      phoneVerified: user.phoneVerifiedAt !== null,
      privacyMode: user.privacyMode,
      receiveSos: user.receiveSos,
      role: user.role,
      locale,
      onboardingCompleted: user.onboardedAt !== null,
      warningsCount,
    };
  }

  async loadMe(userId: string): Promise<Me> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: userViewInclude });
    return this.toMe(user);
  }
}
