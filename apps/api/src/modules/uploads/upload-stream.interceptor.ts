import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { LIMITS, uploadPurposeSchema } from '@autoc/shared';
import type { Request, Response } from 'express';
import multer, { memoryStorage, MulterError } from 'multer';
import type { Observable } from 'rxjs';
import type { AuthedRequest } from '../../common/auth/decorators';
import { Errors } from '../../common/errors/api-exception';
import { RateLimiterService } from '../../infra/rate-limit/rate-limiter.service';
import { maxBytesFor, mediaKindFor } from './media-processor';

export const UPLOADS_PER_HOUR = 60;

/**
 * Runs before the multipart body is read: charges the per-user upload rate limit, then streams the file
 * into memory with a hard cap. When `?purpose=` is given the cap is that kind's limit (10 MB images,
 * 5 MB voice); otherwise the largest limit applies and the per-kind check happens after parsing.
 */
@Injectable()
export class UploadStreamInterceptor implements NestInterceptor {
  constructor(private readonly rateLimiter: RateLimiterService) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();

    let maxBytes: number = LIMITS.videoMaxBytes;
    if (req.query.purpose !== undefined) {
      const parsed = uploadPurposeSchema.safeParse({ purpose: req.query.purpose });
      if (!parsed.success) throw Errors.validation('Invalid request', parsed.error.issues);
      maxBytes = maxBytesFor(mediaKindFor(parsed.data.purpose));
    }

    await this.rateLimiter.consumeOrThrow([{ key: `upload:user:${req.user!.id}`, limit: UPLOADS_PER_HOUR, windowSec: 3600 }]);
    await parseMultipart(req, res, maxBytes);
    return next.handle();
  }
}

function parseMultipart(req: Request, res: Response, maxBytes: number): Promise<void> {
  const parser = multer({
    storage: memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 5, fieldSize: 1024, parts: 7 },
  }).single('file');
  return new Promise((resolve, reject) =>
    parser(req, res, (err: unknown) => {
      if (!err) return resolve();
      if (err instanceof MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return reject(Errors.payloadTooLarge(`File exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`));
        return reject(Errors.validation('Invalid multipart body', [{ path: [err.field ?? 'file'], message: err.message }]));
      }
      reject(Errors.validation('Invalid multipart body'));
    }),
  );
}
