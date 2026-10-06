import { expect, test, type Browser, type Page } from '@playwright/test';
import path from 'node:path';
import { ADMIN_PHONE, apiAs, SEEDED_REPORTER_PHONE, horizontalOverflow, signInInUi, signInViaApi, signUpViaApi, useEnglish, useTestIp } from './helpers';

const PHOTO = path.join(__dirname, 'fixtures', 'avatar.png');

async function newContext(browser: Browser, width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  await useEnglish(context);
  const page = await context.newPage();
  await useTestIp(page);
  return { context, page };
}

async function openViolations(page: Page, vehicleId: string) {
  await page.goto(`/vehicles/${vehicleId}?tab=violations`);
  await expect(page.getByRole('tab', { name: /Violations/ })).toHaveAttribute('aria-selected', 'true');
}

test('violations: a driver reports a car, the owner sees it pending, an admin approves, it becomes public', async ({ browser }, testInfo) => {
  // One admin sign-in per run (the seeded admin phone is rate-limited like every number).
  test.skip(testInfo.project.name !== 'desktop', 'admin moderation runs once per e2e run');
  test.setTimeout(300_000);
  const owner = await newContext(browser);
  const reporter = await newContext(browser);
  const admin = await newContext(browser, 1280);
  try {
    const olga = await signUpViaApi(owner.page, 'Olga Owner');
    const car = await apiAs<{ id: string }>(owner.page, olga, 'POST', '/me/vehicles', {
      brand: 'Lada',
      model: 'Vesta',
      year: 2021,
      fuel: 'petrol',
      transmission: 'manual',
      color: 'white',
      mileageKm: 42000,
    });
    // Reporting someone else's car needs an account ≥ 7 days and rating ≥ 40: a seeded driver.
    await signInViaApi(reporter.page, SEEDED_REPORTER_PHONE);

    // --- The vehicle page: details, the owner, and the violations tab.
    await reporter.page.goto(`/vehicles/${car.id}`);
    await expect(reporter.page.getByRole('heading', { level: 1, name: 'Lada Vesta' })).toBeVisible();
    await expect(reporter.page.getByTestId('vehicle-facts')).toContainText('42,000 km');
    await expect(reporter.page.getByTestId('vehicle-owner')).toContainText('Olga Owner');
    expect(await horizontalOverflow(reporter.page)).toBeLessThanOrEqual(0);
    await reporter.page.getByTestId('vehicle-violations-tab').click();
    await expect(reporter.page).toHaveURL(/tab=violations/);

    // --- Report: category, code, article, description, one photo.
    const description = `Ran a red light at Abay/Dostyk ${Date.now()}`;
    await reporter.page.getByTestId('report-violation').click();
    const dialog = reporter.page.getByTestId('violation-dialog');
    await expect(dialog).toContainText('only after a moderator approves it');
    await expect(dialog).toContainText('False reports lower your trust rating');
    await dialog.getByRole('button', { name: 'Send for review' }).click();
    await expect(dialog.getByText('Choose the violation.')).toBeVisible();
    await expect(dialog.getByText('Add at least 1 photo.')).toBeVisible();
    await dialog.getByTestId('violation-category').click();
    await reporter.page.getByRole('option', { name: 'Running a red light' }).click();
    await dialog.getByTestId('violation-article').fill('Art. 599');
    await dialog.getByTestId('violation-description').fill(description);
    await dialog.getByTestId('violation-photo-input').setInputFiles(PHOTO);
    await expect(dialog.getByTestId('violation-photo-draft')).toHaveCount(1);
    await dialog.getByRole('button', { name: 'Send for review' }).click();
    await expect(dialog).toBeHidden();
    await expect(reporter.page.getByText('Report sent for review')).toBeVisible();
    // Pending reports are not public.
    await expect(reporter.page.getByText('No confirmed violations')).toBeVisible();

    // --- My reports lists it as under review.
    await reporter.page.goto('/settings/violations');
    const mine = reporter.page.getByTestId('violation-card').filter({ hasText: description });
    await expect(mine.getByTestId('violation-status')).toHaveText('Under review');

    // --- The owner sees it with its status and can dispute it.
    await openViolations(owner.page, car.id);
    const pending = owner.page.getByTestId('violation-card').filter({ hasText: description });
    await expect(pending).toHaveAttribute('data-status', 'pending');
    await expect(pending.getByTestId('violation-dispute-button')).toBeVisible();

    // --- The admin approves it with a note.
    await signInInUi(admin.page, ADMIN_PHONE);
    await admin.page.goto('/admin/violations');
    const card = admin.page.getByTestId('admin-violation').filter({ hasText: description });
    await expect(card).toBeVisible();
    await expect(card.getByRole('list', { name: 'Evidence' }).locator('img')).toHaveCount(1);
    await card.getByTestId('admin-violation-approve').click();
    const confirm = admin.page.getByRole('alertdialog');
    await confirm.getByTestId('admin-note').fill('Clear photo of the red light');
    await confirm.getByRole('button', { name: 'Approve' }).click();
    await expect(confirm).toBeHidden({ timeout: 15_000 });
    await expect(card).toHaveCount(0);

    // --- Now it is public on the vehicle, for everyone.
    await openViolations(reporter.page, car.id);
    const approved = reporter.page.getByTestId('violation-card').filter({ hasText: description });
    await expect(approved).toBeVisible();
    await expect(approved).toContainText('Running a red light');
    await expect(approved).toContainText('Art. 599');
    await expect(reporter.page.getByTestId('vehicle-violations-tab')).toContainText('(1)');
  } finally {
    await owner.context.close();
    await reporter.context.close();
    await admin.context.close();
  }
});
