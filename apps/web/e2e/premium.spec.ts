import { expect, test } from '@playwright/test';
import { horizontalOverflow, signUpViaApi, topUpViaApi, useEnglish, useTestIp } from './helpers';

test('premium: a top-up prompt without coins, then subscribe → badge and frame on the profile', async ({ page, context }) => {
  test.setTimeout(120_000);
  await useEnglish(context);
  await useTestIp(page);
  const me = await signUpViaApi(page, 'Pavel Premium');

  // Without coins the page explains what's missing and offers a top-up.
  await page.goto('/premium');
  await expect(page.getByTestId('premium-status')).toHaveAttribute('data-active', 'false');
  await expect(page.getByTestId('premium-insufficient')).toContainText('You need 1,490 coins more to subscribe.');
  await expect(page.getByTestId('premium-subscribe')).toBeDisabled();
  await expect(page.getByTestId('premium-perks')).toContainText('Up to 10 cars instead of 5');
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  await topUpViaApi(page, me, 2000);
  await page.reload();
  await expect(page.getByTestId('premium-insufficient')).toBeHidden();
  await page.getByTestId('premium-subscribe').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Pay 1,490 coins' }).click();
  await expect(page.getByTestId('premium-status')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('premium-status').getByTestId('premium-badge')).toBeVisible();
  await expect(page.getByTestId('premium-auto-renew')).toHaveText('On');

  // Turn auto-renew off and back on.
  await page.getByRole('button', { name: 'Turn off auto-renew' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Turn off' }).click();
  await expect(page.getByTestId('premium-auto-renew')).toHaveText('Off');
  await page.getByRole('button', { name: 'Turn auto-renew back on' }).click();
  await expect(page.getByTestId('premium-auto-renew')).toHaveText('On');

  // The badge and the frame on the profile; the balance on the profile shows the charge.
  await page.goto('/profile');
  await expect(page.getByRole('heading', { level: 1, name: 'Pavel Premium' })).toBeVisible();
  await expect(page.locator('#main-content').getByTestId('premium-badge').first()).toHaveText('Premium');
  await expect(page.getByRole('img', { name: /Pavel Premium, Premium/ })).toHaveAttribute('data-premium', 'true');
  await expect(page.getByTestId('profile-balance')).toHaveAttribute('data-balance', '510');
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  // Others see it too.
  const other = await context.browser()!.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await useEnglish(other);
    const otherPage = await other.newPage();
    await useTestIp(otherPage);
    await signUpViaApi(otherPage, 'Olga Observer');
    await otherPage.goto(`/u/${me.id}`);
    await expect(otherPage.getByRole('img', { name: /Pavel Premium, Premium/ })).toBeVisible();
  } finally {
    await other.close();
  }
});
