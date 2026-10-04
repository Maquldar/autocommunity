import type { NestApplicationOptions } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import type { Env } from './config/env';
import { Errors } from './common/errors/api-exception';
import { AllExceptionsFilter, internalError, sendError, toErrorResponse } from './common/errors/all-exceptions.filter';
import { CSRF_HEADER } from './common/http/auth-cookies';
import { LocalStorage } from './infra/storage/local-storage';
import { Storage } from './infra/storage/storage';

export const API_PREFIX = 'api/v1';
export const JSON_BODY_LIMIT = '100kb';

/**
 * Nest's default parsers are off: only JSON bodies (and multipart on upload routes) are accepted, so a
 * cross-site HTML form (urlencoded / text/plain) can never reach a handler as a parsed body.
 */
export const APP_OPTIONS: NestApplicationOptions = { bodyParser: false };

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Rejects state-changing requests sent by browsers from origins that aren't allow-listed. */
function originGuard(allowed: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin !== undefined && UNSAFE_METHODS.has(req.method) && !allowed.includes(origin)) {
      sendError(res, toErrorResponse(Errors.forbidden('Origin not allowed', 'ORIGIN_NOT_ALLOWED'))!);
      return;
    }
    next();
  };
}

/** Body-parser errors happen before Nest's pipeline; render them in the API error shape. */
function bodyParserErrors(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  sendError(res, toErrorResponse(err) ?? internalError());
}

function parseTrustProxy(value: string): boolean | number | string {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

/** HTTP pipeline shared by main.ts and the integration tests. */
export function configureApp(app: NestExpressApplication, env: Env): void {
  app.set('trust proxy', parseTrustProxy(env.TRUST_PROXY));
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(originGuard(env.WEB_ORIGIN));
  app.use(cookieParser());
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.use(bodyParserErrors);
  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', CSRF_HEADER, 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 600,
  });
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  const storage = app.get(Storage);
  if (storage instanceof LocalStorage) {
    // Object keys are random and never rewritten, so files are immutable.
    app.useStaticAssets(storage.root, {
      prefix: '/media/',
      index: false,
      redirect: false,
      dotfiles: 'deny',
      immutable: true,
      maxAge: '365d',
      setHeaders: (res) => {
        // Media is embedded by the web app from another origin.
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      },
    });
  }
}
