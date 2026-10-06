import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { CommentsController, FeedController, PostsController } from './feed.controller';
import { FeedService } from './feed.service';

@Module({
  imports: [UsersModule, NotificationsModule],
  controllers: [FeedController, PostsController, CommentsController],
  providers: [FeedService],
  exports: [FeedService],
})
export class FeedModule {}
