import { expect, test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { apiAs, horizontalOverflow, signUpViaApi, useEnglish, useTestIp, waitForRealtime, type SignedUp } from './helpers';

const ALMATY = { latitude: 43.2389, longitude: 76.8897 };

type Driver = { page: Page; user: SignedUp; name: string; close: () => Promise<void> };

/** A signed-up, onboarded driver in its own browser context (own cookies, own socket). */
async function newDriver(browser: Browser, name: string, options: BrowserContextOptions = {}): Promise<Driver> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...options });
  await useEnglish(context);
  const page = await context.newPage();
  await useTestIp(page);
  const user = await signUpViaApi(page, name);
  return { page, user, name, close: () => context.close() };
}

const uniqueName = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.floor(Math.random() * 900 + 100)}`;

test('private community: request, live approval, live chat (text, location, typing), promotion and moderator delete', async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'two-browser journey runs once per e2e run');
  test.setTimeout(240_000);

  const alice = await newDriver(browser, 'Alice Owner', { geolocation: ALMATY, permissions: ['geolocation'] });
  const bob = await newDriver(browser, 'Bob Rider');
  const communityName = uniqueName('E2E Night Club');
  try {
    // --- Alice creates a private community through the form.
    await alice.page.goto('/communities/new');
    await alice.page.getByLabel('Name').fill(communityName);
    await alice.page.getByLabel('Description').fill('Night rides and help on the road.');
    await alice.page.getByRole('radio', { name: /^Private/ }).click();
    await alice.page.getByRole('button', { name: 'Create community' }).click();
    await expect(alice.page).toHaveURL(/\/communities\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    const communityUrl = new URL(alice.page.url()).pathname;
    await expect(alice.page.getByRole('heading', { level: 1, name: communityName })).toBeVisible();
    await expect(alice.page.getByTestId('privacy-badge')).toHaveText('Private');
    await expect(alice.page.getByTestId('owner-note')).toContainText("You're the owner");
    await waitForRealtime(alice.page);
    // She waits on the Requests tab; nothing reloads her page from here on.
    await alice.page.getByRole('tab', { name: /Requests/ }).click();
    await expect(alice.page.getByText('No requests')).toBeVisible();

    // --- Bob finds it, sees the locked state, and asks to join.
    await bob.page.goto('/communities');
    await bob.page.getByLabel('Find a community').fill(communityName);
    await bob.page.getByRole('list', { name: 'Communities' }).getByRole('link', { name: new RegExp(communityName) }).click();
    await expect(bob.page.getByRole('heading', { level: 1, name: communityName })).toBeVisible();
    await expect(bob.page.getByTestId('community-locked')).toContainText('Private community');
    await waitForRealtime(bob.page);
    await bob.page.getByRole('button', { name: 'Request to join' }).click();
    await expect(bob.page.getByTestId('membership-pending')).toContainText('Request sent');

    // --- Alice sees the request live (bell + list) and approves it.
    await expect(alice.page.getByRole('link', { name: /Notifications, 1 unread/ })).toBeVisible({ timeout: 15_000 });
    const requests = alice.page.getByRole('list', { name: 'Join requests' });
    const request = requests.getByRole('listitem').filter({ hasText: 'Bob Rider' });
    await expect(request).toBeVisible({ timeout: 15_000 });
    await request.getByRole('button', { name: 'Approve' }).click();
    await expect(alice.page.getByText('No requests')).toBeVisible({ timeout: 15_000 });

    // --- Bob's page turns into a member's page without a reload: the chat tab appears.
    await expect(bob.page.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
    await expect(bob.page.getByTestId('member-count')).toHaveText('2 members');
    await bob.page.getByTestId('community-chat').getByRole('link', { name: 'Open chat' }).click();
    await expect(bob.page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/);
    const chatUrl = new URL(bob.page.url()).pathname;

    await alice.page.getByRole('tab', { name: 'Chat' }).click();
    await alice.page.getByTestId('community-chat').getByRole('link', { name: 'Open chat' }).click();
    await expect(alice.page).toHaveURL(chatUrl);
    await waitForRealtime(alice.page);
    await waitForRealtime(bob.page);

    // --- Typing indicator (Bob types, Alice sees it).
    const bobInput = bob.page.getByRole('textbox', { name: 'Message' });
    const aliceTyping = alice.page.getByTestId('typing-indicator');
    await expect(async () => {
      await bobInput.pressSequentially('Hel');
      await expect(aliceTyping).toContainText('Bob Rider is typing', { timeout: 2_500 });
    }).toPass({ timeout: 25_000, intervals: [3_200] });
    await bobInput.fill('');

    // --- Messages both ways, live.
    const aliceInput = alice.page.getByRole('textbox', { name: 'Message' });
    await aliceInput.fill('Hello from Alice');
    await aliceInput.press('Enter');
    await expect(alice.page.getByTestId('message').filter({ hasText: 'Hello from Alice' })).toHaveAttribute('data-status', 'sent');
    await expect(bob.page.getByTestId('message').filter({ hasText: 'Hello from Alice' })).toBeVisible({ timeout: 15_000 });

    await bobInput.fill('Hi Alice, Bob here');
    await bobInput.press('Enter');
    await expect(alice.page.getByTestId('message').filter({ hasText: 'Hi Alice, Bob here' })).toBeVisible({ timeout: 15_000 });
    await expect(aliceTyping).toHaveText('');

    // --- Location message (Alice shares her position after a confirmation).
    await alice.page.getByRole('button', { name: 'Attach' }).click();
    await alice.page.getByRole('menuitem', { name: 'My location' }).click();
    await alice.page.getByRole('alertdialog').getByRole('button', { name: 'Send location' }).click();
    const bobLocation = bob.page.getByTestId('message-location').last();
    await expect(bobLocation).toBeVisible({ timeout: 15_000 });
    await expect(bobLocation).toContainText('43.23890, 76.88970');
    await expect(bobLocation.getByRole('link', { name: 'Open in maps' })).toHaveAttribute('href', /openstreetmap\.org\/\?mlat=43\.2389/);

    // --- Alice (owner) promotes Bob to moderator.
    await alice.page.goto(communityUrl);
    await alice.page.getByRole('tab', { name: 'Members' }).click();
    const bobRow = alice.page.getByRole('list', { name: 'Members' }).getByRole('listitem').filter({ hasText: 'Bob Rider' });
    await bobRow.getByRole('button', { name: 'Actions for Bob Rider' }).click();
    await alice.page.getByRole('menuitem', { name: 'Make moderator' }).click();
    await expect(alice.page.getByText('Bob Rider is now a moderator')).toBeVisible();
    await expect(bobRow).toContainText('Moderator');
    await alice.page.goto(chatUrl);
    await waitForRealtime(alice.page);
    const aliceMessage = alice.page.getByTestId('message').filter({ hasText: 'Hello from Alice' });
    await expect(aliceMessage).toBeVisible();

    // --- Bob, now a moderator (told live), deletes Alice's message; Alice sees the placeholder live.
    await expect(bob.page.getByText(/You're now a moderator of/).first()).toBeVisible({ timeout: 15_000 });
    const onBob = bob.page.getByTestId('message').filter({ hasText: 'Hello from Alice' });
    await expect(onBob.getByRole('button', { name: 'Message actions' })).toBeAttached({ timeout: 15_000 });
    await onBob.getByRole('button', { name: 'Message actions' }).click();
    await bob.page.getByRole('menuitem', { name: 'Delete message' }).click();
    await bob.page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(alice.page.locator('[data-testid="message"][data-deleted]')).toContainText('Message deleted', { timeout: 15_000 });
    await expect(alice.page.getByText('Hello from Alice')).toHaveCount(0);

    for (const page of [alice.page, bob.page]) expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  } finally {
    await alice.close();
    await bob.close();
  }
});

test('map community filter sends the chosen communities', async ({ page, context }) => {
  test.setTimeout(90_000);
  await useEnglish(context);
  await useTestIp(page);
  const user = await signUpViaApi(page, 'Filter Tester');
  const community = await apiAs<{ id: string }>(page, user, 'POST', '/communities', {
    name: uniqueName('E2E Map Club'),
    description: '',
    isPrivate: false,
  });

  await page.goto('/map');
  await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await page.getByTestId('map-filters-button').click();
  const filter = page.getByTestId('community-filter');
  await expect(filter).toBeVisible();
  const withCommunity = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.endsWith('/map/users') && url.searchParams.get('communityIds') === community.id;
  });
  await filter.getByRole('checkbox', { name: /E2E Map Club/ }).check();
  await page.getByRole('button', { name: 'Show drivers' }).click();
  await withCommunity;
  await expect(page.getByTestId('map-filters-button')).toHaveAccessibleName('Filters, 1 active');
  // Nobody else is in the new community: the status pill reports the (possibly empty) result.
  await expect(page.getByTestId('map-count').or(page.getByTestId('map-empty'))).toBeVisible({ timeout: 15_000 });

  // The choice is remembered; reset clears it.
  await page.reload();
  await expect(page.getByTestId('map-filters-button')).toHaveAccessibleName('Filters, 1 active');
  await page.getByTestId('map-filters-button').click();
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await expect(page.getByTestId('community-filter').getByRole('checkbox')).not.toBeChecked();
});

test('communities pages fit 320px and are keyboard reachable', async ({ page, context }) => {
  test.setTimeout(90_000);
  await useEnglish(context);
  await useTestIp(page);
  await page.setViewportSize({ width: 320, height: 640 });
  const user = await signUpViaApi(page, 'Narrow Screen Driver');
  const community = await apiAs<{ id: string; chatId: string }>(page, user, 'POST', '/communities', {
    name: uniqueName('Очень длинное название клуба'),
    description: 'Описание сообщества, которое переносится на несколько строк на узком экране.',
    city: 'Almaty',
    isPrivate: true,
  });
  await apiAs(page, user, 'POST', `/chats/${community.chatId}/messages`, { type: 'text', text: 'Длинноесловобезпробеловкотороедолжнопереноситьсяправильно'.repeat(2) });
  await apiAs(page, user, 'POST', `/chats/${community.chatId}/messages`, { type: 'location', lat: 43.25, lng: 76.95 });

  for (const path of ['/communities', '/communities/new', `/communities/${community.id}`, '/chats', `/chats/${community.chatId}`]) {
    await page.goto(path);
    await expect(page.locator('main h1').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);
    expect(await horizontalOverflow(page), path).toBeLessThanOrEqual(0);
  }

  // The composer is reachable by keyboard and sends with Enter.
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.focus();
  await page.keyboard.type('Sent with the keyboard');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('message').filter({ hasText: 'Sent with the keyboard' })).toHaveAttribute('data-status', 'sent');

  // Settings sheet opens for the owner and fits too.
  await page.goto(`/communities/${community.id}`);
  await page.getByRole('button', { name: 'Community settings' }).click();
  await expect(page.getByTestId('community-settings')).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});
