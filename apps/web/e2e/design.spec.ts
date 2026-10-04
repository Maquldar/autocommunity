import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * Routes linked from enabled nav items / the landing CTA whose pages are built by the next phase.
 * Next.js prefetches them and logs a 404. Remove entries as the pages ship.
 */
const PENDING_ROUTES: string[] = [];

/** Collects console errors and page errors; 404s are only tolerated for prefetches of PENDING_ROUTES. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    // The 404 itself is checked precisely in the response handler below.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const url = new URL(response.url());
    const pendingPrefetch = response.status() === 404 && PENDING_ROUTES.includes(url.pathname);
    if (!pendingPrefetch) errors.push(`${response.status()} ${url.pathname}${url.search}`);
  });
  return errors;
}

test.describe('styleguide /design', () => {
  test('renders every section without console errors', async ({ page }) => {
    const errors = trackErrors(page);

    await page.goto('/design');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('main section[id]')).toHaveCount(15);
    // Infinite list demo fetches its first page client-side.
    await expect(page.getByRole('list', { name: /Drivers|Водители/ })).toBeVisible();
    await page.waitForTimeout(1000);

    expect(errors).toEqual([]);
  });

  test('has no horizontal scroll at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/design');
    await expect(page.getByRole('list', { name: /Drivers|Водители/ })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('has no horizontal scroll at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/design');
    await expect(page.getByRole('list', { name: /Drivers|Водители/ })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('OTP paste fills all boxes', async ({ page }) => {
    await page.goto('/design');
    const group = page.getByRole('group', { name: /Verification code|Код подтверждения/ });
    const first = group.getByRole('textbox').first();
    await first.focus();
    await page.evaluate(() => {
      const target = document.activeElement;
      const data = new DataTransfer();
      data.setData('text', '482913');
      target?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect(group.getByRole('textbox').last()).toHaveValue('3');
  });
});

test('landing links to /login without errors or horizontal scroll', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /Get started|Начать/ })).toHaveAttribute('href', '/login');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});
