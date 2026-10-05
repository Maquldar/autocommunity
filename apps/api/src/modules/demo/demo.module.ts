import { Module } from '@nestjs/common';
import { DemoLiveLocationsService } from './demo-live-locations.service';

@Module({
  providers: [DemoLiveLocationsService],
  exports: [DemoLiveLocationsService],
})
export class DemoModule {}
