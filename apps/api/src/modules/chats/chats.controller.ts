import { Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import {
  directChatSchema,
  paginationQuerySchema,
  sendMessageSchema,
  type ChatDto,
  type MessageDto,
  type Paginated,
  type SendMessageInput,
} from '@autoc/shared';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../common/auth/decorators';
import { RequireOnboarded } from '../../common/auth/onboarded.guard';
import { IdParam, ZBody, ZQuery } from '../../common/validation/zod.pipe';
import { ChatsService } from './chats.service';

type PageQuery = z.output<typeof paginationQuerySchema>;

@Controller('chats')
export class ChatsController {
  constructor(private readonly chats: ChatsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @ZQuery(paginationQuerySchema) q: PageQuery): Promise<Paginated<ChatDto>> {
    return this.chats.list(user.id, q.cursor, q.limit);
  }

  @RequireOnboarded()
  @Post('direct')
  @HttpCode(200)
  direct(@CurrentUser() user: AuthUser, @ZBody(directChatSchema) body: z.output<typeof directChatSchema>): Promise<ChatDto> {
    return this.chats.direct(user.id, body.userId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<ChatDto> {
    return this.chats.get(user.id, id);
  }

  @Get(':id/messages')
  messages(@CurrentUser() user: AuthUser, @IdParam() id: string, @ZQuery(paginationQuerySchema) q: PageQuery): Promise<Paginated<MessageDto>> {
    return this.chats.listMessages(user.id, id, q.cursor, q.limit);
  }

  @RequireOnboarded()
  @Post(':id/messages')
  send(@CurrentUser() user: AuthUser, @IdParam() id: string, @ZBody(sendMessageSchema) body: SendMessageInput): Promise<MessageDto> {
    return this.chats.send(user.id, id, body);
  }

  @Post(':id/read')
  @HttpCode(204)
  read(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<void> {
    return this.chats.markRead(user.id, id);
  }

  @Delete(':id/messages/:messageId')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @IdParam() id: string, @IdParam('messageId') messageId: string): Promise<void> {
    return this.chats.deleteMessage(user.id, id, messageId);
  }
}
