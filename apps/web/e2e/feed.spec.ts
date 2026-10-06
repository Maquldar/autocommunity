import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { horizontalOverflow, signUpViaApi, useEnglish, useTestIp, waitForRealtime, type SignedUp } from './helpers';

const PHOTO = path.join(__dirname, 'fixtures', 'avatar.png');

type Driver = { page: Page; user: SignedUp; close: () => Promise<void> };

async function newDriver(browser: Browser, name: string): Promise<Driver> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await useEnglish(context);
  const page = await context.newPage();
  await useTestIp(page);
  const user = await signUpViaApi(page, name);
  return { page, user, close: () => context.close() };
}

test('feed: photo + poll post → vote, like, comment → author notified → delete comment → report', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'two-browser journey runs once per e2e run');
  test.setTimeout(240_000);
  const author = await newDriver(browser, 'Alma Author');
  const reader = await newDriver(browser, 'Ruslan Reader');
  const text = `Weekend trip to Kolsai, details: https://example.com/kolsai ${Date.now().toString(36)}`;
  try {
    // --- The author posts a photo and a poll from /feed.
    await author.page.goto('/feed');
    const composer = author.page.getByTestId('composer');
    await composer.getByLabel('Post text').fill(text);
    await author.page.getByTestId('post-photo-input').setInputFiles(PHOTO);
    await expect(composer.getByTestId('attachment')).toHaveCount(1);
    await expect(composer.getByRole('progressbar')).toHaveCount(0, { timeout: 20_000 });
    await composer.getByRole('button', { name: 'Add a poll' }).click();
    await composer.getByLabel('Question').fill('When do we leave?');
    await composer.getByLabel('Option 1', { exact: true }).fill('Friday night');
    await composer.getByLabel('Option 2', { exact: true }).fill('Saturday morning');
    await composer.getByRole('button', { name: 'Add option' }).click();
    await composer.getByLabel('Option 3', { exact: true }).fill('Sunday');
    await composer.getByTestId('publish').click();
    await expect(composer.getByLabel('Post text')).toHaveValue('');

    const card = author.page.getByTestId('post-card').filter({ hasText: text.slice(-8) }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByRole('link', { name: 'https://example.com/kolsai' })).toHaveAttribute('href', 'https://example.com/kolsai');
    await expect(card.getByTestId('post-media').locator('img')).toHaveCount(1);
    await expect(card.getByTestId('poll')).toContainText('When do we leave?');
    const postId = await card.getAttribute('data-post-id');
    expect(postId).toBeTruthy();

    // --- The reader votes, likes and comments on the thread page.
    await reader.page.goto(`/posts/${postId}`);
    const post = reader.page.getByTestId('post-card');
    await post.getByRole('radio', { name: 'Saturday morning' }).check();
    await post.getByRole('button', { name: 'Vote' }).click();
    await expect(post.getByTestId('poll-result')).toHaveCount(3);
    await expect(post.getByTestId('poll-result').nth(1)).toContainText('100%');
    await expect(post.getByText('Votes are final')).toBeVisible();
    const like = post.getByTestId('like-button');
    await like.click();
    await expect(like).toHaveAttribute('aria-pressed', 'true');
    await expect(like).toContainText('1');
    await reader.page.getByLabel('Your comment').fill('Count me in, Saturday works!');
    await reader.page.getByRole('button', { name: 'Send' }).click();
    const comment = reader.page.getByTestId('comment').filter({ hasText: 'Count me in' });
    await expect(comment).toBeVisible();
    await expect(post.getByTestId('comment-count')).toHaveText('1 comment');

    // Lightbox opens the photo.
    await post.getByRole('button', { name: 'Open photo 1 of 1' }).click();
    await expect(reader.page.getByTestId('lightbox')).toBeVisible();
    await reader.page.keyboard.press('Escape');

    // --- The author sees the comment notification (after reload is fine) and deletes the comment.
    await author.page.goto('/notifications');
    const note = author.page.getByRole('link', { name: /Ruslan Reader commented on your post: Count me in/ });
    await expect(note).toBeVisible({ timeout: 15_000 });
    await note.click();
    await expect(author.page).toHaveURL(`/posts/${postId}`);
    await expect(author.page.getByTestId('post-card').getByTestId('poll-result')).toHaveCount(0); // the author hasn't voted
    const theirComment = author.page.getByTestId('comment').filter({ hasText: 'Count me in' });
    await theirComment.getByTestId('comment-menu').click();
    await author.page.getByRole('menuitem', { name: 'Delete comment' }).click();
    await author.page.getByRole('alertdialog').getByRole('button', { name: 'Delete comment' }).click();
    await expect(theirComment).toHaveCount(0);
    await expect(author.page.getByText('No comments yet')).toBeVisible();

    // --- The reader reports the post.
    await reader.page.reload();
    await waitForRealtime(reader.page);
    await reader.page.getByTestId('post-card').getByTestId('post-menu').click();
    await reader.page.getByRole('menuitem', { name: 'Report' }).click();
    const dialog = reader.page.getByTestId('report-dialog');
    await dialog.getByRole('button', { name: 'Send report' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Choose a reason');
    await dialog.getByLabel('Spam or advertising').check();
    await dialog.getByRole('button', { name: 'Send report' }).click();
    await expect(reader.page.getByText('Report sent. Thank you!')).toBeVisible();
    await expect(dialog).toHaveCount(0);
  } finally {
    await author.close();
    await reader.close();
  }
});

test('feed pages fit 320px', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 720 } });
  await useEnglish(context);
  const page = await context.newPage();
  await useTestIp(page);
  await signUpViaApi(page, 'Narrow Reader');
  try {
    await page.goto('/feed');
    await expect(page.getByTestId('post-card').first()).toBeVisible({ timeout: 15_000 });
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    const id = await page.getByTestId('post-card').first().getAttribute('data-post-id');
    await page.goto(`/posts/${id}`);
    await expect(page.getByTestId('comment-composer')).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  } finally {
    await context.close();
  }
});
