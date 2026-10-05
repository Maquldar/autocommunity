import { expect, test } from '@playwright/test';
import path from 'node:path';
import { enterCode, horizontalOverflow, randomNickname, randomPhone, requestCodeInUi, useEnglish, useTestIp } from './helpers';

const AVATAR = path.join(__dirname, 'fixtures', 'avatar.png');

test.beforeEach(async ({ context, page }) => {
  await useEnglish(context);
  await useTestIp(page);
});

test('visiting /profile signed out redirects to /login with next', async ({ page }) => {
  await page.goto('/profile');
  await expect(page).toHaveURL(/\/login\?next=%2Fprofile$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in or create an account' })).toBeVisible();
});

test('sign up, onboard, edit profile and cars, survive reload, log out and back in', async ({ page }) => {
  // Includes waiting out the 60 s OTP resend cooldown before signing in again.
  test.setTimeout(240_000);
  const phone = randomPhone();
  const nickname = randomNickname();

  // --- Sign up with a new phone number
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in or create an account');
  const code = await requestCodeInUi(page, phone);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Enter the code');
  await enterCode(page, code);

  // --- Onboarding 1/3: profile with avatar
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByText('Step 1 of 3')).toBeVisible();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Aidana E2E');
  await page.getByLabel('Nickname').fill(nickname);
  await page.getByRole('combobox', { name: 'City' }).click();
  await page.getByRole('option', { name: 'Almaty' }).click();
  await page.getByTestId('avatar-input').setInputFiles(AVATAR);
  await expect(page.getByRole('button', { name: 'Remove photo', exact: true })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  // --- 2/3: car (back and forth keeps the input)
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  await page.getByLabel('Brand').fill('Toyota');
  await page.getByLabel('Model').fill('Camry');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByLabel('Nickname')).toHaveValue(nickname);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByLabel('Brand')).toHaveValue('Toyota');
  await page.getByLabel('Year').fill('2018');
  await page.getByLabel(/Licence plate/).fill('123abc02');
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  // --- 3/3: privacy
  await expect(page.getByText('Step 3 of 3')).toBeVisible();
  await page.getByRole('radio', { name: /Friends only/ }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByText('Please confirm your consent to continue')).toBeVisible();
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();

  // --- Onboarding ends on the map (home); the profile shows the saved data
  await expect(page).toHaveURL(/\/map$/);
  await page.goto('/profile');
  await expect(page.getByRole('heading', { level: 1, name: 'Aidana E2E' })).toBeVisible();
  await expect(page.getByText(`@${nickname}`)).toBeVisible();
  await expect(page.getByText('Almaty')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Aidana E2E' }).locator('img')).toHaveAttribute('src', /\/media\//);
  await expect(page.getByText('Toyota Camry')).toBeVisible();
  await expect(page.getByText('2018 · 123ABC02')).toBeVisible();

  // --- Edit bio
  await page.getByRole('link', { name: 'Edit profile' }).click();
  await expect(page).toHaveURL(/\/profile\/edit$/);
  await page.getByLabel('About you').fill('Happy to help with a jump start in Almaty.');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByText('Happy to help with a jump start in Almaty.')).toBeVisible();

  // --- Second car, then make it primary
  await page.getByRole('button', { name: 'Add car', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a car' });
  await dialog.getByLabel('Brand').fill('Lada');
  await dialog.getByLabel('Model').fill('Vesta');
  await dialog.getByLabel('Year').fill('2022');
  await dialog.getByRole('button', { name: 'Add car', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Lada Vesta')).toBeVisible();
  await page.getByRole('button', { name: 'Actions for Lada Vesta', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Make primary' }).click();
  await expect(page.getByText('Lada Vesta is now your primary car')).toBeVisible();
  const primaryRow = page.locator('[data-vehicle]').filter({ has: page.getByText('Primary', { exact: true }) });
  await expect(primaryRow).toHaveAttribute('data-vehicle', 'Lada Vesta');

  // --- The session survives a reload (in-memory token → refresh cookie)
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Aidana E2E' })).toBeVisible();
  await expect(page.locator('[data-vehicle="Lada Vesta"]').getByText('Primary', { exact: true })).toBeVisible();

  // --- Log out
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/profile');
  await expect(page).toHaveURL(/\/login\?next=/);

  // --- Sign in again with the same number → straight home (the map), not onboarding
  await page.goto('/login');
  const secondCode = await requestCodeInUi(page, phone);
  await enterCode(page, secondCode);
  await expect(page).toHaveURL(/\/map$/);
  await page.goto('/profile');
  await expect(page.getByRole('heading', { level: 1, name: 'Aidana E2E' })).toBeVisible();
});

test('wrong code shows the attempts left', async ({ page }) => {
  await page.goto('/login');
  const code = await requestCodeInUi(page, randomPhone());
  const wrong = code === '000000' ? '111111' : '000000';
  await enterCode(page, wrong);
  await expect(page.getByText('Wrong code. 4 attempts left.')).toBeVisible();
});

test('public pages fit a 320px screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of ['/login', '/legal/privacy', '/legal/terms']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await horizontalOverflow(page), path).toBeLessThanOrEqual(0);
  }
});
