import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AuthCoreModule } from './common/auth/auth-core.module';
import { ConfigModule } from './config/config.module';
import { ENV, type Env } from './config/env';
import { loggerOptions } from './config/logger';
import { InfraModule } from './infra/infra.module';
import { AdminModule } from './modules/admin/admin.module';
import { AntifraudModule } from './modules/antifraud/antifraud.module';
import { AuthModule } from './modules/auth/auth.module';
import { ChatsModule } from './modules/chats/chats.module';
import { CommunitiesModule } from './modules/communities/communities.module';
import { DemoModule } from './modules/demo/demo.module';
import { FriendsModule } from './modules/friends/friends.module';
import { HealthModule } from './modules/health/health.module';
import { LocationModule } from './modules/location/location.module';
import { MapModule } from './modules/map/map.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PushModule } from './modules/push/push.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { SosModule } from './modules/sos/sos.module';
import { ServicesModule } from './modules/services/services.module';
import { RatingModule } from './modules/rating/rating.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { UsersModule } from './modules/users/users.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({ inject: [ENV], useFactory: (env: Env) => loggerOptions(env) }),
    InfraModule,
    AuthCoreModule,
    AuthModule,
    UsersModule,
    VehiclesModule,
    UploadsModule,
    RealtimeModule,
    PushModule,
    NotificationsModule,
    LocationModule,
    MapModule,
    FriendsModule,
    ChatsModule,
    CommunitiesModule,
    SosModule,
    RatingModule,
    ReviewsModule,
    ReportsModule,
    DemoModule,
    HealthModule,
    ServicesModule,
    AntifraudModule,
    AdminModule,
  ],
})
export class AppModule {}
