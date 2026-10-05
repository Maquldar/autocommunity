import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module';
import { UsersModule } from '../users/users.module';
import { ServiceReviewsService } from './reviews.service';
import { ServicesController, ServicesMapController } from './services.controller';
import { ServicesService } from './services.service';
import { VisitsService } from './visits.service';

/** Phase 7 — service-center catalog, visit verification and reviews (API.md §7). */
@Module({
  imports: [UploadsModule, UsersModule],
  controllers: [ServicesController, ServicesMapController],
  providers: [ServicesService, VisitsService, ServiceReviewsService],
})
export class ServicesModule {}
