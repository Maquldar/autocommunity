import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { paginationQuerySchema, type NotificationDto, type Paginated } from '@autoc/shared';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../common/auth/decorators';
import { IdParam, ZQuery } from '../../common/validation/zod.pipe';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @ZQuery(paginationQuerySchema) query: z.output<typeof paginationQuerySchema>,
  ): Promise<Paginated<NotificationDto>> {
    return this.notifications.list(user.id, query.cursor, query.limit);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthUser): Promise<{ count: number }> {
    return { count: await this.notifications.unreadCount(user.id) };
  }

  // Declared before ':id/read' for readability; the paths can't collide anyway.
  @Post('read-all')
  @HttpCode(204)
  readAll(@CurrentUser() user: AuthUser): Promise<void> {
    return this.notifications.markAllRead(user.id);
  }

  @Post(':id/read')
  @HttpCode(204)
  read(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<void> {
    return this.notifications.markRead(user.id, id);
  }
}
