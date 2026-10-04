import { Controller, HttpCode, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { uploadBodySchema, type UploadDto } from '@autoc/shared';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../../common/auth/decorators';
import { Errors } from '../../common/errors/api-exception';
import { ZodValidationPipe } from '../../common/validation/zod.pipe';
import { UploadStreamInterceptor } from './upload-stream.interceptor';
import { UploadsService } from './uploads.service';

const bodyPipe = new ZodValidationPipe(uploadBodySchema);

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /** `purpose` from `?purpose=` (preferred, takes precedence) or the multipart field. */
  @Post()
  @HttpCode(201)
  @UseInterceptors(UploadStreamInterceptor)
  async upload(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<UploadDto> {
    const fields = (req.body ?? {}) as Record<string, unknown>;
    const body = bodyPipe.transform({ ...fields, purpose: req.query.purpose ?? fields.purpose });
    if (!file) throw Errors.validation('Invalid request', [{ path: ['file'], message: 'File is required' }]);
    return this.uploads.create(user.id, body.purpose, file.buffer, body.durationSec);
  }
}
