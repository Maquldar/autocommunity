import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { AntifraudModule } from '../antifraud/antifraud.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { DemoPaymentProvider, PaymentProvider } from './payment-provider';
import { PremiumRenewalService } from './premium-renewal.service';
import { PremiumService } from './premium.service';
import { PremiumController, WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

/** Phase 9: coin wallet, top-ups, transfers, premium (API.md §9.1–9.2). */
@Module({
  imports: [UsersModule, NotificationsModule, AntifraudModule],
  controllers: [WalletController, PremiumController],
  providers: [
    { provide: PaymentProvider, inject: [ENV], useFactory: (env: Env) => new DemoPaymentProvider(env.WEB_ORIGIN[0]!) },
    WalletService,
    PremiumService,
    PremiumRenewalService,
  ],
  exports: [WalletService, PremiumService],
})
export class WalletModule {}
