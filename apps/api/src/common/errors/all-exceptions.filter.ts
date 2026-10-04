import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ApiErrorBody } from '@autoc/shared';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { ApiException } from './api-exception';

const STATUS_CODES: Partial<Record<number, string>> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'FILE_TOO_LARGE',
  415: 'UNSUPPORTED_FILE_TYPE',
  429: 'RATE_LIMITED',
};

type Rendered = { status: number; body: ApiErrorBody };

function render(status: number, code: string, message: string, details?: unknown): Rendered {
  const error: ApiErrorBody['error'] = { code, message };
  if (details !== undefined) error.details = details;
  return { status, body: { error } };
}

/** Converts anything thrown into the API.md error shape. Unknown errors never leak internals. */
export function toErrorResponse(exception: unknown): Rendered | null {
  if (exception instanceof ApiException) {
    return render(exception.getStatus(), exception.code, exception.message, exception.details);
  }
  if (exception instanceof ZodError) {
    return render(400, 'VALIDATION_ERROR', 'Invalid request', exception.issues);
  }
  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    if (exception.code === 'P2002') return render(409, 'CONFLICT', 'Resource already exists');
    if (exception.code === 'P2025') return render(404, 'NOT_FOUND', 'Not found');
    return null;
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status >= 500) return null;
    return render(status, STATUS_CODES[status] ?? 'ERROR', exception.message);
  }
  // body-parser / http-errors style errors (malformed JSON, payload too large) carry an expose flag.
  if (exception && typeof exception === 'object' && 'status' in exception && 'expose' in exception) {
    const e = exception as { status: number; expose: boolean; message: string; type?: string };
    if (e.expose && e.status >= 400 && e.status < 500) {
      const message = e.type === 'entity.parse.failed' ? 'Malformed JSON body' : e.message;
      return render(e.status, STATUS_CODES[e.status] ?? 'ERROR', message);
    }
  }
  return null;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: unknown }>();

    let rendered = toErrorResponse(exception);
    if (!rendered) {
      this.logger.error({ err: exception, reqId: req.id, url: req.originalUrl }, 'Unhandled error');
      rendered = render(HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL', 'Internal server error');
    }
    if (res.headersSent) return;
    const details = rendered.body.error.details as { retryAfterSec?: number } | undefined;
    if (rendered.status === 429 && details?.retryAfterSec) res.setHeader('Retry-After', String(details.retryAfterSec));
    res.status(rendered.status).json(rendered.body);
  }
}
