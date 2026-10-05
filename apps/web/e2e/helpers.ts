import { expect, type BrowserContext, type Page } from '@playwright/test';

export const API_URL = (process.env.E2E_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
const API = `${API_URL}/api/v1`;
const WEB_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

/** A fresh Kazakhstan mobile number (+7 707 XXX XX XX) per call, so runs never collide. */
export function randomPhone(): string {
  return `+7707${String(rand(0, 9_999_999)).padStart(7, '0')}`;
}

export function randomNickname(prefix = 'e2e'): string {
  return `${prefix}_${Date.now().toString(36)}${rand(100, 999)}`;
}

/**
 * The API rate-limits OTP requests per IP (20/h). The API trusts X-Forwarded-For from loopback, so
 * each test presents its own TEST-NET address and repeated runs don't exhaust the limit.
 */
export function testIp(): string {
  return `198.18.${rand(0, 255)}.${rand(1, 254)}`;
}

export async function useTestIp(page: Page, ip = testIp()): Promise<string> {
  await page.route(`${API}/**`, (route) =>
    route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': ip } }),
  );
  return ip;
}

/** English UI for stable selectors (the app defaults to Russian). */
export async function useEnglish(context: BrowserContext): Promise<void> {
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: WEB_URL }]);
}

/**
 * Creates an onboarded user through the API with the page's cookie jar (page.request shares it),
 * so the app restores the session via /auth/refresh on the next navigation.
 */
export async function signUpViaApi(page: Page, name = 'E2E Driver'): Promise<{ phone: string; nickname: string }> {
  const phone = randomPhone();
  const nickname = randomNickname();
  const headers = { 'x-forwarded-for': testIp(), origin: WEB_URL };

  const requested = await page.request.post(`${API}/auth/otp/request`, { data: { phone }, headers });
  expect(requested.ok(), await requested.text()).toBeTruthy();
  const { devCode } = (await requested.json()) as { devCode?: string };
  expect(devCode, 'API must run with SMS_PROVIDER=console and AUTH_EXPOSE_DEV_CODE=true').toBeTruthy();

  const verified = await page.request.post(`${API}/auth/otp/verify`, { data: { phone, code: devCode }, headers });
  expect(verified.ok(), await verified.text()).toBeTruthy();
  const { accessToken } = (await verified.json()) as { accessToken: string };
  const auth = { ...headers, authorization: `Bearer ${accessToken}` };

  const updated = await page.request.patch(`${API}/me`, { data: { name, nickname, city: 'Almaty' }, headers: auth });
  expect(updated.ok(), await updated.text()).toBeTruthy();
  const completed = await page.request.post(`${API}/me/onboarding/complete`, { headers: auth });
  expect(completed.ok(), await completed.text()).toBeTruthy();
  return { phone, nickname };
}

/** Types a phone number into the login form and requests a code; returns the dev code from the hint. */
export async function requestCodeInUi(page: Page, phone: string): Promise<string> {
  await page.getByLabel('Phone number').fill(phone.slice(2));
  const submit = page.getByRole('button', { name: 'Get code', exact: true });
  const hint = page.getByTestId('dev-code');
  const rateLimited = page.getByText(/Too many attempts/);
  await submit.click();
  await expect(hint.or(rateLimited)).toBeVisible();
  if (await rateLimited.isVisible()) {
    // Re-requesting a code for the same number within 60 s is rate-limited: the form counts down,
    // then lets the user try again.
    await expect(submit).toBeEnabled({ timeout: 75_000 });
    await submit.click();
  }
  await expect(hint).toHaveText(/^\d{6}$/);
  return (await hint.textContent())!.trim();
}

/** Types the code into the OTP boxes (the form submits itself on the 6th digit). */
export async function enterCode(page: Page, code: string): Promise<void> {
  await page.getByRole('group', { name: 'Verification code' }).getByRole('textbox').first().click();
  await page.keyboard.type(code);
}

export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Signs in through the login form (code from the dev hint) and waits for the home route. */
export async function signInInUi(page: Page, phone: string): Promise<void> {
  await page.goto('/login');
  const code = await requestCodeInUi(page, phone);
  await enterCode(page, code);
  await expect(page).toHaveURL(/\/map$/, { timeout: 20_000 });
}

/** Counts navigator.geolocation.watchPosition calls (window.__geoWatchCalls), installed before any page script. */
export async function trackGeolocation(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __geoWatchCalls: number };
    w.__geoWatchCalls = 0;
    const geo = navigator.geolocation;
    if (!geo) return;
    const original = geo.watchPosition.bind(geo);
    geo.watchPosition = (...args: Parameters<Geolocation['watchPosition']>) => {
      w.__geoWatchCalls += 1;
      return original(...args);
    };
  });
}

export async function geolocationWatchCalls(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __geoWatchCalls: number }).__geoWatchCalls);
}
