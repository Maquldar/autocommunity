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
      // Bare hosts (e.g. Render's `fromService.host`) are treated as https origins.
      .transform((v) => v.split(',').map((o) => withScheme(o.trim())).filter(Boolean))
      .pipe(z.array(z.url()).min(1)),
    /**
     * Express "trust proxy": `false` (default: req.ip is the socket peer), a hop count, or subnets/names.
     * Behind a load balancer set the exact hop count, otherwise clients can spoof X-Forwarded-For.
     */
    TRUST_PROXY: z.string().default('false'),

    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url().default('redis://localhost:6379'),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    OTP_SECRET: z.string().min(32, 'OTP_SECRET must be at least 32 characters'),
    COOKIE_SECURE: bool.optional(),
    COOKIE_DOMAIN: optionalString,

    SMS_PROVIDER: z.enum(['console', 'twilio']).default('console'),
    AUTH_EXPOSE_DEV_CODE: bool.default(false),
    OTP_GLOBAL_PER_HOUR: z.coerce.number().int().min(1).default(2000),
    /** Country prefixes OTP SMS may be sent to (toll-fraud protection), comma-separated E.164 prefixes. */
    OTP_ALLOWED_PREFIXES: z
      .string()
      .default('+7')
      .transform((v) => v.split(',').map((p) => p.trim()).filter(Boolean))
      .pipe(z.array(z.string().regex(/^\+\d{1,6}$/, 'prefixes look like +7 or +77')).min(1)),
    /** Explicit opt-in to the console SMS sender in production (codes would only be logged). */
    ALLOW_CONSOLE_SMS: bool.default(false),
    /**
     * Public portfolio demo without an SMS provider: login codes are shown on screen, console SMS is
     * allowed in production and the demo seed runs on an empty database. Never enable for real users.
     */
    DEMO_MODE: bool.default(false),
    TWILIO_ACCOUNT_SID: optionalString,
    TWILIO_AUTH_TOKEN: optionalString,
    /** Sender number in E.164, or a Messaging Service SID (MG…). */
    TWILIO_FROM: optionalString,

    GOOGLE_CLIENT_ID: optionalString,
    APPLE_CLIENT_ID: optionalString,
    APPLE_REDIRECT_URI: optionalString,

    /** `postgres` keeps files in the database: for hosts without a persistent disk (demo deployments). */
    STORAGE_DRIVER: z.enum(['local', 's3', 'postgres']).default('local'),
    UPLOAD_DIR: z.string().default('./uploads-data'),
    /** Base URL files are served from, without trailing slash (e.g. http://localhost:4000/media). */
    PUBLIC_MEDIA_URL: z
      .string()
      .url()
      .transform((v) => v.replace(/\/+$/, ''))
      .optional(),
    S3_ENDPOINT: optionalString,
    S3_REGION: z.string().default('auto'),
    S3_BUCKET: optionalString,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    S3_FORCE_PATH_STYLE: bool.default(true),

    /** Web Push VAPID keys. When unset, a key pair is generated once and stored in `app_settings`. */
    VAPID_PUBLIC_KEY: optionalString,
    VAPID_PRIVATE_KEY: optionalString,
    /** `mailto:` or `https:` contact sent to push services. */
    VAPID_SUBJECT: z
      .string()
      .trim()
      .regex(/^(mailto:|https:\/\/)/, 'VAPID_SUBJECT must start with mailto: or https://')
      .default('mailto:support@autocommunity.app'),
    /** Moves seeded users along small loops every 60 s so the demo map stays populated. Defaults to DEMO_MODE. */
    DEMO_LIVE_LOCATIONS: bool.optional(),
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
    if (env.VAPID_PUBLIC_KEY || env.VAPID_PRIVATE_KEY) need(['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'], 'either VAPID key is set');
    if (env.NODE_ENV === 'production' && env.SMS_PROVIDER === 'console' && !env.ALLOW_CONSOLE_SMS && !env.DEMO_MODE) {
      ctx.addIssue({ code: 'custom', path: ['SMS_PROVIDER'], message: 'console SMS in production requires ALLOW_CONSOLE_SMS=true' });
    }
    if (env.NODE_ENV === 'production' && env.AUTH_EXPOSE_DEV_CODE && !env.DEMO_MODE) {
      ctx.addIssue({ code: 'custom', path: ['AUTH_EXPOSE_DEV_CODE'], message: 'must not be enabled in production' });
    }
  });

type ParsedEnv = z.output<typeof envSchema>;
export type Env = Omit<ParsedEnv, 'PUBLIC_MEDIA_URL' | 'DEMO_LIVE_LOCATIONS'> & {
  PUBLIC_MEDIA_URL: string;
  DEMO_LIVE_LOCATIONS: boolean;
};

function withScheme(value: string): string {
  return value === '' || /^[a-z]+:\/\//i.test(value) ? value : `https://${value}`;
}

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
  // PaaS hosts (Render, Heroku) assign the port through PORT.
  if (!defined.API_PORT && defined.PORT) defined.API_PORT = defined.PORT;
  const result = envSchema.safeParse(defined);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const env = result.data;
  // Behind a same-origin proxy the web app serves /media too, so the first web origin is the default.
  return {
    ...env,
    PUBLIC_MEDIA_URL: env.PUBLIC_MEDIA_URL ?? `${env.WEB_ORIGIN[0]}/media`,
    DEMO_LIVE_LOCATIONS: env.DEMO_LIVE_LOCATIONS ?? env.DEMO_MODE,
  };
}

export const isCookieSecure = (env: Env): boolean => env.COOKIE_SECURE ?? env.NODE_ENV === 'production';

export const isDevOtpExposed = (env: Env): boolean =>
  env.SMS_PROVIDER === 'console' && (env.AUTH_EXPOSE_DEV_CODE || env.DEMO_MODE);
