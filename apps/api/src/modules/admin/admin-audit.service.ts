import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AdminActionDto, AdminActionKind, Paginated } from '@autoc/shared';
import { newId } from '../../common/ids';
import { decodeCursor, keysetOrderBy, keysetWhere, splitPage } from '../../common/pagination/cursor';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AdminViewService } from './admin-view.service';

export type AuditEntry = {
  adminId: string;
  action: AdminActionKind;
  targetType: 'user' | 'community' | 'sos' | 'report' | 'service' | 'visit' | 'message' | 'post' | 'comment';
  targetId: string;
  targetUserId: string | null;
  note: string;
};

/** The admin audit log (`admin_actions`): one row per mutating admin action. */
@Injectable()
export class AdminAuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly view: AdminViewService,
  ) {}

  /** Writes the row, inside the caller's transaction when given. */
  async record(entry: AuditEntry, db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<void> {
    await db.adminAction.create({ data: { id: newId(), ...entry } });
  }

  async list(q: { cursor?: string; limit: number; adminId?: string; targetUserId?: string }): Promise<Paginated<AdminActionDto>> {
    const rows = await this.prisma.adminAction.findMany({
      where: {
        ...(q.adminId ? { adminId: q.adminId } : {}),
        ...(q.targetUserId ? { targetUserId: q.targetUserId } : {}),
        ...keysetWhere(decodeCursor(q.cursor)),
      },
      orderBy: keysetOrderBy,
      take: q.limit + 1,
    });
    const page = splitPage(rows, q.limit);
    return { items: await this.view.actionDtos(page.rows), nextCursor: page.nextCursor };
  }
}
