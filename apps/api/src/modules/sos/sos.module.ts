import { Module } from '@nestjs/common';
import { ChatsModule } from '../chats/chats.module';
import { LocationModule } from '../location/location.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { PublicSosController, SosController, SosMapController } from './sos.controller';
import { SosBroadcastService } from './sos-broadcast.service';
import { SosDispatchService } from './sos-dispatch.service';
import { SosViewService } from './sos-view.service';
import { SosQueue } from './sos.queue';
import { SosService } from './sos.service';

@Module({
  imports: [UsersModule, ChatsModule, NotificationsModule, LocationModule],
  controllers: [SosController, SosMapController, PublicSosController],
  providers: [SosService, SosViewService, SosBroadcastService, SosDispatchService, SosQueue],
})
export class SosModule {}
