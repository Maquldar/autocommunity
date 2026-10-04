import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const optionalString = z.string().trim().optional();

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    /** Comma-separated list of allowed browser origins (CORS with credentials). */
    WEB_ORIGIN: z
      .string()
      .default('http://localhost:3000')
      .transform((v) => v.split(',').map((o) => o.trim()).filter(Boolean))
      .pipe(z.array(z.url()).min(1)),
    /** Express "trust proxy" setting: a hop count, `true`/`false`, or a list of subnets/names. */
    TRUST_PROXY: z.string().default('loopback, linklocal, uniquelocal'),

    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url().default('redis://localhost:6379'),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    OTP_SECRET: z.string().min(32, 'OTP_SECRET must be at least 32 characters'),
    COOKIE_SECURE: bool.optional(),
    COOKIE_DOMAIN: optionalString,

    SMS_PROVIDER: z.enum(['console', 'twilio']).default('console'),
    AUTH_EXPOSE_DEV_CODE: bool.default(false),
    OTP_GLOBAL_PER_HOUR: z.coerce.number().int().min(1).default(2000),
    TWILIO_ACCOUNT_SID: optionalString,
    TWILIO_AUTH_TOKEN: optionalString,
    /** Sender number in E.164, or a Messaging Service SID (MG…). */
    TWILIO_FROM: optionalString,

    GOOGLE_CLIENT_ID: optionalString,
    APPLE_CLIENT_ID: optionalString,
    APPLE_REDIRECT_URI: optionalString,

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    UPLOAD_DIR: z.string().default('./uploads-data'),
    /** Base URL files are served from, without trailing slash (e.g. http://localhost:4000/media). */
    PUBLIC_MEDIA_URL: z
      .string()
      .url()
      .transform((v) => v.replace(/\/+$/, '')),
    S3_ENDPOINT: optionalString,
    S3_REGION: z.string().default('auto'),
    S3_BUCKET: optionalString,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    S3_FORCE_PATH_STYLE: bool.default(true),
  })
  .superRefine((env, ctx) => {
    const need = (keys: (keyof typeof env)[], when: string) => {
      for (const key of keys) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when ${when}` });
      }
    };
    if (env.SMS_PROVIDER === 'twilio') need(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'], 'SMS_PROVIDER=twilio');
    if (env.STORAGE_DRIVER === 's3') need(['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'], 'STORAGE_DRIVER=s3');
    if (env.APPLE_CLIENT_ID) need(['APPLE_REDIRECT_URI'], 'APPLE_CLIENT_ID is set');
    if (env.NODE_ENV === 'production' && env.AUTH_EXPOSE_DEV_CODE) {
      ctx.addIssue({ code: 'custom', path: ['AUTH_EXPOSE_DEV_CODE'], message: 'must not be enabled in production' });
    }
  });

export type Env = z.output<typeof envSchema>;

export const ENV = Symbol('ENV');

/** Loads `.env` from the working directory without overriding variables already set. */
export function loadDotEnv(file = resolve(process.cwd(), '.env')): void {
  if (!existsSync(file)) return;
  const parsed = parseEnv(readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** Validates the environment; throws with every problem listed so boot fails fast. */
export function parseEnvOrThrow(source: NodeJS.ProcessEnv = process.env): Env {
  // `KEY=` in a .env file means "unset", not an empty value.
  const defined = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ''));
  const result = envSchema.safeParse(defined);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}

export const isCookieSecure = (env: Env): boolean => env.COOKIE_SECURE ?? env.NODE_ENV === 'production';

export const isDevOtpExposed = (env: Env): boolean => env.SMS_PROVIDER === 'console' && env.AUTH_EXPOSE_DEV_CODE;
