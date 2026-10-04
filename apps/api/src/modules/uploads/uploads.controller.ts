import { Controller, HttpCode, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { LIMITS, uploadBodySchema, type UploadBody, type UploadDto } from '@autoc/shared';
import { memoryStorage } from 'multer';
import { CurrentUser, type AuthUser } from '../../common/auth/decorators';
import { Errors } from '../../common/errors/api-exception';
import { ZBody } from '../../common/validation/zod.pipe';
import { UploadsService } from './uploads.service';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  @HttpCode(201)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      // Hard cap = largest allowed kind; per-purpose limits are enforced after type detection.
      limits: { fileSize: LIMITS.videoMaxBytes, files: 1, fields: 5, fieldSize: 1024, parts: 7 },
    }),
  )
  async upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @ZBody(uploadBodySchema) body: UploadBody,
  ): Promise<UploadDto> {
    if (!file) throw Errors.validation('Invalid request', [{ path: ['file'], message: 'File is required' }]);
    return this.uploads.create(user.id, body.purpose, file.buffer, body.durationSec);
  }
}
