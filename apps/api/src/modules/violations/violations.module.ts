import { Module } from '@nestjs/common';
import { AntifraudModule } from '../antifraud/antifraud.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RatingModule } from '../rating/rating.module';
import { UsersModule } from '../users/users.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { VehicleViolationsController, ViolationsController } from './violations.controller';
import { ViolationsService } from './violations.service';

/** Phase 9 vehicle violations and the public vehicle detail (API.md §9.4). */
@Module({
  imports: [UsersModule, VehiclesModule, RatingModule, NotificationsModule, AntifraudModule],
  controllers: [VehicleViolationsController, ViolationsController],
  providers: [ViolationsService],
  exports: [ViolationsService],
})
export class ViolationsModule {}
