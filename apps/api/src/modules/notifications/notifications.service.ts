import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Notification } from '@prisma/client';
import type { NotificationDto, NotificationType, Paginated } from '@autoc/shared';
import { Errors } from '../../common/errors/api-exception';
import { newId } from '../../common/ids';
import { decodeCursor, keysetOrderBy, keysetWhere, splitPage } from '../../common/pagination/cursor';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BackgroundTasks } from '../../infra/tasks/background-tasks';
import { PushQueue } from '../push/push.queue';
import { RealtimeService } from '../realtime/realtime.service';
import { pushPayloadFor } from './push-text';

export const toNotificationDto = (n: Notification): NotificationDto => ({
  id: n.id,
  type: n.type as NotificationType,
  payload: (n.payload ?? {}) as Record<string, unknown>,
  readAt: n.readAt?.toISOString() ?? null,
  createdAt: n.createdAt.toISOString(),
});

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly push: PushQueue,
    private readonly tasks: BackgroundTasks,
  ) {}

  /**
   * Persists a notification, then delivers it in the background: `notification:new` + `notification:count`
   * over Socket.IO and a localized Web Push. Delivery failures are logged, never thrown — the notification
   * is already stored and the caller's request must not fail because a push service is down.
   */
  async create(userId: string, type: NotificationType, payload: Record<string, unknown>): Promise<NotificationDto> {
    const row = await this.prisma.notification.create({
      data: { id: newId(), userId, type, payload: payload as Prisma.InputJsonObject },
    });
    const dto = toNotificationDto(row);
    this.tasks.run(`Delivery of ${type} notification`, () => this.deliver(userId, dto));
    return dto;
  }

  /**
   * The same notification type for many users in a constant number of queries: one insert, then (in the
   * background) one unread-count query, one locale query and one push-subscription query for all of them.
   */
  async createMany(type: NotificationType, items: { userId: string; payload: Record<string, unknown> }[]): Promise<NotificationDto[]> {
    const batch = await this.insertMany(this.prisma, type, items);
    this.deliverLater(batch);
    return batch.map((b) => b.dto);
  }

  /** Inserts inside the caller's transaction; call `deliverLater` with the result after commit. */
  async insertMany(
    db: Prisma.TransactionClient,
    type: NotificationType,
    items: { userId: string; payload: Record<string, unknown> }[],
  ): Promise<{ userId: string; dto: NotificationDto }[]> {
    if (!items.length) return [];
    const now = new Date();
    const rows = items.map((i) => ({ id: newId(), userId: i.userId, type, payload: i.payload as Prisma.InputJsonObject, createdAt: now }));
    await db.notification.createMany({ data: rows });
    return rows.map((r) => ({ userId: r.userId, dto: toNotificationDto({ ...r, payload: r.payload as Prisma.JsonValue, readAt: null }) }));
  }

  deliverLater(batch: { userId: string; dto: NotificationDto }[]): void {
    if (batch.length) this.tasks.run(`Delivery of ${batch.length} notifications`, () => this.deliverMany(batch));
  }

  private async deliverMany(batch: { userId: string; dto: NotificationDto }[]): Promise<void> {
    const userIds = [...new Set(batch.map((b) => b.userId))];
    for (const b of batch) this.realtime.emitToUser(b.userId, 'notification:new', b.dto);
    const [counts, users] = await Promise.all([
      this.prisma.notification.groupBy({ by: ['userId'], where: { userId: { in: userIds }, readAt: null }, _count: { _all: true } }),
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, locale: true } }),
    ]);
    for (const c of counts) this.realtime.emitToUser(c.userId, 'notification:count', { count: c._count._all });
    const locale = new Map(users.map((u) => [u.id, u.locale]));
    const pushes = batch
      .map((b) => ({ userId: b.userId, payload: pushPayloadFor(b.dto.type, b.dto.payload, locale.get(b.userId) ?? 'ru') }))
      .filter((p): p is { userId: string; payload: NonNullable<typeof p.payload> } => p.payload !== null);
    if (pushes.length) await this.push.enqueueForUsers(pushes);
  }

  async list(userId: string, cursor: string | undefined, limit: number): Promise<Paginated<NotificationDto>> {
    const after = decodeCursor(cursor);
    const rows = await this.prisma.notification.findMany({
      where: { userId, ...keysetWhere(after) },
      orderBy: keysetOrderBy,
      take: limit + 1,
    });
    const page = splitPage(rows, limit);
    return { items: page.rows.map(toNotificationDto), nextCursor: page.nextCursor };
  }

  unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  /** 404 unless the notification is the caller's; reading twice is a no-op. */
  async markRead(userId: string, id: string): Promise<void> {
    const n = await this.prisma.notification.findFirst({ where: { id, userId }, select: { readAt: true } });
    if (!n) throw Errors.notFound('Notification not found');
    if (n.readAt) return;
    await this.prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
    await this.emitCount(userId);
  }

  async markAllRead(userId: string): Promise<void> {
    const { count } = await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    if (count) await this.emitCount(userId);
  }

  /**
   * Removes the `friend_request` notification of a request that no longer exists (accepted, declined or
   * cancelled), so the client never offers Accept on a dead request.
   */
  async removeFriendRequest(userId: string, requestId: string): Promise<void> {
    const { count } = await this.prisma.notification.deleteMany({
      where: { userId, type: 'friend_request', payload: { path: ['requestId'], equals: requestId } },
    });
    if (count) await this.emitCount(userId);
  }

  private async deliver(userId: string, dto: NotificationDto): Promise<void> {
    this.realtime.emitToUser(userId, 'notification:new', dto);
    await this.emitCount(userId);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { locale: true } });
    const payload = user && pushPayloadFor(dto.type, dto.payload, user.locale);
    if (payload) await this.push.enqueueForUser(userId, payload);
  }

  private async emitCount(userId: string): Promise<void> {
    this.realtime.emitToUser(userId, 'notification:count', { count: await this.unreadCount(userId) });
  }
}
