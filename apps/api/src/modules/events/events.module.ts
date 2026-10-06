import { Module } from '@nestjs/common';
import { ChatsModule } from '../chats/chats.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { CommunityEventsController, EventsController, EventsMapController } from './events.controller';
import { EventsQueue } from './events.queue';
import { EventsService } from './events.service';

@Module({
  imports: [UsersModule, ChatsModule, NotificationsModule],
  controllers: [EventsController, CommunityEventsController, EventsMapController],
  providers: [EventsService, EventsQueue],
  exports: [EventsService],
})
export class EventsModule {}
