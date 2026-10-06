import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { RequestMethod } from '@nestjs/common';
import type { Params } from 'nestjs-pino';
import type { Env } from './env';

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,64}$/;

/** Secrets and personal data never reach the logs. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'phone',
  '*.phone',
  'code',
  '*.code',
  'token',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.idToken',
];

/** Share tokens live in the path (`/public/sos/:token`, web `/s/:token`): keep them out of logs. */
const TOKEN_PATH_RE = /(\/public\/sos\/|\/s\/)[^/?#]+/g;

/** The logged form of a request URL: path only (query strings can carry search text), share tokens redacted. */
export function logUrl(url: string): string {
  return url.split('?')[0]!.replace(TOKEN_PATH_RE, '$1[redacted]');
}

export function loggerOptions(env: Env): Params {
  return {
    // Named wildcard (path-to-regexp v8 syntax); the library default "*" triggers a deprecation warning.
    forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
    pinoHttp: {
      level: env.LOG_LEVEL,
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      // Reuse a sane upstream request id (load balancer) or mint one; echo it back to the client.
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url?.endsWith('/health') ?? false },
      serializers: {
        req: (req: { id: unknown; method: string; url: string; remoteAddress?: string }) => ({
          id: req.id,
          method: req.method,
          url: logUrl(req.url),
          remoteAddress: req.remoteAddress,
        }),
      },
      transport:
        env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } } : undefined,
    },
  };
}
