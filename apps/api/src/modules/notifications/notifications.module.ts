import { Module } from '@nestjs/common';
import { PushModule } from '../push/push.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsRetentionService } from './notifications-retention.service';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [PushModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsRetentionService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
