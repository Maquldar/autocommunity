import { Module } from '@nestjs/common';
import { AntifraudModule } from '../antifraud/antifraud.module';
import { ChatsModule } from '../chats/chats.module';
import { FeedModule } from '../feed/feed.module';
import { SosModule } from '../sos/sos.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [ChatsModule, SosModule, AntifraudModule, FeedModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
