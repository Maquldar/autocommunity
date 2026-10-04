import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Env } from './config/env';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { CSRF_HEADER } from './common/http/auth-cookies';
import { LocalStorage } from './infra/storage/local-storage';
import { Storage } from './infra/storage/storage';

export const API_PREFIX = 'api/v1';

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
  app.use(cookieParser());
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
