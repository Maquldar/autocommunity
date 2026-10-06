import { expect, test, type Browser } from '@playwright/test';
import { apiAs, signUpViaApi, useEnglish, useTestIp } from './helpers';

async function newDriver(browser: Browser, name: string) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await useEnglish(context);
  const page = await context.newPage();
  await useTestIp(page);
  const user = await signUpViaApi(page, name);
  return { page, user, close: () => context.close() };
}

test('report a driver and a message; both appear in My reports as open; a repeat is refused', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'two-user test runs once per e2e run');
  test.setTimeout(120_000);
  const rita = await newDriver(browser, 'Rita Reporter');
  const sam = await newDriver(browser, 'Sam Spammer');
  try {
    // Sam writes to Rita.
    const chat = await apiAs<{ id: string }>(sam.page, sam.user, 'POST', '/chats/direct', { userId: rita.user.id });
    await apiAs(sam.page, sam.user, 'POST', `/chats/${chat.id}/messages`, { type: 'text', text: 'Buy cheap tyres now!!! call me' });

    // --- Report the driver from his profile
    await rita.page.goto(`/u/${sam.user.id}`);
    await rita.page.getByRole('button', { name: 'Report driver' }).click();
    const dialog = rita.page.getByTestId('report-dialog');
    await expect(dialog.getByRole('heading', { name: 'Report this driver' })).toBeVisible();
    // fake_sos is only offered for SOS.
    await expect(dialog.getByRole('radio', { name: /Fake SOS/ })).toHaveCount(0);
    // A reason is required.
    await dialog.getByRole('button', { name: 'Send report' }).click();
    await expect(dialog.getByText('Choose a reason.')).toBeVisible();
    await dialog.getByRole('radio', { name: /Spam or ads/ }).click();
    await dialog.getByLabel('Details').fill('Sends ads to everyone');
    await dialog.getByRole('button', { name: 'Send report' }).click();
    await expect(dialog).toBeHidden();
    await expect(rita.page.getByText('Report sent.')).toBeVisible();

    // A second report on the same driver is refused while the first is open.
    await rita.page.getByRole('button', { name: 'Report driver' }).click();
    await dialog.getByRole('radio', { name: /Harassment/ }).click();
    await dialog.getByRole('button', { name: 'Send report' }).click();
    await expect(dialog.getByTestId('report-error')).toHaveText("You've already reported this. Moderators will look at it soon.");
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    // --- Report the message from the conversation (⋯ menu beside it)
    await rita.page.goto(`/chats/${chat.id}`);
    const message = rita.page.getByTestId('message').filter({ hasText: 'Buy cheap tyres' });
    await expect(message).toBeVisible();
    await message.getByRole('button', { name: 'Message actions' }).click();
    await rita.page.getByRole('menuitem', { name: 'Report' }).click();
    await expect(dialog.getByRole('heading', { name: 'Report this message' })).toBeVisible();
    await dialog.getByRole('radio', { name: /Fraud or scam/ }).click();
    await dialog.getByRole('button', { name: 'Send report' }).click();
    await expect(dialog).toBeHidden();

    // --- My reports (settings)
    await rita.page.goto('/settings');
    await rita.page.getByRole('link', { name: /My reports/ }).click();
    await expect(rita.page).toHaveURL(/\/settings\/reports$/);
    const rows = rita.page.getByTestId('my-report');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'Driver · Spam or ads' })).toContainText('Under review');
    await expect(rows.filter({ hasText: 'Message · Fraud or scam' })).toHaveAttribute('data-status', 'open');
  } finally {
    await rita.close();
    await sam.close();
  }
});
