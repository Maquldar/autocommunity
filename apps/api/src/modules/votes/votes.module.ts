import { Module } from '@nestjs/common';
import { AntifraudModule } from '../antifraud/antifraud.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RatingModule } from '../rating/rating.module';
import { VotesController } from './votes.controller';
import { VotesService } from './votes.service';

/** Phase 9 driver votes (API.md §9.3). */
@Module({
  imports: [RatingModule, NotificationsModule, AntifraudModule],
  controllers: [VotesController],
  providers: [VotesService],
  exports: [VotesService],
})
export class VotesModule {}
