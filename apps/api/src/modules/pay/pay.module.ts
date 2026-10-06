import { Module } from '@nestjs/common';
import { AdminRateLimitGuard } from '../admin/admin-rate-limit.guard';
import { NotificationsModule } from '../notifications/notifications.module';
import { WalletModule } from '../wallet/wallet.module';
import { AdminPayController, PayController } from './pay.controller';
import { PayService } from './pay.service';

/** Phase 10 — "Оплата на точке": partner points, price lists, orders, payTags (API.md §11). */
@Module({
  imports: [WalletModule, NotificationsModule],
  controllers: [PayController, AdminPayController],
  providers: [PayService, AdminRateLimitGuard],
})
export class PayModule {}
