import { Injectable } from '@nestjs/common';
import type { AdminAction, FraudFlag, Prisma, User } from '@prisma/client';
import type { AdminActionDto, AdminUserRow, AdminUserStatus, FraudFlagDto, UserMini } from '@autoc/shared';
import { isUserBlocked } from '../../common/auth/user-state.service';
import { Errors } from '../../common/errors/api-exception';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { UserViewService, userViewInclude, type UserWithView } from '../users/user-view.service';

type Db = Prisma.TransactionClient | PrismaService;

export const adminStatusOf = (u: Pick<User, 'status' | 'blockedUntil'>): AdminUserStatus =>
  u.status === 'deleted'
    ? 'deleted'
    : isUserBlocked({ status: u.status, blockedUntil: u.blockedUntil?.toISOString() ?? null })
      ? 'blocked'
      : 'active';

/** 403 INVALID_TARGET: admins can't act on themselves or on other admins (API.md §6). */
export const invalidTarget = (message = "Admins can't act on themselves or on other admins") => Errors.forbidden(message, 'INVALID_TARGET');

/** Shared mapping for the admin endpoints (users, minis, audit rows, fraud flags). */
@Injectable()
export class AdminViewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userView: UserViewService,
  ) {}

  toRow(u: UserWithView): AdminUserRow {
    return {
      id: u.id,
      nickname: u.nickname,
      name: u.name,
      avatarUrl: this.userView.avatarUrl(u),
      phone: u.phone,
      role: u.role,
      status: adminStatusOf(u),
      rating: u.rating,
      blockedUntil: u.blockedUntil?.toISOString() ?? null,
      sosBannedUntil: u.sosBannedUntil?.toISOString() ?? null,
      onboarded: u.onboardedAt !== null,
      createdAt: u.createdAt.toISOString(),
      lastActiveAt: u.lastActiveAt?.toISOString() ?? null,
    };
  }

  /** UserMini for each id in one query. */
  async minis(ids: (string | null | undefined)[]): Promise<Map<string, UserMini>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (!unique.length) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, include: userViewInclude });
    return new Map(users.map((u) => [u.id, this.userView.toMini(u)]));
  }

  async actionDtos(rows: AdminAction[]): Promise<AdminActionDto[]> {
    const minis = await this.minis(rows.flatMap((r) => [r.adminId, r.targetUserId]));
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      admin: minis.get(r.adminId) ?? deletedMini(r.adminId),
      targetUser: r.targetUserId ? (minis.get(r.targetUserId) ?? deletedMini(r.targetUserId)) : null,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async flagDtos(rows: FraudFlag[]): Promise<FraudFlagDto[]> {
    const minis = await this.minis(rows.map((r) => r.userId));
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      user: r.userId ? (minis.get(r.userId) ?? null) : null,
      details: (r.details ?? {}) as Record<string, unknown>,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Loads a user an admin wants to act on: 404 if missing, 403 INVALID_TARGET for self or another admin. */
  async targetUser(adminId: string, userId: string, db: Db = this.prisma): Promise<User> {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) throw Errors.notFound('User not found');
    assertTargetable(adminId, user);
    return user;
  }
}

export function assertTargetable(adminId: string, user: Pick<User, 'id' | 'role'> | null): void {
  if (user && (user.id === adminId || user.role === 'admin')) throw invalidTarget();
}

const deletedMini = (id: string): UserMini => ({ id, nickname: '', name: 'Deleted user', avatarUrl: null, rating: 0 });
