import { tmpdir } from 'node:os';
import { join } from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC emits decorator metadata, which Nest's dependency injection relies on (esbuild does not).
const plugins = [swc.vite({ module: { type: 'es6' } })];

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://autoc:autoc@localhost:5432/autoc_test';

export default defineConfig({
  test: {
    projects: [
      {
        plugins,
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts'],
          environment: 'node',
        },
      },
      {
        plugins,
        test: {
          name: 'integration',
          include: ['test/**/*.int.spec.ts'],
          environment: 'node',
          globalSetup: ['test/support/global-setup.ts'],
          setupFiles: ['test/support/setup-file.ts'],
          // One database and one Redis db are shared, so files run one at a time.
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 20_000,
          hookTimeout: 60_000,
          env: {
            NODE_ENV: 'test',
            LOG_LEVEL: 'silent',
            DATABASE_URL: TEST_DATABASE_URL,
            REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
            PRISMA_COUNT_QUERIES: '1',
            JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret-0123456789',
            OTP_SECRET: 'test-otp-secret-test-otp-secret-0123456789abcdef',
            SMS_PROVIDER: 'console',
            AUTH_EXPOSE_DEV_CODE: 'true',
            WEB_ORIGIN: 'http://localhost:3000',
            STORAGE_DRIVER: 'local',
            UPLOAD_DIR: join(tmpdir(), 'autoc-api-test-uploads'),
            PUBLIC_MEDIA_URL: 'http://localhost:4000/media',
            // Explicit: lets tests vary the client IP via X-Forwarded-For (default is false).
            TRUST_PROXY: 'loopback',
            GOOGLE_CLIENT_ID: '',
            APPLE_CLIENT_ID: '',
            // Explicit so values from apps/api/.env (which Prisma loads into process.env) can't leak in.
            DEMO_MODE: 'false',
            DEMO_LIVE_LOCATIONS: 'false',
            VAPID_PUBLIC_KEY: '',
            VAPID_PRIVATE_KEY: '',
          },
        },
      },
    ],
  },
});
