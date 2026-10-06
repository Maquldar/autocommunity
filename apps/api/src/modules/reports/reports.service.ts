import { Injectable } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { Prisma, type Report } from '@prisma/client';
import { REPORT_LIMITS, type CreateReportInput, type Paginated, type ReportDto, type ReportReason, type ReportTargetType } from '@autoc/shared';
import { ApiException, Errors } from '../../common/errors/api-exception';
import { newId } from '../../common/ids';
import { decodeCursor, keysetOrderBy, keysetWhere, splitPage } from '../../common/pagination/cursor';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AntifraudService } from '../antifraud/antifraud.service';
import { ChatsService } from '../chats/chats.service';
import { SosService } from '../sos/sos.service';

const notFound = () => Errors.notFound('Report target not found');
const invalidTarget = (message: string) => Errors.badRequest('INVALID_TARGET', message);
const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

const toDto = (r: Report): ReportDto => ({
  id: r.id,
  targetType: r.targetType,
  targetId: r.targetId,
  reason: r.reason as ReportReason,
  details: r.details,
  status: r.status,
  resolutionNote: r.resolvedNote,
  createdAt: r.createdAt.toISOString(),
  resolvedAt: r.resolvedAt?.toISOString() ?? null,
});

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chats: ChatsService,
    private readonly sos: SosService,
    private readonly antifraud: AntifraudService,
  ) {}

  async create(reporterId: string, input: CreateReportInput): Promise<ReportDto> {
    const targetUserId = await this.resolveTarget(reporterId, input.targetType, input.targetId);
    if (targetUserId === reporterId) throw invalidTarget("You can't report yourself or your own content");
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${reporterId}::uuid FOR UPDATE`;
        const open = await tx.report.count({ where: { reporterId, targetType: input.targetType, targetId: input.targetId, status: 'open' } });
        if (open) throw alreadyReported();
        const recent = await tx.report.findMany({
          where: { reporterId, createdAt: { gt: new Date(Date.now() - 24 * 3600_000) } },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        });
        if (recent.length >= REPORT_LIMITS.perDay) {
          const oldest = recent[recent.length - REPORT_LIMITS.perDay]!.createdAt.getTime();
          throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', 'Too many reports today', {
            retryAfterSec: Math.max(1, Math.ceil((oldest + 24 * 3600_000 - Date.now()) / 1000)),
          });
        }
        return tx.report.create({
          data: {
            id: newId(),
            reporterId,
            targetType: input.targetType,
            targetId: input.targetId,
            targetUserId,
            reason: input.reason,
            details: input.details ?? null,
          },
        });
      });
      this.antifraud.reportCreated(row.targetUserId);
      return toDto(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw alreadyReported();
      throw err;
    }
  }

  async mine(reporterId: string, cursor: string | undefined, limit: number): Promise<Paginated<ReportDto>> {
    const after = decodeCursor(cursor);
    const rows = await this.prisma.report.findMany({ where: { reporterId, ...keysetWhere(after) }, orderBy: keysetOrderBy, take: limit + 1 });
    const page = splitPage(rows, limit);
    return { items: page.rows.map(toDto), nextCursor: page.nextCursor };
  }

  /**
   * The target must exist and be readable by the reporter (404 otherwise). Returns the user the report is
   * about (penalties in Phase 6 apply to them), or null (e.g. a seeded service without a submitter).
   */
  private async resolveTarget(reporterId: string, type: ReportTargetType, id: string): Promise<string | null> {
    switch (type) {
      case 'user': {
        const u = await this.prisma.user.findUnique({ where: { id }, select: { status: true, onboardedAt: true } });
        if (!u || (id !== reporterId && (u.status === 'deleted' || !u.onboardedAt))) throw notFound();
        return id;
      }
      case 'message': {
        const m = await this.prisma.message.findUnique({ where: { id }, select: { chatId: true, senderId: true } });
        if (!m || !(await this.chats.canAccess(reporterId, m.chatId))) throw notFound();
        return m.senderId;
      }
      case 'sos': {
        const s = await this.prisma.sosRequest.findUnique({ where: { id }, select: { userId: true } });
        if (!s || !(await this.sos.canView(reporterId, id))) throw notFound();
        return s.userId;
      }
      case 'community': {
        const c = await this.prisma.community.findFirst({ where: { id, deletedAt: null }, select: { ownerId: true } });
        if (!c) throw notFound();
        return c.ownerId;
      }
      case 'service': {
        const s = await this.prisma.serviceCenter.findUnique({ where: { id }, select: { status: true, submittedById: true } });
        if (!s || (s.status !== 'verified' && s.submittedById !== reporterId)) throw notFound();
        return s.submittedById;
      }
      case 'post':
      case 'comment':
        throw invalidTarget('Posts and comments can be reported once the feed exists');
    }
  }
}

const alreadyReported = () => Errors.conflict('ALREADY_REPORTED', 'You already have an open report about this');
