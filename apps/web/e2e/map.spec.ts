import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import { geolocationWatchCalls, signInInUi, signUpViaApi, trackGeolocation, useEnglish, useTestIp } from './helpers';

/** Seeded demo driver (API seed): has friends with fresh positions around Almaty. */
const DEMO_PHONE = '+77000000002';
const ALMATY = { latitude: 43.2389, longitude: 76.8897 };

test.use({ geolocation: ALMATY, permissions: ['geolocation'] });

test.beforeEach(async ({ context, page }) => {
  await useEnglish(context);
  await useTestIp(page);
  await trackGeolocation(page);
});

const isLocationPut = (request: Request) => request.method() === 'PUT' && new URL(request.url()).pathname.endsWith('/api/v1/me/location');

async function waitForMap(page: Page): Promise<Locator> {
  await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  const count = page.getByTestId('map-count').locator('[data-count]');
  await expect(count).toBeVisible({ timeout: 20_000 });
  return count;
}

const countOf = async (count: Locator) => Number(await count.getAttribute('data-count'));

/** Markers sit under overlays at times; keyboard activation avoids pointer hit-testing (and checks a11y). */
async function activate(locator: Locator) {
  await locator.focus();
  await locator.press('Enter');
}

/** Clicks clusters until at least one individual driver marker is on screen. */
async function anyDriverMarker(page: Page): Promise<Locator> {
  const drivers = page.getByTestId('driver-marker');
  for (let i = 0; i < 4 && (await drivers.count()) === 0; i += 1) {
    await activate(page.getByTestId('cluster-marker').first());
    await page.waitForTimeout(1200);
  }
  await expect(drivers.first()).toBeAttached();
  return drivers.first();
}

test('demo driver sees friends on the map, opens a card, filters, goes invisible and shares location', async ({ page }, testInfo) => {
  // The shared demo phone may request 5 codes per hour, so this journey runs in one project only.
  test.skip(testInfo.project.name !== 'mobile', 'demo login runs once per e2e run (OTP limit on the shared demo phone)');
  test.setTimeout(150_000);

  await signInInUi(page, DEMO_PHONE);
  const count = await waitForMap(page);
  const total = await countOf(count);
  expect(total).toBeGreaterThan(0);
  await expect(page.getByTestId('driver-marker').or(page.getByTestId('cluster-marker')).first()).toBeAttached();

  // No geolocation before the explicit "Share my location" tap.
  await expect(page.getByTestId('location-banner')).toBeVisible();
  expect(await geolocationWatchCalls(page)).toBe(0);

  // --- Driver card
  const marker = await anyDriverMarker(page);
  const approximate = (await marker.getAttribute('data-approximate')) === 'true';
  await activate(marker);
  const card = page.getByRole('dialog');
  await expect(card).toBeVisible();
  await expect(card.getByRole('link', { name: 'Open profile' })).toHaveAttribute('href', /^\/u\//);
  await expect(card.getByText(/Trust rating \d+ out of 100/)).toBeAttached();
  if (approximate) await expect(card.getByTestId('approximate-note')).toBeVisible();
  // Friend action reflects the relation from GET /users/:id.
  await expect(card.getByRole('button', { name: /Add friend|Friends|Cancel request|Accept/ }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();

  // --- Friends-only filter shows fewer drivers, all of them friends
  await page.getByTestId('map-filters-button').click();
  await page.getByRole('switch', { name: 'Friends only' }).click();
  await page.getByRole('button', { name: 'Show drivers' }).click();
  await expect(page.getByTestId('map-filters-button')).toHaveAccessibleName('Filters, 1 active');
  await expect.poll(async () => countOf(page.getByTestId('map-count').locator('[data-count]')), { timeout: 15_000 }).toBeLessThan(total);
  const friendCount = await countOf(page.getByTestId('map-count').locator('[data-count]'));
  expect(friendCount).toBeGreaterThan(0);
  for (const relation of await page.getByTestId('driver-marker').evaluateAll((els) => els.map((e) => e.getAttribute('data-relation')))) {
    expect(relation).toBe('friend');
  }
  await page.getByTestId('map-filters-button').click();
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await page.getByRole('button', { name: 'Show drivers' }).click();
  await expect.poll(async () => countOf(page.getByTestId('map-count').locator('[data-count]')), { timeout: 15_000 }).toBe(total);

  // --- Go invisible and back
  const toggle = page.getByTestId('privacy-toggle');
  const before = await toggle.getAttribute('data-mode');
  expect(before).not.toBe('hidden');
  await page.getByRole('button', { name: /Go invisible/ }).click();
  await expect(toggle).toHaveAttribute('data-mode', 'hidden');
  await expect(page.getByText("You're invisible. Nobody sees you on the map.")).toBeVisible();
  await page.getByRole('button', { name: /Become visible/ }).click();
  await expect(toggle).toHaveAttribute('data-mode', before!);
  await expect(page.getByText(/You're visible again/)).toBeVisible();

  // --- Share location: the first PUT /me/location goes out right away
  const put = page.waitForRequest(isLocationPut);
  await page.getByTestId('location-banner').getByRole('button', { name: 'Share my location' }).click();
  const body = (await put).postDataJSON() as { lat: number; lng: number };
  expect(body.lat).toBeCloseTo(ALMATY.latitude, 3);
  expect(body.lng).toBeCloseTo(ALMATY.longitude, 3);
  await expect(page.getByTestId('location-sharing')).toBeVisible();
  await expect(page.getByTestId('own-position')).toBeAttached();
});

test('new driver: map loads, zoom-out hint, invisibility and location sharing', async ({ page }) => {
  test.setTimeout(90_000);
  // MapLibre honours prefers-reduced-motion: camera moves (keyboard zoom, the hint's zoom-in) apply at once
  // instead of easing over frames that crawl when many specs render WebGL in software at the same time.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signUpViaApi(page, 'Map Tester');
  await page.goto('/map');
  await waitForMap(page);

  // Nothing touches geolocation until the user opts in.
  await page.waitForTimeout(1000);
  expect(await geolocationWatchCalls(page)).toBe(0);
  let puts = 0;
  page.on('request', (request) => {
    if (isLocationPut(request)) puts += 1;
  });

  // Zoomed out past 2° × 2°: hint instead of a request.
  const bigRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/map/users')) {
      const [w, s, e, n] = (url.searchParams.get('bbox') ?? '').split(',').map(Number);
      if (e! - w! > 2 || n! - s! > 2) bigRequests.push(url.search);
    }
  });
  // One zoom step at a time, waiting for the settled zoom (`data-zoom`, written on moveend): MapLibre eases
  // each step from the *current* zoom, so keys pressed while a step is still in flight were partly lost.
  const canvas = page.getByTestId('map-canvas');
  const zoomOf = async () => Number(await canvas.getAttribute('data-zoom'));
  const hint = page.getByTestId('map-zoom-hint');
  for (let i = 0; i < 10 && !(await hint.isVisible()); i += 1) {
    const before = await zoomOf();
    // locator.press re-focuses the canvas each time (a re-render may have moved focus).
    await canvas.locator('canvas').press('-');
    await expect.poll(zoomOf).toBeLessThan(before - 0.5);
  }
  await expect(hint).toBeVisible({ timeout: 10_000 });
  for (let i = 0; i < 4 && (await hint.isVisible()); i += 1) {
    const before = await zoomOf();
    await hint.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(zoomOf).toBeGreaterThan(before + 0.5);
  }
  await expect(hint).toBeHidden();
  expect(bigRequests).toEqual([]);

  // Invisible and back (new users start in "My communities").
  const toggle = page.getByTestId('privacy-toggle');
  await expect(toggle).toHaveAttribute('data-mode', 'community');
  await toggle.click();
  await expect(toggle).toHaveAttribute('data-mode', 'hidden');
  await expect(toggle).toHaveAccessibleName(/Invisible.*Become visible/);
  await page.reload();
  await expect(page.getByTestId('privacy-toggle')).toHaveAttribute('data-mode', 'hidden');
  await page.getByTestId('privacy-toggle').click();
  await expect(page.getByTestId('privacy-toggle')).toHaveAttribute('data-mode', 'community');

  // Location: dismissed banner leaves a compact button; tapping it starts sharing.
  expect(puts).toBe(0);
  await page.getByTestId('location-banner').getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByTestId('location-banner')).toBeHidden();
  const put = page.waitForRequest(isLocationPut);
  await page.getByRole('button', { name: 'Share my location' }).click();
  await put;
  expect(await geolocationWatchCalls(page)).toBe(1);
  await expect(page.getByTestId('location-sharing')).toBeVisible();

  // Consent is remembered: sharing resumes on the next visit without a tap.
  const again = page.waitForRequest(isLocationPut);
  await page.reload();
  await again;
  await expect(page.getByTestId('location-sharing')).toBeVisible();

  // Stop sharing → DELETE /me/location.
  const del = page.waitForRequest((r) => r.method() === 'DELETE' && r.url().endsWith('/api/v1/me/location'));
  await page.getByTestId('location-sharing').click();
  await page.getByRole('button', { name: 'Stop sharing' }).click();
  await del;
  await expect(page.getByText('Location sharing stopped')).toBeVisible();
});
