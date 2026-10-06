import { expect, test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { apiAs, horizontalOverflow, signUpViaApi, useEnglish, useTestIp, waitForRealtime, type SignedUp } from './helpers';

/** The map's default centre: a moderator "here" puts the event on the member's first map screen. */
const ALMATY = { latitude: 43.2389, longitude: 76.8897 };

type Driver = { page: Page; user: SignedUp; close: () => Promise<void> };

async function newDriver(browser: Browser, name: string, options: BrowserContextOptions = {}): Promise<Driver> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...options });
  await useEnglish(context);
  const page = await context.newPage();
  await useTestIp(page);
  const user = await signUpViaApi(page, name);
  return { page, user, close: () => context.close() };
}

/** `YYYY-MM-DDTHH:mm` in Almaty (UTC+5), `hours` from now. */
function almatyInput(hours: number): string {
  const d = new Date(Date.now() + hours * 3600_000 + 5 * 3600_000);
  return d.toISOString().slice(0, 16);
}

test('events: create with a route → member notified, RSVPs, chat, map layer, edit notice', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'two-browser journey runs once per e2e run');
  test.setTimeout(240_000);
  const mod = await newDriver(browser, 'Mona Moderator', { geolocation: ALMATY, permissions: ['geolocation'] });
  const member = await newDriver(browser, 'Max Member');
  const title = `E2E Ride ${Date.now().toString(36)}`;
  try {
    const community = await apiAs<{ id: string }>(mod.page, mod.user, 'POST', '/communities', {
      name: `E2E Events ${Date.now().toString(36)}`,
      description: 'Rides',
      isPrivate: false,
    });
    await apiAs(member.page, member.user, 'POST', `/communities/${community.id}/join`);

    // --- The member waits on the notifications page (live socket).
    await member.page.goto('/notifications');
    await waitForRealtime(member.page);

    // --- The moderator creates an event from the community's Events tab, with a 3-point route.
    await mod.page.goto(`/communities/${community.id}?tab=events`);
    await mod.page.getByTestId('create-event').click();
    await expect(mod.page).toHaveURL(/\/events\/new$/);
    await mod.page.getByLabel('Title').fill(title);
    await mod.page.getByLabel('Starts').fill(almatyInput(26));
    await mod.page.getByLabel('Meeting point').fill('Parking at Mega, Rozybakiev St');
    await mod.page.getByRole('button', { name: 'Use my position' }).click();
    await expect(mod.page.getByTestId('picked-location')).toContainText('43.23890');
    const map = mod.page.getByTestId('event-map');
    await expect(map).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
    await mod.page.getByRole('radio', { name: 'Route' }).click();
    await map.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const box = (await map.boundingBox())!;
    const taps: [number, number][] = [
      [0.3, 0.6],
      [0.5, 0.45],
      [0.7, 0.3],
      [0.8, 0.2],
    ];
    for (const [x, y] of taps) {
      await map.click({ position: { x: box.width * x, y: box.height * y } });
    }
    await expect(mod.page.getByTestId('route-points')).toHaveText('Route: 4 points');
    await mod.page.getByTestId('route-undo').click();
    await expect(mod.page.getByTestId('route-points')).toHaveText('Route: 3 points');
    expect(await horizontalOverflow(mod.page)).toBeLessThanOrEqual(0);
    await mod.page.getByRole('button', { name: 'Create event' }).click();
    await expect(mod.page).toHaveURL(/\/events\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    const eventUrl = new URL(mod.page.url()).pathname;
    await expect(mod.page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(mod.page.getByRole('heading', { name: 'Route · 3 points' })).toBeVisible();

    // --- The member is notified live and opens the event.
    const notification = member.page.getByRole('link', { name: new RegExp(`New event in .*${title}`) });
    await expect(notification).toBeVisible({ timeout: 20_000 });
    await notification.click();
    await expect(member.page).toHaveURL(eventUrl);
    await expect(member.page.getByTestId('rsvp-state')).toHaveText('Are you going?');
    await member.page.getByRole('button', { name: 'Going', exact: true }).click();
    await expect(member.page.getByTestId('rsvp-state')).toHaveText("You're going");
    await expect(member.page.getByTestId('event-counts')).toContainText('1 going');
    await expect(member.page.getByRole('list', { name: 'Participants' })).toContainText('Max Member');

    // --- The event chat opens for the member.
    await member.page.getByTestId('event-chat-link').click();
    await expect(member.page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/);
    await expect(member.page.getByText(title).first()).toBeVisible();

    // --- The event is on the map layer.
    await member.page.goto('/map');
    await expect(member.page.getByTestId('events-layer-toggle')).toHaveAttribute('aria-pressed', 'true');
    const marker = member.page.getByRole('button', { name: new RegExp(`Event: ${title}`) });
    await expect(marker).toBeVisible({ timeout: 20_000 });
    // Earlier runs leave events at the same spot, so markers may overlap: click this one directly.
    await marker.evaluate((el: HTMLElement) => el.click());
    await expect(member.page.getByTestId('event-map-card')).toContainText(title);
    await member.page.getByTestId('events-layer-toggle').click();
    await expect(marker).toHaveCount(0);
    await member.page.getByTestId('events-layer-toggle').click();

    // --- The moderator moves the event; the member gets a change notice.
    await member.page.goto('/notifications');
    await waitForRealtime(member.page);
    await mod.page.goto(`${eventUrl}/edit`);
    await mod.page.getByLabel('Starts').fill(almatyInput(50));
    await mod.page.getByRole('button', { name: 'Save changes' }).click();
    await expect(mod.page).toHaveURL(eventUrl);
    await expect(member.page.getByRole('link', { name: new RegExp(`${title}\\s*was changed`) })).toBeVisible({ timeout: 20_000 });
  } finally {
    await mod.close();
    await member.close();
  }
});

test('events pages fit 320px', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 720 } });
  await useEnglish(context);
  const page = await context.newPage();
  await useTestIp(page);
  const user = await signUpViaApi(page, 'Narrow Viewer');
  try {
    const community = await apiAs<{ id: string }>(page, user, 'POST', '/communities', { name: `E2E Narrow ${Date.now().toString(36)}`, description: '', isPrivate: false });
    const event = await apiAs<{ id: string }>(page, user, 'POST', `/communities/${community.id}/events`, {
      title: 'A rather long event title to check wrapping on small phones',
      place: 'Somewhere with a quite long address, Almaty',
      lat: 43.24,
      lng: 76.9,
      startsAt: new Date(Date.now() + 30 * 3600_000).toISOString(),
      route: [
        [76.9, 43.24],
        [76.95, 43.25],
      ],
    });
    for (const path of ['/events', `/events/${event.id}`, `/communities/${community.id}/events/new`, `/communities/${community.id}?tab=events`]) {
      await page.goto(path);
      await expect(page.locator('main h1').first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await horizontalOverflow(page), path).toBeLessThanOrEqual(0);
    }
  } finally {
    await context.close();
  }
});
