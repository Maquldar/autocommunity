import { expect, test, type Browser, type Page } from '@playwright/test';
import { horizontalOverflow, signUpViaApi, useEnglish, useTestIp } from './helpers';

/** A signed-up, onboarded driver in its own browser context (its own cookies and socket). */
async function newDriver(browser: Browser, name: string): Promise<{ page: Page; nickname: string; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await useEnglish(context);
  const page = await context.newPage();
  await useTestIp(page);
  const { nickname } = await signUpViaApi(page, name);
  return { page, nickname, close: () => context.close() };
}

test('friend request arrives live, is accepted, and both see each other as friends', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'two-browser journey runs once per e2e run');
  test.setTimeout(120_000);

  const alice = await newDriver(browser, 'Alice E2E');
  const bob = await newDriver(browser, 'Bob E2E');
  try {
    // Bob waits on the notifications page; nothing reloads it from here on.
    await bob.page.goto('/notifications');
    await expect(bob.page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
    await expect(bob.page.getByText('No notifications yet')).toBeVisible();

    // Alice finds Bob by nickname and sends a request.
    await alice.page.goto('/friends');
    await alice.page.getByLabel('Find drivers').fill(bob.nickname);
    const result = alice.page.getByRole('list', { name: 'Drivers found' }).getByRole('listitem').filter({ hasText: `@${bob.nickname}` });
    await result.getByRole('button', { name: 'Add friend' }).click();
    await expect(result.getByRole('button', { name: /Cancel request|Request sent/ })).toBeVisible();

    // Bob gets it over the socket: the bell counter and the list update without a reload.
    await expect(bob.page.getByRole('link', { name: /Notifications, 1 unread/ })).toBeVisible({ timeout: 15_000 });
    const request = bob.page.getByText('Alice E2E', { exact: false }).first();
    await expect(request).toBeVisible({ timeout: 15_000 });
    await bob.page.getByRole('button', { name: 'Accept' }).first().click();
    await expect(bob.page.getByText('Request accepted').first()).toBeVisible();

    // Alice is told live as well, and both friend lists show the other driver.
    await expect(alice.page.getByRole('link', { name: /Notifications, 1 unread/ })).toBeVisible({ timeout: 15_000 });
    // The tabs are replaced by search results while a query is typed.
    await alice.page.getByLabel('Find drivers').fill('');
    await alice.page.getByRole('tab', { name: /^Friends/ }).click();
    await expect(alice.page.getByRole('list', { name: 'Your friends' }).getByText(`@${bob.nickname}`)).toBeVisible();
    await bob.page.goto('/friends');
    await expect(bob.page.getByRole('list', { name: 'Your friends' }).getByText(`@${alice.nickname}`)).toBeVisible();

    // Alice removes Bob (with confirmation); Bob's list updates after the live `friends:changed`.
    const bobRow = alice.page.getByRole('list', { name: 'Your friends' }).getByRole('listitem').filter({ hasText: `@${bob.nickname}` });
    await bobRow.getByRole('button', { name: /Friends/ }).click();
    await alice.page.getByRole('menuitem', { name: 'Remove from friends' }).click();
    await alice.page.getByRole('alertdialog').getByRole('button', { name: /Remove/ }).click();
    await expect(alice.page.getByText('No friends yet')).toBeVisible();
    await expect(bob.page.getByText('No friends yet')).toBeVisible({ timeout: 15_000 });

    for (const page of [alice.page, bob.page]) expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  } finally {
    await alice.close();
    await bob.close();
  }
});
