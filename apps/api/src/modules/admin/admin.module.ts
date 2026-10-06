import { Module } from '@nestjs/common';
import { AntifraudModule } from '../antifraud/antifraud.module';
import { ChatsModule } from '../chats/chats.module';
import { CommunitiesModule } from '../communities/communities.module';
import { FeedModule } from '../feed/feed.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RatingModule } from '../rating/rating.module';
import { SosModule } from '../sos/sos.module';
import { UsersModule } from '../users/users.module';
import { ViolationsModule } from '../violations/violations.module';
import { VotesModule } from '../votes/votes.module';
import { WalletModule } from '../wallet/wallet.module';
import { AdminAuditService } from './admin-audit.service';
import { AdminController } from './admin.controller';
import { AdminPhase9Controller } from './admin-phase9.controller';
import { AdminPhase9Service } from './admin-phase9.service';
import { AdminModerationService } from './admin-moderation.service';
import { AdminRateLimitGuard } from './admin-rate-limit.guard';
import { AdminServicesService } from './admin-services.service';
import { AdminStatsService } from './admin-stats.service';
import { AdminUsersService } from './admin-users.service';
import { AdminViewService } from './admin-view.service';

/** Phase 6 admin panel API (API.md §6). */
@Module({
  imports: [UsersModule, NotificationsModule, RatingModule, SosModule, ChatsModule, CommunitiesModule, AntifraudModule, FeedModule, WalletModule, VotesModule, ViolationsModule],
  controllers: [AdminController, AdminPhase9Controller],
  providers: [
    AdminViewService,
    AdminAuditService,
    AdminUsersService,
    AdminModerationService,
    AdminServicesService,
    AdminStatsService,
    AdminRateLimitGuard,
    AdminPhase9Service,
  ],
})
export class AdminModule {}
