import { Module } from '@nestjs/common';
import { AntifraudModule } from '../antifraud/antifraud.module';
import { LocationController } from './location.controller';
import { LocationService } from './location.service';

@Module({
  imports: [AntifraudModule],
  controllers: [LocationController],
  providers: [LocationService],
  exports: [LocationService],
})
export class LocationModule {}
