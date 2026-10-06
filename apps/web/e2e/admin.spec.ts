import { expect, test, type Browser, type Page } from '@playwright/test';
import { API_URL, apiAs, horizontalOverflow, signInInUi, signUpViaApi, useEnglish, useTestIp, waitForRealtime, type SignedUp } from './helpers';

/** Seeded admin account (apps/api/prisma/seed). The dev OTP code is shown in the login hint. */
const ADMIN_PHONE = '+77000000001';

type Driver = { page: Page; user: SignedUp; close: () => Promise<void> };

async function newDriver(browser: Browser, name: string): Promise<Driver> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await useEnglish(context);
  const page = await context.newPage();
  await useTestIp(page);
  const user = await signUpViaApi(page, name);
  return { page, user, close: () => context.close() };
}

const tag = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 900 + 100)}`;

/** Fills the required note in the open admin dialog and confirms with `button`. */
async function confirmWithNote(page: Page, note: string, button: string | RegExp) {
  const dialog = page.getByRole('alertdialog');
  await dialog.getByTestId('admin-note').fill(note);
  await dialog.getByRole('button', { name: button }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

test('admin: dashboard, warn, resolve a report with content removal, block (live logout), verify a service', async ({ browser }, testInfo) => {
  // One admin sign-in per run: the seeded admin phone is rate-limited like every number (5 codes/h).
  test.skip(testInfo.project.name !== 'desktop', 'admin journey runs once per e2e run (desktop-first UI)');
  test.setTimeout(300_000);

  const reporter = await newDriver(browser, 'Reporter Driver');
  const offender = await newDriver(browser, 'Offender Driver');
  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await useEnglish(adminContext);
  const admin = await adminContext.newPage();
  await useTestIp(admin);
  try {
    // --- Setup through the API: the offender writes a DM to the reporter, who reports it; a pending service.
    const chat = await apiAs<{ id: string }>(offender.page, offender.user, 'POST', '/chats/direct', { userId: reporter.user.id });
    const spam = `Buy cheap licences ${tag()}`;
    const message = await apiAs<{ id: string }>(offender.page, offender.user, 'POST', `/chats/${chat.id}/messages`, { type: 'text', text: spam });
    await apiAs(reporter.page, reporter.user, 'POST', '/reports', { targetType: 'message', targetId: message.id, reason: 'spam', details: 'spam in DM' });
    const serviceName = `E2E Tyre Service ${tag()}`;
    const service = await apiAs<{ id: string; status: string }>(reporter.page, reporter.user, 'POST', '/services', {
      name: serviceName,
      category: 'tires',
      description: 'Tyre fitting',
      address: 'Abay Ave 150, Almaty',
      hours: { mon: '09:00-19:00', tue: '09:00-19:00', wed: '09:00-19:00', thu: '09:00-19:00', fri: '09:00-19:00', sat: null, sun: null },
      lat: 43.2 + Math.random() * 0.05,
      lng: 76.85 + Math.random() * 0.05,
    });
    expect(service.status).toBe('pending');
    const ratingBefore = (await apiAs<{ rating: number }>(reporter.page, reporter.user, 'GET', `/users/${offender.user.id}`)).rating;

    // --- The admin signs in and sees the dashboard (also from the account menu).
    await signInInUi(admin, ADMIN_PHONE);
    await admin.getByRole('button', { name: 'Account menu' }).click();
    await admin.getByTestId('account-menu-admin').click();
    await expect(admin).toHaveURL(/\/admin$/);
    await expect(admin.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(admin.getByTestId('stat-usersTotal')).toHaveText(/\d/);
    await expect(admin.getByTestId('stat-reportsOpen')).toHaveText(/[1-9]/);
    expect(await horizontalOverflow(admin)).toBeLessThanOrEqual(0);

    // --- Find the reporter and warn them; the warning reaches them.
    await admin.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Users' }).click();
    await admin.getByLabel('Search').fill(reporter.user.nickname);
    const row = admin.getByTestId('admin-user-row').filter({ hasText: `@${reporter.user.nickname}` });
    await expect(row).toHaveCount(1);
    await row.getByRole('link').click();
    await expect(admin.getByTestId('admin-user-name')).toHaveText('Reporter Driver');
    await admin.getByRole('button', { name: 'Warn' }).click();
    const warning = `Please keep the chats friendly ${tag()}`;
    await confirmWithNote(admin, warning, 'Warn');
    await expect(admin.getByTestId('count-warnings')).toHaveText('1');

    await reporter.page.goto('/notifications');
    await expect(reporter.page.getByText('Moderator warning')).toBeVisible({ timeout: 15_000 });
    await expect(reporter.page.getByTestId('notification-note').first()).toHaveText(warning);

    // --- Resolve the report: confirm + remove the message.
    await admin.goto('/admin/reports');
    const card = admin.getByTestId('report-card').filter({ hasText: spam });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Confirm' }).click();
    await expect(admin.getByRole('alertdialog').getByTestId('remove-content')).toBeChecked();
    await confirmWithNote(admin, 'Spam confirmed', 'Confirm');
    await expect(card).toBeHidden();
    // Penalty −10 on the author (rating is public).
    await expect
      .poll(async () => (await apiAs<{ rating: number }>(reporter.page, reporter.user, 'GET', `/users/${offender.user.id}`)).rating)
      .toBe(Math.max(0, ratingBefore - 10));
    const messages = await apiAs<{ items: { id: string; deletedAt: string | null }[] }>(reporter.page, reporter.user, 'GET', `/chats/${chat.id}/messages`);
    expect(messages.items.find((m) => m.id === message.id)?.deletedAt).not.toBeNull();

    // --- Block the offender while their page is open: it is logged out live.
    await offender.page.goto('/profile');
    await waitForRealtime(offender.page);
    await admin.goto(`/admin/users/${offender.user.id}`);
    await admin.getByRole('button', { name: 'Block' }).click();
    await admin.getByRole('alertdialog').getByRole('radio', { name: '24 h' }).click();
    const blockNote = `Spam in direct messages ${tag()}`;
    await confirmWithNote(admin, blockNote, 'Block');
    await expect(admin.getByTestId('admin-user-status')).toHaveText('Blocked');
    await expect(offender.page).toHaveURL(/\/login/, { timeout: 20_000 });
    const me = await offender.page.request.get(`${API_URL}/api/v1/me`, { headers: { authorization: `Bearer ${offender.user.accessToken}` } });
    expect(me.status()).toBe(401);

    // --- Verify the pending service; QR becomes available.
    await admin.goto('/admin/services');
    const svc = admin.getByTestId('admin-service').filter({ hasText: serviceName });
    await expect(svc).toBeVisible();
    await svc.getByRole('button', { name: 'Verify' }).click();
    await confirmWithNote(admin, 'Checked by phone', 'Verify');
    await expect(svc).toBeHidden();
    const listed = await apiAs<{ status: string }>(reporter.page, reporter.user, 'GET', `/services/${service.id}`);
    expect(listed.status).toBe('verified');
    await admin.goto('/admin/services?status=verified');
    await admin.getByTestId('admin-service').filter({ hasText: serviceName }).getByRole('button', { name: 'QR for printing' }).click();
    await expect(admin.getByTestId('service-qr')).toBeVisible();
    await expect(admin.getByTestId('service-qr-code')).toHaveText(/^[A-Z2-7]{8}$/);

    // --- The audit log has every action.
    await admin.keyboard.press('Escape');
    await admin.goto('/admin/audit');
    await expect(admin.getByTestId('audit-row').filter({ hasText: warning })).toBeVisible();
    await expect(admin.getByTestId('audit-row').filter({ hasText: blockNote })).toBeVisible();
  } finally {
    await adminContext.close();
    await reporter.close();
    await offender.close();
  }
});

test('a non-admin opening /admin sees a not-found page and no admin menu item', async ({ page, context }) => {
  await useEnglish(context);
  await useTestIp(page);
  await signUpViaApi(page, 'Curious Driver');
  await page.goto('/admin/users');
  await expect(page.getByTestId('not-found')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Admin sections' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.getByRole('menuitem').first()).toBeVisible();
  await expect(page.getByTestId('account-menu-admin')).toHaveCount(0);
});
