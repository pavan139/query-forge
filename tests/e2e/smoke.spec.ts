import { expect, test } from '@playwright/test';

test('onboarding, first lesson, running a query and saving progress', async ({ page }) => {
  await page.goto('/');
  await page.getByText("Let's start").click();
  await page.getByPlaceholder('Your first name').fill('Tester');
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByText('Start my first lesson').click();
  await expect(page.getByText(/Lesson 1 of/)).toBeVisible();

  // Walk forward until the first runnable example, then run it.
  for (let i = 0; i < 10; i++) {
    if (await page.getByRole('button', { name: /^Run\b(?! it)/ }).count()) break;
    await page.getByRole('button', { name: /^Continue/ }).last().click();
  }
  await page.getByRole('button', { name: /^Run\b(?! it)/ }).last().click();
  await expect(page.locator('table.grid-table').last()).toBeVisible({ timeout: 60_000 });

  // Progress is persisted.
  const saved = await page.evaluate(() => localStorage.getItem('sqlquest-v1'));
  expect(saved).toContain('Tester');
  await page.reload();
  await expect(page.getByText(/Lesson 1 of/)).toBeVisible();
});

test('every main page renders', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem('sqlquest-v1', JSON.stringify({ state: { profile: { name: 'T', onboarded: true, startedAt: '2025-01-01', dailyGoal: 50, theme: 'light', sound: false, editorFont: 14, minutesGoal: 20 } }, version: 1 })),
  );
  // The store only reads storage at start-up, so reload to pick up the seeded profile.
  await page.reload();
  for (const path of ['/', '/learn', '/review', '/tests', '/practice', '/projects', '/playground', '/reference', '/datasets', '/progress', '/achievements', '/settings']) {
    await page.goto(`/#${path}`);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('h1').first()).toBeVisible();
  }
});
