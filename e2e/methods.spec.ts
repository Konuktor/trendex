import { expect, test } from '@playwright/test';

test('methods page', async ({ page }) => {
  await page.goto('/methods');
  await expect(page.getByRole('heading', { name: 'Methods & limits', level: 1 })).toBeVisible();
  for (const t of ['1. What we measure', '2. How the answer is built', '3. The formula', '4. Checks', '5. Data sources and versions', '6. What this does not know', '7. AI use disclosure']) {
    await expect(page.getByRole('heading', { name: t, level: 2 })).toBeVisible();
  }
  await expect(page.getByText('Mismatch', { exact: true })).toHaveCount(1);
  const col = await page.locator('article').evaluate((e) => e.getBoundingClientRect().width);
  expect(col).toBeLessThanOrEqual(720);
  await page.screenshot({ path: 'screenshots/phase-6-methods.png' });
  await page.getByRole('link', { name: '4. Checks' }).click();
  await page.waitForTimeout(1200);
  await expect(page.getByRole('banner')).toBeInViewport();
  await expect(page.getByRole('heading', { name: '4. Checks' })).toBeInViewport();
  await page.screenshot({ path: 'screenshots/phase-6-methods-checks.png' });
});
