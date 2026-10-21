import fs from 'node:fs';
import { expect, test } from '@playwright/test';

// Opens every lesson with all of its steps revealed and fails on any render error,
// so a broken viz config or step type can never reach the learner.
const index = JSON.parse(fs.readFileSync('src/generated/index.json', 'utf8')) as {
  modules: { id: string; lessons: { id: string }[] }[];
};

for (const mod of index.modules) {
  test(`every lesson in ${mod.id} renders`, async ({ page }) => {
    test.setTimeout(30_000 + mod.lessons.length * 20_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto('/');
    await page.evaluate((ids) => {
      const at = '2025-01-01T00:00:00.000Z';
      const lessons = Object.fromEntries(ids.map((id) => [id, { started: at, completed: at, step: 0, maxStep: 999 }]));
      const profile = { name: 'T', onboarded: true, startedAt: '2025-01-01', dailyGoal: 50, theme: 'light', sound: false, editorFont: 14, minutesGoal: 20 };
      localStorage.setItem('sqlquest-v1', JSON.stringify({ state: { profile, lessons }, version: 1 }));
    }, mod.lessons.map((l) => l.id));
    await page.reload();
    for (const lesson of mod.lessons) {
      await page.goto(`/#/lesson/${lesson.id}`);
      await expect(page.getByText('Lesson complete')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('alert').filter({ hasText: "couldn't be shown" })).toHaveCount(0);
    }
    expect(errors.filter((e) => !/favicon|service worker/i.test(e))).toEqual([]);
  });
}
