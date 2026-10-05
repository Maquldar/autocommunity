import { Module } from '@nestjs/common';
import { MyRatingController, UserRatingController } from './rating.controller';
import { RatingDailyService } from './rating-daily.service';
import { RatingService } from './rating.service';

@Module({
  controllers: [MyRatingController, UserRatingController],
  providers: [RatingService, RatingDailyService],
  exports: [RatingService],
})
export class RatingModule {}
