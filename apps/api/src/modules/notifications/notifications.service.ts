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
