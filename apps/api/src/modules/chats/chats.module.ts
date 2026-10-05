import { Module } from '@nestjs/common';
import { PushModule } from '../push/push.module';
import { UploadsModule } from '../uploads/uploads.module';
import { UsersModule } from '../users/users.module';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';
import { MessageViewService } from './message-view.service';

@Module({
  imports: [UsersModule, UploadsModule, PushModule],
  controllers: [ChatsController],
  providers: [ChatsService, MessageViewService],
  exports: [ChatsService],
})
export class ChatsModule {}
