import { Injectable } from '@nestjs/common';
import { Prisma, type Report } from '@prisma/client';
import {
  type AdminCommunityDto,
  type AdminReportDto,
  type AdminResolveReportInput,
  type AdminResolveResult,
  type AdminSosDetail,
  type AdminSosRow,
  type FraudFlagDto,
  type FraudFlagKind,
  type Paginated,
  type ReportReason,
  type ReportResolvedPayload,
  type ReportTargetPreview,
  type ReportTargetType,
  type ServiceStatusPayload,
  type SosResponseStatus,
  type SosStatus,
  type SosType,
} from '@autoc/shared';
import { ApiException, Errors } from '../../common/errors/api-exception';
import { decodeCursor, keysetOrderBy, keysetWhere, splitPage } from '../../common/pagination/cursor';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { Storage } from '../../infra/storage/storage';
import { AntifraudService } from '../antifraud/antifraud.service';
import { SanctionsService } from '../antifraud/sanctions.service';
import { ChatsService } from '../chats/chats.service';
import { CommunitiesService } from '../communities/communities.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RatingService } from '../rating/rating.service';
import { SosService } from '../sos/sos.service';
import { toUploadDto } from '../uploads/upload.mapper';
import { userViewInclude } from '../users/user-view.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminViewService, assertTargetable } from './admin-view.service';

const OPEN_SOS: SosStatus[] = ['created', 'accepted', 'in_progress'];
const snippet = (text: string | null | undefined, max = 280) => (text ? (text.length > max ? `${text.slice(0, max - 1)}…` : text) : null);
const like = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

type SosRowRaw = {
  id: string;
  userId: string;
  type: SosType;
  status: SosStatus;
  description: string;
  lat: number;
  lng: number;
  isFake: boolean;
  responsesCount: number;
  createdAt: Date;
  closedAt: Date | null;
};

/** Communities, SOS, reports and fraud flags in the admin panel (API.md §6). */
@Injectable()
export class AdminModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: Storage,
    private readonly view: AdminViewService,
    private readonly audit: AdminAuditService,
    private readonly communityService: CommunitiesService,
    private readonly chats: ChatsService,
    private readonly sos: SosService,
    private readonly rating: RatingService,
    private readonly notifications: NotificationsService,
    private readonly sanctions: SanctionsService,
    private readonly antifraud: AntifraudService,
  ) {}

  /* ------------------------------------------------------------------ communities */

  async communities(q: { q?: string; cursor?: string; limit: number }): Promise<Paginated<AdminCommunityDto>> {
    const rows = await this.prisma.community.findMany({
      where: { ...(q.q ? { name: { contains: q.q, mode: 'insensitive' as const } } : {}), ...keysetWhere(decodeCursor(q.cursor)) },
      orderBy: keysetOrderBy,
      take: q.limit + 1,
    });
    const page = splitPage(rows, q.limit);
    const owners = await this.view.minis(page.rows.map((c) => c.ownerId));
    return {
      items: page.rows.map((c) => ({
        id: c.id,
        name: c.name,
        city: c.city,
        isPrivate: c.isPrivate,
        memberCount: c.memberCount,
        owner: owners.get(c.ownerId) ?? { id: c.ownerId, nickname: '', name: 'Deleted user', avatarUrl: null, rating: 0 },
        deleted: c.deletedAt !== null,
        deletedAt: c.deletedAt?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  /** Soft delete with the same side effects as an owner delete (members lose the chat). */
  async deleteCommunity(adminId: string, id: string, note: string): Promise<void> {
    const community = await this.prisma.community.findFirst({ where: { id, deletedAt: null }, select: { ownerId: true } });
    if (!community) throw Errors.notFound('Community not found');
    assertTargetable(adminId, await this.prisma.user.findUnique({ where: { id: community.ownerId }, select: { id: true, role: true } }));
    await this.communityService.remove(adminId, id, { asAdmin: true });
    await this.audit.record({ adminId, action: 'community.delete', targetType: 'community', targetId: id, targetUserId: community.ownerId, note });
  }

  /* ------------------------------------------------------------------ SOS */

  async sosList(q: { status?: SosStatus; q?: string; cursor?: string; limit: number }): Promise<Paginated<AdminSosRow>> {
    const after = decodeCursor(q.cursor);
    const rows = await this.sosRows(Prisma.sql`
      WHERE TRUE
        ${q.status ? Prisma.sql`AND s.status = ${q.status}::"SosStatus"` : Prisma.empty}
        ${q.q ? Prisma.sql`AND s.description ILIKE ${like(q.q)} ESCAPE '\\'` : Prisma.empty}
        ${after ? Prisma.sql`AND (s.created_at, s.id) < (${after.createdAt}, ${after.id}::uuid)` : Prisma.empty}
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT ${q.limit + 1}::int`);
    const page = splitPage(rows, q.limit);
    return { items: await this.toSosRows(page.rows), nextCursor: page.nextCursor };
  }

  async sosDetail(id: string): Promise<AdminSosDetail> {
    const [row] = await this.sosRows(Prisma.sql`WHERE s.id = ${id}::uuid`);
    if (!row) throw Errors.notFound('SOS not found');
    const [base] = await this.toSosRows([row]);
    const [extra, responses, dispatchCount, chat, reports] = await Promise.all([
      this.prisma.sosRequest.findUniqueOrThrow({ where: { id }, select: { cancelReason: true, expiresAt: true, radiusM: true, photoUploadIds: true } }),
      this.prisma.sosResponse.findMany({ where: { sosId: id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.sosDispatch.count({ where: { sosId: id } }),
      this.prisma.chat.findUnique({ where: { refId: id }, select: { id: true } }),
      this.prisma.report.findMany({ where: { targetType: 'sos', targetId: id }, orderBy: keysetOrderBy, take: 50 }),
    ]);
    const photos = extra.photoUploadIds.length ? await this.prisma.upload.findMany({ where: { id: { in: extra.photoUploadIds } } }) : [];
    const helpers = await this.view.minis(responses.map((r) => r.helperId));
    return {
      ...base!,
      cancelReason: extra.cancelReason,
      expiresAt: extra.expiresAt.toISOString(),
      radiusM: extra.radiusM,
      photos: photos.map((p) => toUploadDto(p, this.storage)),
      responses: responses.map((r) => ({
        id: r.id,
        helper: helpers.get(r.helperId)!,
        status: r.status as SosResponseStatus,
        createdAt: r.createdAt.toISOString(),
      })),
      dispatchCount,
      chatId: chat?.id ?? null,
      reports: await this.toReportDtos(reports),
    };
  }

  /**
   * isFake = true; cancelled if still open; `fake_sos` penalty (−50) on the requester through the rating
   * ledger (refId = SOS id); the requester is notified; the antifraud cancel streak is re-checked.
   */
  async markFake(adminId: string, id: string, note: string): Promise<AdminSosDetail> {
    const sos = await this.prisma.sosRequest.findUnique({ where: { id }, select: { userId: true, isFake: true, status: true } });
    if (!sos) throw Errors.notFound('SOS not found');
    await this.view.targetUser(adminId, sos.userId);
    if (sos.isFake) throw Errors.conflict('SOS_ALREADY_FAKE', 'This SOS is already marked as fake');
    await this.applyFake(adminId, id, sos.userId, note, sos.status);
    return this.sosDetail(id);
  }

  private async applyFake(adminId: string, id: string, requesterId: string, note: string, status: SosStatus): Promise<void> {
    const marked = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.sosRequest.updateMany({ where: { id, isFake: false }, data: { isFake: true } });
      if (count) await this.audit.record({ adminId, action: 'sos.mark_fake', targetType: 'sos', targetId: id, targetUserId: requesterId, note }, tx);
      return count > 0;
    });
    if (!marked) return;
    if (OPEN_SOS.includes(status)) {
      await this.sos.cancel(requesterId, id, 'fake', { system: true }).catch((err: unknown) => {
        // Someone ended it in the meantime: the fake mark and penalty still apply.
        if (!(err instanceof ApiException && err.code === 'SOS_INVALID_STATE')) throw err;
      });
    }
    await this.rating.applyPenalty(requesterId, 'fake_sos', id);
    await this.sanctions.notify(requesterId, { kind: 'fake_sos', note, until: null, automatic: false, sosId: id });
    await this.antifraud.checkCancelStreak(requesterId, id);
  }

  private sosRows(tail: Prisma.Sql): Promise<SosRowRaw[]> {
    return this.prisma.$queryRaw<SosRowRaw[]>`
      SELECT s.id, s.user_id AS "userId", s.type, s.status, s.description, ST_Y(s.location::geometry) AS lat,
             ST_X(s.location::geometry) AS lng, s.is_fake AS "isFake", s.created_at AS "createdAt", s.closed_at AS "closedAt",
             (SELECT count(*)::int FROM sos_responses r WHERE r.sos_id = s.id) AS "responsesCount"
      FROM sos_requests s
      ${tail}`;
  }

  private async toSosRows(rows: SosRowRaw[]): Promise<AdminSosRow[]> {
    const requesters = await this.view.minis(rows.map((r) => r.userId));
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      description: r.description,
      requester: requesters.get(r.userId)!,
      lat: r.lat,
      lng: r.lng,
      isFake: r.isFake,
      responsesCount: r.responsesCount,
      createdAt: r.createdAt.toISOString(),
      closedAt: r.closedAt?.toISOString() ?? null,
    }));
  }

  /* ------------------------------------------------------------------ reports */

  async reports(q: { status?: 'open' | 'confirmed' | 'dismissed'; targetType?: ReportTargetType; q?: string; cursor?: string; limit: number }): Promise<Paginated<AdminReportDto>> {
    const rows = await this.prisma.report.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.targetType ? { targetType: q.targetType } : {}),
        ...(q.q ? { details: { contains: q.q, mode: 'insensitive' as const } } : {}),
        ...keysetWhere(decodeCursor(q.cursor)),
      },
      orderBy: keysetOrderBy,
      take: q.limit + 1,
    });
    const page = splitPage(rows, q.limit);
    return { items: await this.toReportDtos(page.rows), nextCursor: page.nextCursor };
  }

  /**
   * confirm → `report_confirmed` penalty (−10) on the target user, plus content removal when asked; other
   * open reports on the same target get the same decision; every reporter gets `report_resolved`.
   */
  async resolve(adminId: string, id: string, input: AdminResolveReportInput): Promise<AdminResolveResult> {
    const confirm = input.decision === 'confirm';
    const status = confirm ? 'confirmed' : 'dismissed';
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw Errors.notFound('Report not found');
    if (confirm && report.targetUserId) await this.view.targetUser(adminId, report.targetUserId);

    const resolved = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM reports WHERE id = ${id}::uuid FOR UPDATE`;
      if (locked[0]?.status !== 'open') throw Errors.conflict('REPORT_ALREADY_RESOLVED', 'This report is already resolved');
      const now = new Date();
      const data = { status, resolvedById: adminId, resolvedNote: input.note, resolvedAt: now } as const;
      const siblings = await tx.report.findMany({
        where: { targetType: report.targetType, targetId: report.targetId, status: 'open', id: { not: id } },
        select: { id: true, reporterId: true },
      });
      await tx.report.updateMany({ where: { id: { in: [id, ...siblings.map((s) => s.id)] } }, data });
      await this.audit.record(
        { adminId, action: confirm ? 'report.confirm' : 'report.dismiss', targetType: 'report', targetId: id, targetUserId: report.targetUserId, note: input.note },
        tx,
      );
      return [{ id, reporterId: report.reporterId }, ...siblings];
    });

    let contentRemoved = false;
    let penaltyApplied = false;
    if (confirm) {
      if (input.removeContent) contentRemoved = await this.removeContent(adminId, report, input.note);
      if (report.targetUserId) {
        await this.rating.applyPenalty(report.targetUserId, 'report_confirmed', id);
        penaltyApplied = true;
      }
    }
    await this.notifications.createMany(
      'report_resolved',
      resolved.map((r) => ({
        userId: r.reporterId,
        payload: { reportId: r.id, decision: status, targetType: report.targetType } satisfies ReportResolvedPayload,
      })),
    );
    const fresh = await this.prisma.report.findUniqueOrThrow({ where: { id } });
    return { report: (await this.toReportDtos([fresh]))[0]!, resolvedSiblings: resolved.length - 1, penaltyApplied, contentRemoved };
  }

  /** Removes the reported content per target type. Returns whether something was removed. */
  private async removeContent(adminId: string, report: Report, note: string): Promise<boolean> {
    switch (report.targetType) {
      case 'message':
        return this.chats.removeMessage(report.targetId);
      case 'community': {
        const live = await this.prisma.community.count({ where: { id: report.targetId, deletedAt: null } });
        if (!live) return false;
        await this.communityService.remove(adminId, report.targetId, { asAdmin: true });
        return true;
      }
      case 'service': {
        const svc = await this.prisma.serviceCenter.findUnique({ where: { id: report.targetId }, select: { status: true, name: true, submittedById: true } });
        if (!svc || svc.status === 'rejected') return false;
        await this.prisma.serviceCenter.update({ where: { id: report.targetId }, data: { status: 'rejected' } });
        if (svc.submittedById) {
          const payload: ServiceStatusPayload = { serviceId: report.targetId, serviceName: svc.name, status: 'rejected', note };
          await this.notifications.create(svc.submittedById, 'service_status', payload);
        }
        return true;
      }
      case 'sos': {
        if (report.reason !== 'fake_sos') return false;
        const sos = await this.prisma.sosRequest.findUnique({ where: { id: report.targetId }, select: { userId: true, isFake: true, status: true } });
        if (!sos || sos.isFake) return false;
        await this.applyFake(adminId, report.targetId, sos.userId, note, sos.status);
        return true;
      }
      default:
        // user (no content to remove), post/comment (Phase 8).
        return false;
    }
  }

  async toReportDtos(rows: Report[]): Promise<AdminReportDto[]> {
    const [minis, previews] = await Promise.all([
      this.view.minis(rows.flatMap((r) => [r.reporterId, r.targetUserId])),
      this.previews(rows),
    ]);
    return rows.map((r) => ({
      id: r.id,
      targetType: r.targetType,
      targetId: r.targetId,
      reason: r.reason as ReportReason,
      details: r.details,
      status: r.status,
      resolutionNote: r.resolvedNote,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      reporter: minis.get(r.reporterId) ?? { id: r.reporterId, nickname: '', name: 'Deleted user', avatarUrl: null, rating: 0 },
      targetUser: r.targetUserId ? (minis.get(r.targetUserId) ?? null) : null,
      preview: previews.get(`${r.targetType}:${r.targetId}`) ?? { title: null, text: null, imageUrl: null, deleted: true },
    }));
  }

  /** Content previews, one query per target type present in the page. */
  private async previews(rows: Report[]): Promise<Map<string, ReportTargetPreview>> {
    const out = new Map<string, ReportTargetPreview>();
    const ids = (type: ReportTargetType) => [...new Set(rows.filter((r) => r.targetType === type).map((r) => r.targetId))];
    const url = (u: { key: string; thumbKey: string | null } | null | undefined) => (u ? this.storage.publicUrl(u.thumbKey ?? u.key) : null);

    const userIds = ids('user');
    if (userIds.length) {
      for (const u of await this.prisma.user.findMany({ where: { id: { in: userIds } }, include: userViewInclude })) {
        out.set(`user:${u.id}`, {
          title: u.name || (u.nickname ? `@${u.nickname}` : null),
          text: snippet(u.bio),
          imageUrl: url(u.avatar),
          deleted: u.status === 'deleted',
        });
      }
    }
    const messageIds = ids('message');
    if (messageIds.length) {
      const messages = await this.prisma.message.findMany({ where: { id: { in: messageIds } }, include: { upload: true } });
      for (const m of messages) {
        const gone = m.deletedAt !== null;
        out.set(`message:${m.id}`, {
          title: m.type,
          text: gone ? null : snippet(m.text ?? (m.type === 'location' ? `${m.lat}, ${m.lng}` : null)),
          imageUrl: !gone && m.type === 'photo' ? url(m.upload) : null,
          deleted: gone,
        });
      }
    }
    const sosIds = ids('sos');
    if (sosIds.length) {
      for (const s of await this.prisma.sosRequest.findMany({ where: { id: { in: sosIds } }, select: { id: true, type: true, description: true, isFake: true, status: true } })) {
        out.set(`sos:${s.id}`, { title: `${s.type} · ${s.status}${s.isFake ? ' · fake' : ''}`, text: snippet(s.description), imageUrl: null, deleted: s.isFake });
      }
    }
    const communityIds = ids('community');
    if (communityIds.length) {
      const communities = await this.prisma.community.findMany({ where: { id: { in: communityIds } }, include: { avatar: true } });
      for (const c of communities) {
        out.set(`community:${c.id}`, { title: c.name, text: snippet(c.description), imageUrl: url(c.avatar), deleted: c.deletedAt !== null });
      }
    }
    const serviceIds = ids('service');
    if (serviceIds.length) {
      for (const s of await this.prisma.serviceCenter.findMany({ where: { id: { in: serviceIds } }, select: { id: true, name: true, address: true, status: true } })) {
        out.set(`service:${s.id}`, { title: s.name, text: s.address, imageUrl: null, deleted: s.status === 'rejected' });
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ fraud flags */

  async fraudFlags(q: { kind?: FraudFlagKind; userId?: string; cursor?: string; limit: number }): Promise<Paginated<FraudFlagDto>> {
    const rows = await this.prisma.fraudFlag.findMany({
      where: { ...(q.kind ? { kind: q.kind } : {}), ...(q.userId ? { userId: q.userId } : {}), ...keysetWhere(decodeCursor(q.cursor)) },
      orderBy: keysetOrderBy,
      take: q.limit + 1,
    });
    const page = splitPage(rows, q.limit);
    return { items: await this.view.flagDtos(page.rows), nextCursor: page.nextCursor };
  }
}
