import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ADMIN_LIMITS,
  type AdminBlockInput,
  type AdminSosBanInput,
  type AdminUserDetail,
  type AdminUserRow,
  type AdminUserStatus,
  type Paginated,
  type RatingEventReason,
} from '@autoc/shared';
import { Errors } from '../../common/errors/api-exception';
import { decodeCursor, keysetOrderBy, keysetWhere, splitPage } from '../../common/pagination/cursor';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SanctionsService } from '../antifraud/sanctions.service';
import { userViewInclude, WARN_ACTION } from '../users/user-view.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminViewService } from './admin-view.service';

/** Users list filter by effective status (an expired temporary block counts as active). */
function statusWhere(status: AdminUserStatus | undefined): Prisma.UserWhereInput {
  const now = new Date();
  switch (status) {
    case 'active':
      return { OR: [{ status: 'active' }, { status: 'blocked', blockedUntil: { lte: now } }] };
    case 'blocked':
      return { status: 'blocked', OR: [{ blockedUntil: null }, { blockedUntil: { gt: now } }] };
    case 'deleted':
      return { status: 'deleted' };
    default:
      return {};
  }
}

/** `q`: nickname / name substring (case-insensitive); 3+ digits also match the phone number. */
function searchWhere(q: string | undefined): Prisma.UserWhereInput {
  if (!q) return {};
  const or: Prisma.UserWhereInput[] = [
    { nickname: { contains: q, mode: 'insensitive' } },
    { name: { contains: q, mode: 'insensitive' } },
  ];
  const digits = q.replace(/\D/g, '');
  if (digits.length >= 3) or.push({ phone: { contains: digits } });
  return { OR: or };
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly view: AdminViewService,
    private readonly audit: AdminAuditService,
    private readonly sanctions: SanctionsService,
  ) {}

  async list(q: { q?: string; status?: AdminUserStatus; cursor?: string; limit: number }): Promise<Paginated<AdminUserRow>> {
    const rows = await this.prisma.user.findMany({
      where: { AND: [searchWhere(q.q), statusWhere(q.status), keysetWhere(decodeCursor(q.cursor))] },
      orderBy: keysetOrderBy,
      take: q.limit + 1,
      include: userViewInclude,
    });
    const page = splitPage(rows, q.limit);
    return { items: page.rows.map((u) => this.view.toRow(u)), nextCursor: page.nextCursor };
  }

  async detail(id: string): Promise<AdminUserDetail> {
    const user = await this.prisma.user.findUnique({ where: { id }, include: userViewInclude });
    if (!user) throw Errors.notFound('User not found');
    const take = ADMIN_LIMITS.recentItems;
    const [sosCreated, helps, reportsAgainst, reportsFiled, warnings, events, actions, flags] = await Promise.all([
      this.prisma.sosRequest.count({ where: { userId: id } }),
      this.prisma.sosResponse.count({ where: { helperId: id, status: 'arrived' } }),
      this.prisma.report.count({ where: { targetUserId: id } }),
      this.prisma.report.count({ where: { reporterId: id } }),
      this.prisma.adminAction.count({ where: { targetUserId: id, action: WARN_ACTION } }),
      this.prisma.ratingEvent.findMany({ where: { userId: id }, orderBy: keysetOrderBy, take }),
      this.prisma.adminAction.findMany({ where: { targetUserId: id }, orderBy: keysetOrderBy, take }),
      this.prisma.fraudFlag.findMany({ where: { userId: id }, orderBy: keysetOrderBy, take }),
    ]);
    return {
      user: { ...this.view.toRow(user), city: user.city, bio: user.bio, phoneVerified: user.phoneVerifiedAt !== null, locale: user.locale },
      counts: { sosCreated, helps, reportsAgainst, reportsFiled, warnings },
      recentRatingEvents: events.map((e) => ({
        id: e.id,
        delta: e.delta,
        reason: e.reason as RatingEventReason,
        refId: e.refId,
        createdAt: e.createdAt.toISOString(),
      })),
      recentAdminActions: await this.view.actionDtos(actions),
      fraudFlags: await this.view.flagDtos(flags),
    };
  }

  /** `admin_warning` notification with the note; counted in Me.warningsCount. */
  async warn(adminId: string, id: string, note: string): Promise<AdminUserDetail> {
    const user = await this.view.targetUser(adminId, id);
    if (user.status === 'deleted') throw Errors.notFound('User not found');
    await this.audit.record({ adminId, action: WARN_ACTION as 'user.warn', targetType: 'user', targetId: id, targetUserId: id, note });
    await this.sanctions.notify(id, { kind: 'warning', note, until: null, automatic: false });
    return this.detail(id);
  }

  /** Blocked (temporarily with `until`): sessions revoked, sockets disconnected, open SOS cancelled. */
  async block(adminId: string, id: string, input: AdminBlockInput): Promise<AdminUserDetail> {
    const user = await this.view.targetUser(adminId, id);
    if (user.status === 'deleted') throw Errors.notFound('User not found');
    await this.sanctions.block(id, {
      until: input.until ?? null,
      note: input.note,
      automatic: false,
      inTx: (tx) => this.audit.record({ adminId, action: 'user.block', targetType: 'user', targetId: id, targetUserId: id, note: input.note }, tx),
    });
    return this.detail(id);
  }

  async unblock(adminId: string, id: string, note: string): Promise<AdminUserDetail> {
    const user = await this.view.targetUser(adminId, id);
    if (user.status !== 'blocked') throw Errors.conflict('NOT_BLOCKED', 'This user is not blocked');
    await this.sanctions.unblock(id, (tx) =>
      this.audit.record({ adminId, action: 'user.unblock', targetType: 'user', targetId: id, targetUserId: id, note }, tx),
    );
    return this.detail(id);
  }

  async sosBan(adminId: string, id: string, input: AdminSosBanInput): Promise<AdminUserDetail> {
    const user = await this.view.targetUser(adminId, id);
    if (user.status === 'deleted') throw Errors.notFound('User not found');
    await this.sanctions.sosBan(id, input.until, input.note, false, (tx) =>
      this.audit.record({ adminId, action: 'user.sos_ban', targetType: 'user', targetId: id, targetUserId: id, note: input.note }, tx),
    );
    return this.detail(id);
  }

  async sosUnban(adminId: string, id: string, note: string): Promise<AdminUserDetail> {
    const user = await this.view.targetUser(adminId, id);
    if (!user.sosBannedUntil || user.sosBannedUntil.getTime() <= Date.now()) throw Errors.conflict('NOT_SOS_BANNED', 'This user is not SOS-banned');
    await this.sanctions.sosUnban(id, (tx) =>
      this.audit.record({ adminId, action: 'user.sos_unban', targetType: 'user', targetId: id, targetUserId: id, note }, tx),
    );
    return this.detail(id);
  }
}
