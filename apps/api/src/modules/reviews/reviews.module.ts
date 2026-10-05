import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { RatingModule } from '../rating/rating.module';
import { SosModule } from '../sos/sos.module';
import { UsersModule } from '../users/users.module';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [UsersModule, RatingModule, NotificationsModule, SosModule],
  controllers: [ReviewsController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
