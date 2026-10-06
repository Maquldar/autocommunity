#!/usr/bin/env node
// Phase 10 "Оплата на точке" screenshots for docs/screenshots/pay (390×844 @2x, Russian UI, light).
// Usage: node scripts/pay-screenshots.mjs [outDir] [webUrl] [apiUrl]
// Needs the API (seeded, SMS_PROVIDER=console + AUTH_EXPOSE_DEV_CODE=true, TRUST_PROXY=loopback) and the web
// app built with NEXT_PUBLIC_DEMO_MODE=true or running in dev. Tops the demo account up with the demo card.
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? '../../docs/screenshots/pay';
const web = process.argv[3] ?? 'http://localhost:3600';
const api = `${process.argv[4] ?? 'http://localhost:4600'}/api/v1`;
const executablePath = process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const tag = (name) => createHash('sha256').update(`seed-paytag:${name}`).digest('base64url').slice(0, 22);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light', locale: 'ru-RU', timezoneId: 'Asia/Almaty' });
await context.addCookies([{ name: 'NEXT_LOCALE', value: 'ru', url: web }]);
const ip = `198.18.${Math.floor(Math.random() * 255)}.${1 + Math.floor(Math.random() * 250)}`;
const headers = { origin: web, 'x-forwarded-for': ip };

// Sign the demo driver in (the refresh cookie lands in the context's jar).
const otp = await (await context.request.post(`${api}/auth/otp/request`, { data: { phone: '+77000000002' }, headers })).json();
const auth = await (await context.request.post(`${api}/auth/otp/verify`, { data: { phone: '+77000000002', code: otp.devCode }, headers })).json();
const bearer = { ...headers, authorization: `Bearer ${auth.accessToken}` };
const call = async (method, path, data) => {
  const res = await context.request.fetch(`${api}${path}`, { method, data, headers: bearer });
  if (!res.ok()) throw new Error(`${method} ${path}: ${res.status()} ${await res.text()}`);
  return res.json();
};
// A top-up through the demo checkout, so 20 l of АИ-95 fits the coin balance.
const { topup } = await call('POST', '/wallet/topups', { amount: 5000 });
await call('POST', `/wallet/topups/${topup.id}/demo-confirm`, { cardNumber: '4242 4242 4242 4242' });

const page = await context.newPage();
await page.route(`${api}/**`, (route) => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': ip } }));
const shot = async (name) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.screenshot({ path: join(outDir, name) });
  console.log(`${name}  horizontalOverflow=${overflow}`);
};

// 01 — the scanner, as on Chrome for Android (Web NFC available, waiting for a tag).
await page.addInitScript(() => {
  window.NDEFReader = class {
    onreading = null;
    onreadingerror = null;
    async scan() {}
  };
});
await page.goto(`${web}/pay`);
await page.getByTestId('nfc-hero').and(page.locator('[data-state="scanning"]')).waitFor();
await page.waitForTimeout(1100);
await shot('01-nfc-scan.png');

// 02 — RP: АИ-95, 20 l.
await page.goto(`${web}/pay/t/${tag('RP')}`);
await page.getByTestId('pay-item').filter({ hasText: 'АИ-95' }).click();
await page.getByTestId('pay-preset-20').click();
await page.getByTestId('pay-total').and(page.locator('[data-total="4900"]')).waitFor();
await page.waitForTimeout(300);
await shot('02-rp-fuel.png');

// 03 — the method choice: coin balance and Google Pay (TEST).
await page.getByTestId('pay-next').click();
await page.getByTestId('pay-balance').and(page.locator('[data-balance]:not([data-balance=""])')).waitFor();
await page.getByTestId('pay-method-gpay').click();
await page.locator('[data-testid="gpay"]:not([data-status="loading"])').waitFor({ timeout: 15_000 });
console.log('google pay button:', await page.getByTestId('gpay').getAttribute('data-status'));
await page.waitForTimeout(400);
await shot('03-pay-method.png');

// 04 — paid with coins: the receipt.
await page.getByTestId('pay-method-coins').click();
await page.getByTestId('pay-confirm').click();
await page.getByTestId('receipt-total').waitFor();
await page.waitForTimeout(900);
await shot('04-receipt.png');

// 05 — GT Oil Service: "Замена масла + фильтр" checkout (Google Pay, TEST).
await page.goto(`${web}/pay/t/${tag('GT Oil Service')}`);
await page.getByTestId('pay-item').filter({ hasText: 'Замена масла + фильтр' }).click();
await page.getByTestId('pay-next').click();
await page.getByTestId('pay-balance').and(page.locator('[data-balance]:not([data-balance=""])')).waitFor();
const gpay = page.locator('[data-testid="gpay"]:not([data-status="loading"])');
await gpay.waitFor({ timeout: 15_000 });
await page.waitForTimeout(400);
await shot('05-gt-oil.png');

// 06 — its receipt. Our fallback button submits the TEST token; with the official button (a real Google
// sheet can't be driven headless) the same TEST token goes straight to the API.
if ((await gpay.getAttribute('data-status')) === 'fallback') {
  await page.getByTestId('gpay-fallback').click();
} else {
  const point = await call('GET', `/pay/t/${tag('GT Oil Service')}`);
  const item = point.items.find((i) => i.name === 'Замена масла + фильтр');
  const receipt = await call('POST', '/pay/orders', {
    serviceId: point.serviceId,
    items: [{ itemId: item.id, qty: 1 }],
    method: 'google_pay',
    googlePay: { token: 'examplePaymentMethodToken', cardNetwork: 'VISA', cardDetails: '1111' },
    idempotencyKey: `shot_${Date.now()}`,
  });
  await page.goto(`${web}/pay/orders/${receipt.orderId}?new=1`);
}
await page.getByTestId('receipt-total').waitFor();
await page.waitForTimeout(900);
await shot('06-gt-receipt.png');

await browser.close();
