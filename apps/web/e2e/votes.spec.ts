import { expect, test, type Browser } from '@playwright/test';
import { SEEDED_VOTER_PHONE, horizontalOverflow, signInViaApi, signUpViaApi, useEnglish, useTestIp } from './helpers';

async function newContext(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await useEnglish(context);
  const page = await context.newPage();
  await useTestIp(page);
  return { context, page };
}

test('votes: a trusted driver gives a thumbs up with a reason; a new account sees why it cannot vote', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'uses a shared seeded account; runs once per e2e run');
  test.setTimeout(180_000);
  const voter = await newContext(browser);
  const target = await newContext(browser);
  try {
    // A seeded driver (months old, rating ≥ 40) may vote; a fresh account may not.
    const voterUser = await signInViaApi(voter.page, SEEDED_VOTER_PHONE);
    const tim = await signUpViaApi(target.page, 'Tim Target');

    await voter.page.goto(`/u/${tim.id}`);
    const panel = voter.page.getByTestId('vote-panel');
    await expect(panel.getByTestId('votes-up')).toHaveAttribute('data-count', '0');
    await panel.getByTestId('vote-up').click();
    const dialog = voter.page.getByTestId('vote-dialog');
    // Only positive reasons (and Other) for a thumbs up.
    await expect(dialog.getByRole('radio', { name: 'Rude' })).toHaveCount(0);
    await dialog.getByRole('radio', { name: 'Helped on the road' }).click();
    await dialog.getByLabel('Comment (optional)').fill('Pulled me out of the snow');
    await dialog.getByRole('button', { name: 'Vote' }).click();
    await expect(dialog).toBeHidden();
    await expect(panel.getByTestId('votes-up')).toHaveAttribute('data-count', '1');
    await expect(panel.getByTestId('my-vote')).toContainText('You voted thumbs up: Helped on the road');
    await expect(panel.getByTestId('vote-again')).toHaveText(/You can vote again in (29|30) days/);
    await expect(panel.getByTestId('vote-up')).toHaveCount(0);
    expect(await horizontalOverflow(voter.page)).toBeLessThanOrEqual(0);

    // The rating breakdown has the votes component and the tier legend.
    await voter.page.getByTestId('rating-summary').click();
    await expect(voter.page.getByTestId('rating-row-votes')).toBeVisible();
    await expect(voter.page.getByTestId('tier-legend')).toContainText('Platinum');
    await voter.page.keyboard.press('Escape');

    // The target sees the summary on their own profile (?tab=votes), without the voter.
    await target.page.goto('/profile?tab=votes');
    const received = target.page.getByTestId('received-votes');
    await expect(received.getByTestId('votes-up')).toHaveAttribute('data-count', '1');
    await expect(received).toContainText('Helped on the road');
    await expect(received).not.toContainText(voterUser.nickname);

    // A 0-day-old account can't vote: the reason replaces the buttons.
    await target.page.goto(`/u/${voterUser.id}`);
    await expect(target.page.getByTestId('vote-eligibility')).toHaveAttribute('data-eligibility', 'account_too_new');
    await expect(target.page.getByTestId('vote-eligibility')).toContainText('7 days old');
  } finally {
    await voter.context.close();
    await target.context.close();
  }
});
