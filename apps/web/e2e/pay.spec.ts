import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiAs, DEMO_PHONE, horizontalOverflow, signInViaApi, topUpViaApi, useEnglish, useTestIp } from './helpers';

/** The seed's deterministic payTag for the RP demo station (apps/api/prisma/seed/services.ts `seedPayTag`). */
const RP_TAG = createHash('sha256').update('seed-paytag:RP').digest('base64url').slice(0, 22);

test('pay at a point: NFC tag → 5 l of АИ-95 with coins → receipt, the balance drops by 1 225', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'one purchase per run with the shared demo account');
  test.setTimeout(180_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await useEnglish(context);
  const page = await context.newPage();
  try {
    await useTestIp(page);
    const demo = await signInViaApi(page, DEMO_PHONE);
    let before = (await apiAs<{ balance: number }>(page, demo, 'GET', '/wallet')).balance;
    if (before < 1225) {
      await topUpViaApi(page, demo, 2000);
      before += 2000;
    }

    // The scanner "reads" the RP sticker (dev-only ?simulateTag) and opens its checkout.
    await page.goto(`/pay?simulateTag=${RP_TAG}`);
    await expect(page.getByTestId('nfc-hero')).toHaveAttribute('data-state', 'detected');
    await expect(page.getByTestId('nfc-status')).toContainText('RP');
    await expect(page).toHaveURL(new RegExp(`/pay/t/${RP_TAG}$`), { timeout: 15_000 });
    await expect(page.getByTestId('pay-point-name')).toHaveText('RP');

    // АИ-95, 5 liters: the total is computed from the server's price list (245 per liter).
    await page.getByTestId('pay-item').filter({ hasText: 'АИ-95' }).click();
    await page.getByTestId('pay-preset-20').click();
    await expect(page.getByTestId('pay-total')).toHaveAttribute('data-total', '4900');
    await page.getByTestId('pay-qty').fill('5');
    await expect(page.getByTestId('pay-total')).toHaveAttribute('data-total', '1225');
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await page.getByTestId('pay-next').click();

    // Method: the coin balance is shown, Google Pay is offered in TEST mode.
    await expect(page.getByTestId('pay-balance')).toHaveAttribute('data-balance', String(before));
    await expect(page.getByTestId('pay-method-gpay')).toContainText('Google Pay');
    await page.getByTestId('pay-method-coins').click();
    await page.getByTestId('pay-confirm').click();

    // Receipt with the new balance; the wallet agrees.
    await expect(page).toHaveURL(/\/pay\/orders\/[0-9a-f-]+\?new=1$/);
    await expect(page.getByTestId('receipt-total')).toHaveAttribute('data-total', '1225');
    await expect(page.getByTestId('receipt-balance')).toHaveAttribute('data-balance', String(before - 1225));
    await expect(page.getByTestId('receipt-line')).toContainText('АИ-95');
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await page.goto('/wallet');
    await expect(page.getByTestId('wallet-balance')).toHaveAttribute('data-balance', String(before - 1225));
    const latest = page.getByTestId('wallet-tx').first();
    await expect(latest).toHaveAttribute('data-kind', 'purchase');
    await expect(latest).toContainText('RP');
  } finally {
    await context.close();
  }
});
