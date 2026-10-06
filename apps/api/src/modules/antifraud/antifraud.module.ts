import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AntifraudService } from './antifraud.service';
import { SanctionsService } from './sanctions.service';

/** Antifraud v1 triggers and the account sanctions they (and the admin panel) apply. */
@Module({
  imports: [NotificationsModule],
  providers: [AntifraudService, SanctionsService],
  exports: [AntifraudService, SanctionsService],
})
export class AntifraudModule {}
