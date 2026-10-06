import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { LIMITS, uploadPurposeSchema } from '@autoc/shared';
import type { Request, Response } from 'express';
import multer, { memoryStorage, MulterError } from 'multer';
import { finalize, type Observable } from 'rxjs';
import type { AuthedRequest } from '../../common/auth/decorators';
import { Errors } from '../../common/errors/api-exception';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RateLimiterService } from '../../infra/rate-limit/rate-limiter.service';
import { RedisService } from '../../infra/redis/redis.service';
import { maxBytesFor, mediaKindFor } from './media-processor';

export const UPLOADS_PER_HOUR = 60;
/** Uploads one user may have in flight at once (the rest → 429). */
export const UPLOADS_IN_FLIGHT_MAX = 2;
/** Bytes one user may upload in a rolling 24 h (→ 429 once reached). */
export const UPLOAD_DAILY_BYTES = 300 * 1024 * 1024;
/** The in-flight counter expires on its own if a process died mid-upload. */
const IN_FLIGHT_TTL_SEC = 300;
const DAY_MS = 24 * 3600 * 1000;

/**
 * Runs before the multipart body is read: charges the per-user upload rate limit, the in-flight slot and
 * the daily byte quota, then streams the file into memory with a hard cap. With `?purpose=` the cap is
 * that kind's limit (10 MB images, 5 MB voice, 50 MB video); without it the image cap applies (send
 * `?purpose=video` / `voice` for those).
 */
@Injectable()
export class UploadStreamInterceptor implements NestInterceptor {
  constructor(
    private readonly rateLimiter: RateLimiterService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const userId = req.user!.id;

    let maxBytes: number = LIMITS.imageMaxBytes;
    if (req.query.purpose !== undefined) {
      const parsed = uploadPurposeSchema.safeParse({ purpose: req.query.purpose });
      if (!parsed.success) throw Errors.validation('Invalid request', parsed.error.issues);
      maxBytes = maxBytesFor(mediaKindFor(parsed.data.purpose));
    }

    await this.rateLimiter.consumeOrThrow([{ key: `upload:user:${userId}`, limit: UPLOADS_PER_HOUR, windowSec: 3600 }]);
    const used = await this.usedToday(userId);
    if (used.bytes >= UPLOAD_DAILY_BYTES) throw Errors.rateLimited(used.retryAfterSec);

    const slotKey = `upload:inflight:${userId}`;
    const inFlight = await this.redis.multi().incr(slotKey).expire(slotKey, IN_FLIGHT_TTL_SEC).exec();
    const count = Number(inFlight?.[0]?.[1] ?? 0);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      void this.redis.decr(slotKey).catch(() => undefined);
    };
    if (count > UPLOADS_IN_FLIGHT_MAX) {
      release();
      throw Errors.rateLimited(5);
    }
    try {
      await parseMultipart(req, res, maxBytes);
      const size = (req as Request & { file?: Express.Multer.File }).file?.size ?? 0;
      if (used.bytes + size > UPLOAD_DAILY_BYTES) throw Errors.rateLimited(used.retryAfterSec);
    } catch (err) {
      release();
      throw err;
    }
    return next.handle().pipe(finalize(release));
  }

  /** Bytes stored by the user in the last 24 h, and when the oldest of them leaves the window. */
  private async usedToday(userId: string): Promise<{ bytes: number; retryAfterSec: number }> {
    const since = new Date(Date.now() - DAY_MS);
    const [row] = await this.prisma.$queryRaw<{ bytes: bigint | null; oldest: Date | null }[]>`
      SELECT sum(size_bytes)::bigint AS bytes, min(created_at) AS oldest FROM uploads WHERE owner_id = ${userId}::uuid AND created_at > ${since}`;
    const bytes = Number(row?.bytes ?? 0);
    const retryAfterSec = row?.oldest ? Math.max(1, Math.ceil((row.oldest.getTime() + DAY_MS - Date.now()) / 1000)) : 1;
    return { bytes, retryAfterSec };
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
