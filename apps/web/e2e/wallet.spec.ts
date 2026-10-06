import { expect, test, type Browser, type Page } from '@playwright/test';
import { DEMO_PHONE, horizontalOverflow, signInViaApi, signUpViaApi, useEnglish, useTestIp, waitForRealtime, dismissSosAlerts } from './helpers';

async function newContext(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await useEnglish(context);
  const page = await context.newPage();
  await useTestIp(page);
  await dismissSosAlerts(page);
  return { context, page };
}

async function balance(page: Page): Promise<number> {
  const el = page.getByTestId('wallet-balance');
  await expect(el).toHaveAttribute('data-balance', /^\d+$/);
  return Number(await el.getAttribute('data-balance'));
}

test('wallet: top up with the demo card (after a decline), send coins to another driver, who sees them live', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'two-user journey with the shared demo account runs once per e2e run');
  test.setTimeout(240_000);
  const sender = await newContext(browser);
  const recipient = await newContext(browser);
  try {
    // The seeded demo driver is old enough and trusted enough to send coins (≥ 24 h, rating ≥ 30).
    await signInViaApi(sender.page, DEMO_PHONE);
    const rita = await signUpViaApi(recipient.page, 'Rita Recipient');

    // --- Recipient waits on her wallet (balance 0, live updates).
    await recipient.page.goto('/wallet');
    await expect(recipient.page.getByTestId('wallet-balance')).toHaveAttribute('data-balance', '0');
    await expect(recipient.page.getByTestId('wallet-no-cashout')).toContainText("can't be cashed out");
    await waitForRealtime(recipient.page);

    // --- Sender: top up 2 000 coins. A declined card first, then the test card.
    await sender.page.goto('/wallet');
    const before = await balance(sender.page);
    await sender.page.getByRole('button', { name: 'Top up' }).click();
    const topup = sender.page.getByTestId('topup-dialog');
    await topup.getByRole('button', { name: '2,000 coins' }).click();
    await topup.getByRole('button', { name: 'Pay 2,000 ₸' }).click();
    await expect(sender.page).toHaveURL(/\/wallet\/checkout\/[0-9a-f-]+$/);
    await expect(sender.page.getByTestId('checkout-amount')).toHaveText('2,000 ₸');
    await expect(sender.page.getByTestId('test-card-hint')).toContainText('4242 4242 4242 4242');
    expect(await horizontalOverflow(sender.page)).toBeLessThanOrEqual(0);

    await sender.page.getByTestId('card-number').fill('4000 0000 0000 0002');
    await sender.page.getByRole('button', { name: 'Pay 2,000 ₸' }).click();
    await expect(sender.page.getByTestId('checkout-outcome')).toHaveAttribute('data-kind', 'declined');
    await sender.page.getByRole('button', { name: 'Try again' }).click();
    await expect(sender.page.getByTestId('card-number')).toBeVisible();
    await sender.page.getByRole('button', { name: 'Use it' }).click();
    await sender.page.getByRole('button', { name: 'Pay 2,000 ₸' }).click();
    await expect(sender.page).toHaveURL(/\/wallet$/);
    await expect(sender.page.getByTestId('wallet-balance')).toHaveAttribute('data-balance', String(before + 2000));
    await expect(sender.page.getByTestId('wallet-tx').first()).toHaveAttribute('data-kind', 'topup');
    expect(await horizontalOverflow(sender.page)).toBeLessThanOrEqual(0);

    // --- Send 500 coins to Rita, found by nickname; the confirm step shows who gets them.
    await sender.page.getByRole('button', { name: 'Send coins' }).click();
    const dialog = sender.page.getByTestId('transfer-dialog');
    await dialog.getByTestId('transfer-search').fill(rita.nickname);
    await dialog.getByTestId('transfer-candidate').filter({ hasText: `@${rita.nickname}` }).click();
    await dialog.getByTestId('transfer-amount').fill('500');
    await dialog.getByTestId('transfer-message').fill('Thanks for the jump start');
    await dialog.getByRole('button', { name: 'Next' }).click();
    await expect(dialog.getByTestId('transfer-confirm')).toContainText('Rita Recipient');
    await expect(dialog.getByTestId('transfer-confirm-amount')).toHaveText('500 coins');
    await dialog.getByTestId('transfer-send').click();
    await expect(dialog).toBeHidden();
    await expect(sender.page.getByText('500 coins sent to Rita Recipient')).toBeVisible();
    await expect(sender.page.getByTestId('wallet-balance')).toHaveAttribute('data-balance', String(before + 1500));

    // --- Rita: live toast, balance and history, then the notification.
    await expect(recipient.page.getByText(/sent you 500 coins/).first()).toBeVisible({ timeout: 20_000 });
    await expect(recipient.page.getByTestId('wallet-balance')).toHaveAttribute('data-balance', '500');
    const received = recipient.page.getByTestId('wallet-tx').first();
    await expect(received).toHaveAttribute('data-kind', 'transfer_in');
    await expect(received).toContainText('Thanks for the jump start');
    await recipient.page.goto('/notifications');
    const item = recipient.page.getByRole('link', { name: /sent you 500 coins/ });
    await expect(item).toHaveAttribute('href', '/wallet');
  } finally {
    await sender.context.close();
    await recipient.context.close();
  }
});
