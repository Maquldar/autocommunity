import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const apiURL = process.env.E2E_API_URL ?? 'http://localhost:4000';
// Pre-installed Chromium in CI/sandbox images; set PW_CHROMIUM_PATH='' to use Playwright's own download.
const executablePath = process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const launchOptions = executablePath ? { executablePath } : {};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 390, height: 844 },
        browserName: 'chromium',
        launchOptions,
      },
    },
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        browserName: 'chromium',
        launchOptions,
      },
    },
  ],
  // Both servers must be built first: `pnpm --filter @autoc/api build && pnpm --filter @autoc/web build`.
  // The API needs Postgres + Redis and apps/api/.env with SMS_PROVIDER=console, AUTH_EXPOSE_DEV_CODE=true
  // (the specs read the one-time code from the dev hint). Already-running servers are reused — start a
  // reused API with TRUST_PROXY=loopback too.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: 'pnpm --filter @autoc/api start',
          // The specs present distinct X-Forwarded-For client IPs (TEST-NET) so repeated runs don't hit the
          // per-IP OTP limit (20/h); that needs the API to trust the loopback proxy hop.
          env: { TRUST_PROXY: 'loopback' },
          url: `${apiURL}/api/v1/health`,
          reuseExistingServer: true,
          timeout: 120_000,
        },
        {
          command: 'pnpm start',
          url: baseURL,
          reuseExistingServer: true,
          timeout: 120_000,
        },
      ],
});
