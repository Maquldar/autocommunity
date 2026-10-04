import { expect, test } from '@playwright/test';
import { horizontalOverflow, signUpViaApi, useEnglish, useTestIp } from './helpers';

test.beforeEach(async ({ context, page }) => {
  await useEnglish(context);
  await useTestIp(page);
});

test('privacy mode change persists after reload', async ({ page }) => {
  await signUpViaApi(page);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  // Default for new users is "My communities".
  await expect(page.getByRole('radio', { name: /My communities/ })).toBeChecked();

  await page.getByRole('radio', { name: /Everyone/ }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
  await page.getByRole('switch', { name: 'Receive SOS alerts nearby' }).click();
  await expect(page.getByRole('switch', { name: 'Receive SOS alerts nearby' })).not.toBeChecked();

  await page.reload();
  await expect(page.getByRole('radio', { name: /Everyone/ })).toBeChecked();
  await expect(page.getByRole('switch', { name: 'Receive SOS alerts nearby' })).not.toBeChecked();
});

test('delete account requires typing DELETE and returns to the landing page', async ({ page }) => {
  await signUpViaApi(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Delete account', exact: true }).click();

  const dialog = page.getByRole('alertdialog', { name: 'Delete your account?' });
  const confirm = dialog.getByRole('button', { name: 'Delete forever', exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Type DELETE to confirm').fill('DELETE');
  await confirm.click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Your account has been deleted')).toBeVisible();
  // The session is gone for good.
  await page.goto('/profile');
  await expect(page).toHaveURL(/\/login\?next=/);
});

test('signed-in pages fit a 320px screen', async ({ page }) => {
  await signUpViaApi(page);
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of ['/profile', '/profile/edit', '/settings']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await horizontalOverflow(page), path).toBeLessThanOrEqual(0);
  }
});
