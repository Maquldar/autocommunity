import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { apiAs, horizontalOverflow, signUpViaApi, useEnglish, useTestIp, waitForRealtime, type SignedUp } from './helpers';

const PHOTO = path.join(__dirname, 'fixtures', 'avatar.png');
const ALMATY = { lat: 43.2389, lng: 76.8897 };

type Driver = { page: Page; user: SignedUp; at: { lat: number; lng: number }; close: () => Promise<void> };

/**
 * A spot of our own per test (up to ~25 km from the centre), so SOS dispatched in parallel tests
 * (5 km radius) don't reach this test's helper.
 */
function randomSpot(spread = 0.22): { lat: number; lng: number } {
  return { lat: ALMATY.lat + (Math.random() - 0.5) * spread, lng: ALMATY.lng + (Math.random() - 0.5) * spread * 1.4 };
}

async function newDriver(browser: Browser, name: string, at: { lat: number; lng: number }, width = 390): Promise<Driver> {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    geolocation: { latitude: at.lat, longitude: at.lng },
    permissions: ['geolocation'],
  });
  await useEnglish(context);
  const page = await context.newPage();
  await useTestIp(page);
  const user = await signUpViaApi(page, name);
  // A fresh stored location: dispatch, /sos/nearby and /map/sos all use it.
  await apiAs(page, user, 'PUT', '/me/location', { lat: at.lat, lng: at.lng });
  return { page, user, at, close: () => context.close() };
}

const near = (p: { lat: number; lng: number }, meters: number) => ({ lat: p.lat + meters / 111_000, lng: p.lng });

async function createSosViaApi(driver: Driver, type = 'battery', extra: Record<string, unknown> = {}): Promise<{ id: string }> {
  return apiAs<{ id: string }>(driver.page, driver.user, 'POST', '/sos', {
    type,
    description: 'Car will not start near the mall',
    photoUploadIds: [],
    lat: driver.at.lat,
    lng: driver.at.lng,
    sharePhone: false,
    ...extra,
  });
}

const formatKz = (phone: string) => phone.replace(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/, '+7 $1 $2 $3 $4');

test('SOS journey: request, live alert, offer, accept, SOS chat, arrive, close, mutual reviews', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'two-browser journey runs once per e2e run');
  test.setTimeout(240_000);

  const spot = randomSpot();
  const anna = await newDriver(browser, 'Anna Requester', spot);
  const bek = await newDriver(browser, 'Bek Helper', near(spot, 700));
  try {
    // Bek waits on the map: the SOS alert must arrive live.
    await bek.page.goto('/map');
    await waitForRealtime(bek.page);

    // --- Anna: request flow (type → details with a photo → confirm)
    await anna.page.goto('/map');
    await anna.page.getByTestId('nav-sos').click();
    await expect(anna.page).toHaveURL(/\/sos$/);
    await expect(anna.page.getByRole('link', { name: /Call 112/ }).first()).toHaveAttribute('href', 'tel:112');
    await expect(anna.page.getByTestId('sos-disclaimer')).toBeVisible();
    await waitForRealtime(anna.page);
    await anna.page.getByTestId('sos-type-flat_tire').click();
    await expect(anna.page.getByRole('heading', { name: 'Details and location' })).toBeVisible();
    await anna.page.getByLabel("What's going on?").fill('Rear tyre is flat, I have a spare but no jack');
    await anna.page.getByTestId('sos-photo-input').setInputFiles(PHOTO);
    await expect(anna.page.getByTestId('sos-photo-draft')).toHaveCount(1, { timeout: 15_000 });
    await expect(anna.page.getByTestId('sos-location')).toBeVisible({ timeout: 15_000 });
    await expect(anna.page.getByRole('switch', { name: 'Share my phone with helpers' })).not.toBeChecked();
    await anna.page.getByRole('button', { name: 'Review' }).click();
    await expect(anna.page.getByTestId('sos-confirm')).toContainText('Flat tyre');
    await expect(anna.page.getByTestId('sos-confirm')).toContainText('Only for helpers you accept');
    await anna.page.getByTestId('sos-send').click();
    await expect(anna.page).toHaveURL(/\/sos\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const sosId = anna.page.url().split('/').pop()!;
    await expect(anna.page.getByTestId('sos-live')).toHaveAttribute('data-role', 'requester');
    await expect(anna.page.getByTestId('sos-radius')).toHaveText('Searching within 5 km');
    await expect(anna.page.getByTestId('sos-expiry')).toContainText(/Expires in 1:5\d:\d\d/);
    await expect(anna.page.getByTestId('sos-no-offers')).toBeVisible();

    // --- Bek: urgent alert → card → "I can help"
    const alert = bek.page.getByTestId('sos-alert');
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await expect(alert).toHaveAttribute('data-sos-id', sosId);
    await expect(alert).toContainText('Flat tyre');
    await alert.getByRole('link', { name: 'View' }).click();
    await expect(bek.page).toHaveURL(new RegExp(`/sos/${sosId}$`));
    await expect(bek.page.getByTestId('sos-live')).toHaveAttribute('data-role', 'viewer');
    await expect(bek.page.getByRole('heading', { level: 1 })).toHaveText('Anna needs help');
    await expect(bek.page.getByTestId('sos-description')).toContainText('Rear tyre is flat');
    await expect(bek.page.getByTestId('sos-photo')).toHaveCount(1);
    await expect(bek.page.getByTestId('sos-distance')).toContainText(/\d+ m away/);
    // sharePhone is off: no Call button before acceptance.
    await expect(bek.page.getByTestId('sos-call')).toHaveCount(0);
    await bek.page.getByTestId('sos-help').click();
    await expect(bek.page.getByTestId('sos-helper-panel')).toHaveAttribute('data-state', 'offered');

    // --- Anna sees the offer live and accepts
    const offer = anna.page.getByTestId('sos-response');
    await expect(offer).toBeVisible({ timeout: 20_000 });
    await expect(offer).toContainText('Bek Helper');
    await offer.getByRole('button', { name: 'Accept help from Bek Helper' }).click();
    await expect(offer).toHaveAttribute('data-response-status', 'accepted');
    await expect(anna.page.getByTestId('sos-live')).toHaveAttribute('data-status', 'accepted');
    await expect(offer.getByTestId('sos-phone')).toContainText(formatKz(bek.user.phone));

    // --- Bek: accepted live, sees Anna's phone and the SOS chat
    await expect(bek.page.getByTestId('sos-helper-panel')).toHaveAttribute('data-state', 'accepted', { timeout: 20_000 });
    await expect(bek.page.getByTestId('sos-phone')).toContainText(formatKz(anna.user.phone));
    await bek.page.getByRole('link', { name: 'SOS chat' }).click();
    await expect(bek.page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/);
    await expect(bek.page.getByTestId('system-message').first()).toBeVisible();
    await expect(bek.page.getByTestId('system-message').filter({ hasText: 'is coming to help' })).toBeVisible();
    await waitForRealtime(bek.page);
    const bekInput = bek.page.getByRole('textbox', { name: 'Message' });
    await bekInput.fill('On my way, 5 minutes');
    await bekInput.press('Enter');
    await expect(bek.page.getByTestId('message').filter({ hasText: 'On my way' })).toHaveAttribute('data-status', 'sent', { timeout: 15_000 });

    // --- Anna opens the SOS chat from her page and replies
    await anna.page.getByRole('link', { name: 'Open SOS chat' }).click();
    await expect(anna.page.getByTestId('message').filter({ hasText: 'On my way, 5 minutes' })).toBeVisible({ timeout: 15_000 });
    await expect(anna.page.getByRole('heading', { level: 1 })).toContainText('SOS');
    const annaInput = anna.page.getByRole('textbox', { name: 'Message' });
    await annaInput.fill('Thanks, I am by the white Camry');
    await annaInput.press('Enter');
    await expect(bek.page.getByTestId('message').filter({ hasText: 'white Camry' })).toBeVisible({ timeout: 15_000 });

    // --- Bek arrives
    await bek.page.getByRole('link', { name: 'Back' }).click();
    await expect(bek.page).toHaveURL(new RegExp(`/sos/${sosId}$`));
    await bek.page.getByTestId('sos-arrived').click();
    await expect(bek.page.getByTestId('sos-helper-panel')).toHaveAttribute('data-state', 'arrived');

    // --- Anna sees in_progress live, closes
    await anna.page.goto(`/sos/${sosId}`);
    await expect(anna.page.getByTestId('sos-live')).toHaveAttribute('data-status', 'in_progress', { timeout: 15_000 });
    await anna.page.getByRole('button', { name: 'Resolved — close SOS' }).click();
    await anna.page.getByRole('alertdialog').getByRole('button', { name: 'Close SOS' }).click();
    await expect(anna.page.getByTestId('sos-live')).toHaveAttribute('data-status', 'closed');
    await expect(anna.page.getByTestId('sos-ended')).toContainText('Resolved');

    // --- Both see closed; both review each other
    const annaSheet = anna.page.getByTestId('review-sheet');
    await expect(annaSheet).toBeVisible({ timeout: 15_000 });
    await annaSheet.getByLabel('5 stars').check();
    await annaSheet.getByLabel('Comment').fill('Great help, fast and friendly');
    await annaSheet.getByRole('button', { name: 'Send review' }).click();
    await expect(annaSheet).toBeHidden();
    await expect(anna.page.getByTestId('review-prompt')).toHaveCount(0, { timeout: 15_000 });

    await expect(bek.page.getByTestId('sos-live')).toHaveAttribute('data-status', 'closed', { timeout: 20_000 });
    await expect(bek.page.getByTestId('sos-helper-panel')).toHaveAttribute('data-state', 'ended');
    const bekSheet = bek.page.getByTestId('review-sheet');
    await expect(bekSheet).toBeVisible({ timeout: 15_000 });
    await bekSheet.getByLabel('4 stars').check();
    await bekSheet.getByRole('button', { name: 'Send review' }).click();
    await expect(bekSheet).toBeHidden();

    // --- Bek's profile (seen by Anna): the review is listed and the rating went up from 50
    await anna.page.goto(`/u/${bek.user.id}`);
    const review = anna.page.getByTestId('review');
    await expect(review).toHaveCount(1);
    await expect(review).toContainText('Great help, fast and friendly');
    await expect(review.getByRole('img', { name: '5 stars out of 5' })).toBeVisible();
    await expect.poll(async () => Number(await anna.page.getByTestId('profile-rating').getAttribute('data-rating'))).toBeGreaterThan(50);
    await anna.page.getByTestId('rating-summary').click();
    const sheet = anna.page.getByTestId('rating-sheet');
    await expect(sheet.getByTestId('rating-row-help')).toContainText('+3');
    await expect(sheet.getByTestId('rating-row-reviews')).toContainText('+7.5');

    // Bek's own profile: the help shows in his private rating history.
    await bek.page.goto('/profile');
    await expect(bek.page.getByTestId('review')).toContainText('Great help');
    await expect(bek.page.getByText('You helped a driver')).toBeVisible();

    // History lists it for both.
    await bek.page.goto('/sos/history');
    await expect(bek.page.getByTestId('sos-row').filter({ hasText: 'Flat tyre' })).toContainText('You helped');
  } finally {
    await anna.close();
    await bek.close();
  }
});

test('requester cancels with a reason; the helper sees it end live', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'two-browser journey runs once per e2e run');
  test.setTimeout(120_000);
  const spot = randomSpot();
  const anna = await newDriver(browser, 'Alma Cancel', spot);
  const bek = await newDriver(browser, 'Berik Offer', near(spot, 400));
  try {
    const { id } = await createSosViaApi(anna, 'fuel');
    await apiAs(bek.page, bek.user, 'POST', `/sos/${id}/respond`);

    await bek.page.goto(`/sos/${id}`);
    await expect(bek.page.getByTestId('sos-helper-panel')).toHaveAttribute('data-state', 'offered');
    await waitForRealtime(bek.page);

    await anna.page.goto(`/sos/${id}`);
    await expect(anna.page.getByTestId('sos-response')).toHaveAttribute('data-response-status', 'offered');
    await anna.page.getByRole('button', { name: 'Cancel SOS' }).click();
    const dialog = anna.page.getByRole('alertdialog');
    await expect(dialog).toContainText('Cancel this SOS?');
    await dialog.getByLabel('Reason').fill('Fixed it myself');
    await dialog.getByRole('button', { name: 'Cancel SOS' }).click();
    await expect(anna.page.getByTestId('sos-live')).toHaveAttribute('data-status', 'cancelled');
    await expect(anna.page.getByTestId('sos-ended')).toContainText('SOS cancelled');
    await expect(anna.page.getByRole('link', { name: 'Request help again' })).toBeVisible();

    await expect(bek.page.getByTestId('sos-live')).toHaveAttribute('data-status', 'cancelled', { timeout: 20_000 });
    await expect(bek.page.getByTestId('sos-helper-panel')).toContainText('This SOS was cancelled');
  } finally {
    await anna.close();
    await bek.close();
  }
});

test('public share link opens without login and shows the live status', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'one run is enough');
  test.setTimeout(90_000);
  const anna = await newDriver(browser, 'Aigerim Share', randomSpot());
  const guest = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const { id } = await createSosViaApi(anna, 'tow');
    await anna.page.goto(`/sos/${id}`);
    await anna.page.getByRole('button', { name: 'Share with a trusted contact' }).click();
    const url = await anna.page.getByTestId('sos-share-url').inputValue();
    expect(url).toMatch(/\/s\/[A-Za-z0-9_-]{20,}$/);

    await useEnglish(guest);
    const page = await guest.newPage();
    await page.goto(new URL(url).pathname);
    await expect(page.getByTestId('public-sos')).toHaveAttribute('data-status', 'created');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Aigerim asked for roadside help');
    await expect(page.getByText('Need a tow')).toBeVisible();
    await expect(page.getByRole('link', { name: /Call 112/ })).toHaveAttribute('href', 'tel:112');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    // An unknown token shows the expired state.
    await page.goto('/s/not-a-real-token-123456789');
    await expect(page.getByTestId('public-sos')).toHaveAttribute('data-state', 'not-found');
    await expect(page.getByText('This link has expired')).toBeVisible();
  } finally {
    await anna.close();
    await guest.close();
  }
});

test('gates: an open SOS redirects /sos, and a second SOS shows SOS_ALREADY_OPEN guidance', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'one run is enough');
  test.setTimeout(90_000);
  const anna = await newDriver(browser, 'Asel Gate', randomSpot());
  try {
    await anna.page.goto('/sos');
    await anna.page.getByTestId('sos-type-accident').click();
    // Accident: the full 112 block comes first on every step.
    await expect(anna.page.getByRole('link', { name: /Call 112.*Emergency services/ })).toBeVisible();
    await expect(anna.page.getByTestId('sos-location')).toBeVisible({ timeout: 15_000 });
    await anna.page.getByRole('button', { name: 'Review' }).click();

    // Meanwhile another SOS gets opened (another tab or device).
    const { id } = await createSosViaApi(anna, 'battery');
    await anna.page.getByTestId('sos-send').click();
    const guidance = anna.page.getByTestId('sos-guidance');
    await expect(guidance).toHaveAttribute('data-guidance', 'alreadyOpen');
    await expect(guidance).toContainText('You already have an open SOS');
    await guidance.getByRole('button', { name: 'Open my SOS' }).click();
    await expect(anna.page).toHaveURL(new RegExp(`/sos/${id}$`));

    // The centre button now leads straight to the live page.
    await anna.page.goto('/sos');
    await expect(anna.page).toHaveURL(new RegExp(`/sos/${id}$`));
  } finally {
    await anna.close();
  }
});

test('map: SOS markers, the SOS sheet, the layer toggle and the nearby list', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'two-browser test runs once');
  test.setTimeout(120_000);
  // Close to the default map centre so the marker is in the first viewport.
  const spot = { lat: ALMATY.lat + 0.004 + Math.random() * 0.004, lng: ALMATY.lng + 0.004 + Math.random() * 0.004 };
  const anna = await newDriver(browser, 'Aruzhan Map', spot);
  const bek = await newDriver(browser, 'Bauyrzhan Map', near(spot, 300));
  try {
    const { id } = await createSosViaApi(anna, 'stuck');
    // Bek is dispatched (300 m away): the urgent banner shows on every page until viewed or dismissed.
    await bek.page.goto('/map');
    const alert = bek.page.getByTestId('sos-alert');
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await alert.getByRole('button', { name: 'Dismiss SOS alert' }).click();
    await expect(alert).toBeHidden();
    await expect(bek.page.getByTestId('map-canvas')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
    const marker = bek.page.locator(`[data-testid="sos-marker"][data-sos-id="${id}"]`);
    await expect(marker).toBeAttached({ timeout: 20_000 });
    await expect(marker).toHaveAccessibleName('SOS: Stuck in snow or mud, Looking for help');
    await expect(bek.page.getByTestId('map-sos-count')).toBeVisible();

    await marker.focus();
    await marker.press('Enter');
    const sheet = bek.page.getByTestId('sos-sheet');
    await expect(sheet).toContainText('Stuck in snow or mud');
    await expect(sheet).toContainText('Aruzhan Map');
    await sheet.getByRole('link', { name: 'View and help' }).click();
    await expect(bek.page).toHaveURL(new RegExp(`/sos/${id}$`));

    // The layer can be hidden (remembered) and shown again.
    await bek.page.goto('/map');
    await expect(marker).toBeAttached({ timeout: 20_000 });
    const toggle = bek.page.getByTestId('map-sos-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(marker).toHaveCount(0);
    await toggle.click();
    await expect(marker).toBeAttached({ timeout: 20_000 });

    // Live removal when the SOS ends.
    await apiAs(anna.page, anna.user, 'POST', `/sos/${id}/cancel`, { reason: 'ok now' });
    await waitForRealtime(bek.page);
    await expect(marker).toHaveCount(0, { timeout: 35_000 });

    // The nearby list (stored location).
    const second = await createSosViaApi(anna, 'battery');
    await bek.page.goto('/sos/nearby');
    await expect(bek.page.locator(`[data-testid="sos-row"][data-sos-id="${second.id}"]`)).toContainText('Dead battery');
  } finally {
    await anna.close();
    await bek.close();
  }
});

test('SOS screens fit 320px without horizontal scroll', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'viewport set explicitly');
  test.setTimeout(120_000);
  const spot = randomSpot();
  const anna = await newDriver(browser, 'Assel Narrow', spot, 320);
  const bek = await newDriver(browser, 'Bolat Narrow', near(spot, 500), 320);
  try {
    await anna.page.goto('/sos');
    await expect(anna.page.getByTestId('sos-type-flat_tire')).toBeVisible();
    expect(await horizontalOverflow(anna.page)).toBeLessThanOrEqual(0);
    await anna.page.getByTestId('sos-type-breakdown').click();
    await expect(anna.page.getByTestId('sos-location')).toBeVisible({ timeout: 15_000 });
    expect(await horizontalOverflow(anna.page)).toBeLessThanOrEqual(0);

    const { id } = await createSosViaApi(anna, 'breakdown');
    await apiAs(bek.page, bek.user, 'POST', `/sos/${id}/respond`);
    await anna.page.goto(`/sos/${id}`);
    await expect(anna.page.getByTestId('sos-response')).toBeVisible();
    expect(await horizontalOverflow(anna.page)).toBeLessThanOrEqual(0);
    await bek.page.goto(`/sos/${id}`);
    await expect(bek.page.getByTestId('sos-helper-panel')).toBeVisible();
    expect(await horizontalOverflow(bek.page)).toBeLessThanOrEqual(0);
    await bek.page.goto('/sos/nearby');
    await expect(bek.page.getByTestId('sos-nearby-list')).toBeVisible();
    expect(await horizontalOverflow(bek.page)).toBeLessThanOrEqual(0);
    await bek.page.goto('/sos/history');
    await expect(bek.page.getByTestId('sos-row').first()).toBeVisible();
    expect(await horizontalOverflow(bek.page)).toBeLessThanOrEqual(0);
  } finally {
    await anna.close();
    await bek.close();
  }
});
