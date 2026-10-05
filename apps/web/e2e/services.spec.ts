import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { API_URL, horizontalOverflow, signUpViaApi, useEnglish, useTestIp } from './helpers';

/**
 * Phase 7 — service catalog (API.md §7). Needs the API seed (≈40 verified services across Almaty).
 * Each project works on its own seeded service so parallel runs don't race on the same rating.
 */

const ALMATY = { latitude: 43.2389, longitude: 76.8897 };
const METERS_PER_DEG_LAT = 111_195;

test.use({ geolocation: ALMATY, permissions: ['geolocation'] });

test.beforeEach(async ({ context, page }) => {
  await useEnglish(context);
  await useTestIp(page);
});

type ListItem = { id: string; name: string; category: string; lat: number; lng: number; rating: number; reviewCount: number };
type Review = { stars: number };

const api = (request: APIRequestContext, token: string) => ({
  async get<T>(path: string): Promise<T> {
    const res = await request.get(`${API_URL}/api/v1${path}`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.ok(), await res.text()).toBeTruthy();
    return (await res.json()) as T;
  },
});

/** A seeded verified service of `category`, picked by name order and project so mobile/desktop never share one. */
async function pickService(page: Page, token: string, category: string, projectIndex: number): Promise<ListItem> {
  const { items } = await api(page.request, token).get<{ items: ListItem[] }>(`/services?category=${category}&limit=50`);
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
  expect(sorted.length).toBeGreaterThan(projectIndex);
  return sorted[projectIndex]!;
}

async function allReviews(page: Page, token: string, serviceId: string): Promise<Review[]> {
  const out: Review[] = [];
  let cursor: string | null = null;
  do {
    const page_: { items: Review[]; nextCursor: string | null } = await api(page.request, token).get(
      `/services/${serviceId}/reviews?limit=50${cursor ? `&cursor=${cursor}` : ''}`,
    );
    out.push(...page_.items);
    cursor = page_.nextCursor;
  } while (cursor);
  return out;
}

/** API.md §7: Bayesian average with prior 3.5 × 5, one decimal. */
const bayesian = (starsSum: number, count: number) => Math.round(((3.5 * 5 + starsSum) / (5 + count)) * 10) / 10;

/** A point `meters` north of the given coordinates. */
const northOf = (p: { lat: number; lng: number }, meters: number) => ({ latitude: p.lat + meters / METERS_PER_DEG_LAT, longitude: p.lng });

const projectIndex = (name: string) => (name === 'mobile' ? 0 : 1);

const servicesList = (page: Page) => page.getByRole('list', { name: 'Services' });

async function openVisitByLocation(page: Page) {
  const section = page.getByTestId('visit-section');
  await section.getByRole('button', { name: 'I visited' }).click();
  const sheet = page.getByRole('dialog', { name: 'Confirm your visit' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: /I'm here now/ }).click();
  await sheet.getByRole('button', { name: 'Check my location' }).click();
  return sheet;
}

test('browse, filter, confirm a visit by location and publish a review', async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  const { accessToken } = await signUpViaApi(page, 'Services E2E');
  const service = await pickService(page, accessToken, 'wash', projectIndex(testInfo.project.name));

  // --- List renders seeded services
  await page.goto('/services');
  await expect(page.getByRole('heading', { name: 'Services', level: 1 })).toBeVisible();
  const cards = servicesList(page).getByRole('link');
  await expect(cards.first()).toBeVisible({ timeout: 15_000 });
  expect(await cards.count()).toBeGreaterThan(5);

  // --- Category filter narrows the list to car washes
  const allCount = await cards.count();
  await page.getByRole('group', { name: 'Category' }).getByRole('button', { name: 'Car wash' }).click();
  await expect(page).toHaveURL(/category=wash/);
  await expect(page.getByRole('group', { name: 'Category' }).getByRole('button', { name: 'Car wash' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => {
    const texts = await cards.allInnerTexts();
    return texts.length > 0 && texts.every((t) => t.includes('Car wash'));
  }).toBe(true);
  expect(await cards.count()).toBeLessThan(allCount);

  // --- Open the service (search narrows to it)
  await page.getByRole('searchbox', { name: 'Search services' }).fill(service.name);
  const card = cards.filter({ hasText: service.name });
  await expect(cards).toHaveCount(1);
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/services/${service.id}$`));
  await expect(page.getByRole('heading', { name: service.name, level: 1 })).toBeVisible();

  // Rating before, from the API (the review list is the source of the rating).
  const before = await allReviews(page, accessToken, service.id);
  const sumBefore = before.reduce((s, r) => s + r.stars, 0);
  const rating = page.getByTestId('service-rating');
  await expect(rating).toContainText(before.length === 0 ? 'New' : `${before.length} review`);

  // --- "I visited" by location, ~50 m from the service → verified
  await context.setGeolocation(northOf(service, 50));
  const sheet = await openVisitByLocation(page);
  await expect(sheet).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText('Visit confirmed — you can write a review now')).toBeVisible();
  const section = page.getByTestId('visit-section');
  await expect(section.getByRole('heading', { name: 'Visit confirmed' })).toBeVisible();
  await expect(section.getByText('Confirmed by location')).toBeVisible();

  // --- Review: stars + comment
  const form = section.getByRole('form', { name: 'Write a review' });
  await form.getByRole('button', { name: 'Publish review' }).click();
  await expect(form.getByText('Choose from 1 to 5 stars')).toBeVisible();
  await form.getByRole('radio', { name: '4 stars' }).check({ force: true });
  const comment = `Fast and tidy wash, e2e ${Date.now().toString(36)}`;
  await form.getByLabel('Comment').fill(comment);
  await form.getByRole('button', { name: 'Publish review' }).click();
  await expect(section.getByRole('heading', { name: 'Thanks for your review!' })).toBeVisible();

  // It shows in the list, and the counters/rating follow the Bayesian formula.
  const reviews = page.getByRole('list', { name: 'Reviews of this service' });
  await expect(reviews.getByText(comment)).toBeVisible();
  await expect(reviews.getByRole('listitem').filter({ hasText: comment }).getByRole('img', { name: '4 stars' })).toBeVisible();
  const expected = bayesian(sumBefore + 4, before.length + 1).toFixed(1);
  await expect(rating).toContainText(`${before.length + 1} review`);
  await expect(rating.getByText(`Rating ${expected} out of 5`)).toBeAttached();
  await expect(page.getByText(`Based on ${before.length + 1} review`)).toBeVisible();
});

test('a location check far from the service is refused with TOO_FAR', async ({ page, context }, testInfo) => {
  const { accessToken } = await signUpViaApi(page, 'Far Away E2E');
  const service = await pickService(page, accessToken, 'tires', projectIndex(testInfo.project.name));
  await page.goto(`/services/${service.id}`);
  await expect(page.getByRole('heading', { name: service.name, level: 1 })).toBeVisible();

  await context.setGeolocation(northOf(service, 2_000));
  const sheet = await openVisitByLocation(page);
  await expect(sheet.getByText(/You're 2 km from the service\. Come within 150 m/)).toBeVisible({ timeout: 15_000 });
  await expect(sheet.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  // No visit was stored: the prompt is unchanged.
  await expect(page.getByTestId('visit-section').getByRole('heading', { name: 'Been here?' })).toBeVisible();
});

test('submitting a new service leads to its pending page and keeps it out of the public list', async ({ page, context }) => {
  test.setTimeout(90_000);
  await signUpViaApi(page, 'Submitter E2E');
  // A random spot in Almaty so repeated runs never trip the duplicate guard.
  const spot = { latitude: 43.2 + Math.random() * 0.05, longitude: 76.85 + Math.random() * 0.08 };
  await context.setGeolocation(spot);
  const name = `E2E Garage ${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

  await page.goto('/services/new');
  await expect(page.getByRole('heading', { name: 'Add a service', level: 1 })).toBeVisible();
  await page.getByLabel('Name').fill(name);
  await page.getByRole('combobox', { name: 'Category' }).click();
  await page.getByRole('option', { name: 'Car service' }).click();
  await page.getByLabel('Description').fill('Suspension and brakes, test entry.');
  await page.getByLabel('Address').fill('ул. Тестовая, 1');
  await page.getByRole('button', { name: 'Use my location' }).click();
  await expect(page.getByTestId('picked-location')).toContainText(spot.latitude.toFixed(5).slice(0, 6));
  await page.getByRole('button', { name: 'Send for moderation' }).click();

  await expect(page).toHaveURL(/\/services\/[0-9a-f-]{36}\?submitted=1$/, { timeout: 20_000 });
  const banner = page.getByTestId('pending-banner');
  await expect(banner).toContainText('Thanks! Your service is sent for moderation');
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  await expect(page.getByText('Under review')).toBeVisible();
  // No visit/review on a pending service.
  await expect(page.getByTestId('visit-section')).toHaveCount(0);

  await page.goto('/services');
  await page.getByRole('searchbox', { name: 'Search services' }).fill(name);
  await expect(page.getByText('Nothing found')).toBeVisible({ timeout: 15_000 });
});

test('map view shows service pins', async ({ page }) => {
  await signUpViaApi(page, 'Map Services E2E');
  await page.goto('/services');
  await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: 'Map' }).click();
  await expect(page).toHaveURL(/view=map/);
  const map = page.getByTestId('services-map');
  await expect(map).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await expect.poll(async () => Number(await map.getAttribute('data-count')), { timeout: 20_000 }).toBeGreaterThan(0);
  await expect.poll(async () => Number(await map.getAttribute('data-rendered')), { timeout: 20_000 }).toBeGreaterThan(0);
  await expect(page.getByRole('list', { name: 'Categories' })).toBeVisible();

  // The category filter applies to the map too.
  const all = Number(await map.getAttribute('data-count'));
  await page.getByRole('group', { name: 'Category' }).getByRole('button', { name: 'Tow truck' }).click();
  await expect.poll(async () => Number(await map.getAttribute('data-count')), { timeout: 20_000 }).toBeLessThan(all);
});

test('no horizontal scroll at 320 px on the list and a details page', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const { accessToken } = await signUpViaApi(page, 'Narrow E2E');
  const service = await pickService(page, accessToken, 'repair', 0);

  await page.goto('/services');
  await expect(servicesList(page).getByRole('link').first()).toBeVisible({ timeout: 15_000 });
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  await page.goto(`/services/${service.id}`);
  await expect(page.getByRole('heading', { name: service.name, level: 1 })).toBeVisible();
  await expect(page.getByTestId('visit-section')).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});
