import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { horizontalOverflow, signUpViaApi, useEnglish, useTestIp, waitForRealtime, type SignedUp } from './helpers';

const PHOTO = path.join(__dirname, 'fixtures', 'avatar.png');

async function newDriver(browser: Browser, name: string): Promise<{ page: Page; user: SignedUp; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await useEnglish(context);
  const page = await context.newPage();
  await useTestIp(page);
  const user = await signUpViaApi(page, name);
  return { page, user, close: () => context.close() };
}

test('direct message from a profile: text and photo, live unread badge on the other side, then read', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'two-browser journey runs once per e2e run');
  test.setTimeout(180_000);

  const anna = await newDriver(browser, 'Anna Sender');
  const timur = await newDriver(browser, 'Timur Receiver');
  try {
    // Timur waits on his (empty) chat list.
    await timur.page.goto('/chats');
    await expect(timur.page.getByText('No chats yet')).toBeVisible();
    await waitForRealtime(timur.page);

    // Anna opens Timur's profile and taps "Message".
    await anna.page.goto(`/u/${timur.user.id}`);
    await anna.page.getByRole('button', { name: 'Message' }).click();
    await expect(anna.page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    await expect(anna.page.getByRole('heading', { level: 1, name: 'Timur Receiver' })).toBeVisible();
    await expect(anna.page.getByText('No messages yet')).toBeVisible();
    await waitForRealtime(anna.page);

    // Text: optimistic, then confirmed.
    const input = anna.page.getByRole('textbox', { name: 'Message' });
    await input.fill('Hi Timur! Are you near Abay avenue?');
    await input.press('Enter');
    const text = anna.page.getByTestId('message').filter({ hasText: 'Hi Timur!' });
    await expect(text).toHaveAttribute('data-status', 'sent', { timeout: 15_000 });
    await expect(input).toHaveValue('');

    // Timur's list gets the new chat and an unread badge, live; so does the Chats tab.
    const row = timur.page.getByTestId('chat-row').filter({ hasText: 'Anna Sender' });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toHaveAttribute('data-unread', '1');
    await expect(row).toContainText('Hi Timur! Are you near Abay avenue?');
    await expect(timur.page.getByTestId('nav-chats')).toHaveAccessibleName('Chats, 1 unread');

    // Photo (fixture image) with a caption.
    await anna.page.getByTestId('photo-input').setInputFiles(PHOTO);
    await expect(anna.page.getByTestId('photo-draft')).toBeVisible();
    await input.fill('This is my car');
    await anna.page.getByRole('button', { name: 'Send photo' }).click();
    const photo = anna.page.locator('[data-testid="message"][data-type="photo"]');
    await expect(photo).toHaveAttribute('data-status', 'sent', { timeout: 20_000 });
    await expect(photo.getByTestId('message-photo')).toHaveJSProperty('complete', true);
    await expect(row).toHaveAttribute('data-unread', '2', { timeout: 15_000 });
    await expect(row).toContainText('Photo: This is my car');
    await expect(timur.page.getByTestId('nav-chats')).toHaveAccessibleName('Chats, 2 unread');

    // Timur opens the chat: both messages are there, the photo loads, and everything is read.
    await row.click();
    await expect(timur.page.getByTestId('message').filter({ hasText: 'Hi Timur!' })).toBeVisible();
    const received = timur.page.locator('[data-testid="message"][data-type="photo"]');
    await expect(received.getByTestId('message-photo')).toBeVisible();
    await expect.poll(() => received.getByTestId('message-photo').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect(timur.page.getByTestId('day-separator').first()).toHaveText('Today');

    // Anna sees the read receipt live.
    await expect(photo).toContainText('Read', { timeout: 15_000 });

    // Back on the list the badge is gone, in the list and in the nav.
    await timur.page.getByRole('link', { name: 'Back' }).click();
    await expect(timur.page.getByTestId('chat-row').filter({ hasText: 'Anna Sender' })).toHaveAttribute('data-unread', '0');
    await expect(timur.page.getByTestId('nav-chats')).toHaveAccessibleName('Chats');

    // The photo viewer opens from the bubble and closes with Escape.
    await timur.page.getByTestId('chat-row').filter({ hasText: 'Anna Sender' }).click();
    await timur.page.getByRole('button', { name: 'Open photo' }).click();
    await expect(timur.page.getByRole('dialog')).toBeVisible();
    await timur.page.keyboard.press('Escape');
    await expect(timur.page.getByRole('dialog')).toBeHidden();

    // Timur deletes nothing of Anna's in a direct chat: her messages only offer "Report".
    await timur.page.getByTestId('message').filter({ hasText: 'Hi Timur!' }).getByRole('button', { name: 'Message actions' }).click();
    await expect(timur.page.getByRole('menuitem', { name: 'Report' })).toBeVisible();
    await expect(timur.page.getByRole('menuitem', { name: 'Delete message' })).toHaveCount(0);
    await timur.page.keyboard.press('Escape');

    for (const page of [anna.page, timur.page]) expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  } finally {
    await anna.close();
    await timur.close();
  }
});

test('own message can be deleted (keyboard) and shows the placeholder', async ({ page, context, browser }) => {
  test.setTimeout(90_000);
  await useEnglish(context);
  await useTestIp(page);
  await signUpViaApi(page, 'Solo Deleter');
  // The other driver lives in their own context (a shared cookie jar would switch the session).
  const otherContext = await browser.newContext();
  const other = await signUpViaApi(await otherContext.newPage(), 'Someone Else');
  await otherContext.close();
  await page.goto(`/u/${other.id}`);
  await page.getByRole('button', { name: 'Message' }).click();
  await expect(page).toHaveURL(/\/chats\//);
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Typo message');
  await input.press('Enter');
  const message = page.getByTestId('message').filter({ hasText: 'Typo message' });
  await expect(message).toHaveAttribute('data-status', 'sent');
  // Keyboard: focus the actions button and open the menu with Enter.
  await message.getByRole('button', { name: 'Message actions' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'Delete message' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('[data-testid="message"][data-deleted]')).toContainText('Message deleted');
});
