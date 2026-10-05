import { Logger, type NestApplicationOptions } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import type { Env } from './config/env';
import { Errors } from './common/errors/api-exception';
import { AllExceptionsFilter, internalError, sendError, toErrorResponse } from './common/errors/all-exceptions.filter';
import { CSRF_HEADER } from './common/http/auth-cookies';
import { LocalStorage } from './infra/storage/local-storage';
import { PostgresStorage } from './infra/storage/postgres-storage';
import { Storage } from './infra/storage/storage';
import { RedisIoAdapter } from './modules/realtime/redis-io.adapter';

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

/** Logs the resolved client IP of the first request once (debug), to verify TRUST_PROXY after a deploy. */
function logFirstClientIp() {
  let logged = false;
  const logger = new Logger('TrustProxy');
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!logged) {
      logged = true;
      logger.debug({ ip: req.ip, forwardedFor: req.headers['x-forwarded-for'] ?? null, socket: req.socket.remoteAddress }, 'First request client IP');
    }
    next();
  };
}

/** HTTP pipeline shared by main.ts and the integration tests. */
export function configureApp(app: NestExpressApplication, env: Env): void {
  app.set('trust proxy', parseTrustProxy(env.TRUST_PROXY));
  app.disable('x-powered-by');
  app.use(logFirstClientIp());
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
  // Socket.IO (/rt) on the same HTTP server, outside the /api/v1 prefix (path /socket.io).
  app.useWebSocketAdapter(new RedisIoAdapter(app, env));
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
  } else if (storage instanceof PostgresStorage) {
    app.use('/media', (req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      storage
        .get(decodeURIComponent(req.path.replace(/^\/+/, '')))
        .then((file) => {
          if (!file) {
            res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });
            return;
          }
          res.setHeader('Content-Type', file.contentType);
          res.setHeader('Content-Length', String(file.body.length));
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
          res.end(req.method === 'HEAD' ? undefined : file.body);
        })
        .catch(next);
    });
  }
}
