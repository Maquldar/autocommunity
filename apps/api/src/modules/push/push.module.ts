import { Module } from '@nestjs/common';
import { PushDeliveryService } from './push-delivery.service';
import { PushController } from './push.controller';
import { PushQueue } from './push.queue';
import { PushService } from './push.service';
import { VapidService } from './vapid.service';
import { WebPushSender } from './web-push.sender';

@Module({
  controllers: [PushController],
  providers: [PushService, VapidService, WebPushSender, PushDeliveryService, PushQueue],
  exports: [PushQueue, VapidService],
})
export class PushModule {}
