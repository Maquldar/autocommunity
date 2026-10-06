import { Module } from '@nestjs/common';
import { UploadStreamInterceptor } from './upload-stream.interceptor';
import { UploadsCleanupService } from './uploads-cleanup.service';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  controllers: [UploadsController],
  providers: [UploadsService, UploadStreamInterceptor, UploadsCleanupService],
  exports: [UploadsService],
})
export class UploadsModule {}
