import { Module } from '@nestjs/common';
import { UploadStreamInterceptor } from './upload-stream.interceptor';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  controllers: [UploadsController],
  providers: [UploadsService, UploadStreamInterceptor],
  exports: [UploadsService],
})
export class UploadsModule {}
