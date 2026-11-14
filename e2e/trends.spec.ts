import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('trends page', async ({ page }) => {
  await page.goto('/trends');
  await expect(page.getByRole('heading', { name: 'Trends', level: 1 })).toBeVisible();
  await expect(page.getByText('No reliable trend is also a result.')).toBeVisible();
  await expect(page.getByRole('img', { name: /Average peak-season greenness, Naryn oblast,.*percent per year; 2025 value/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Districts, sorted by slope' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set as scope' })).toHaveCount(6);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'screenshots/phase-4-trends.png' });
  await page.getByRole('heading', { name: 'Districts, sorted by slope' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'screenshots/phase-4-trends-districts.png' });
  await page.locator('main').evaluate((m) => m.scrollTo(0, 0));

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('trendex-naryn-cells.csv');
  const text = readFileSync((await file.path())!, 'utf8');
  expect(text.split('\n')[1]).toMatch(/^id,district,lon,lat,kind/);

  await page.getByLabel('Scope').selectOption('KO');
  await expect(page).toHaveURL(/scope=KO/);
  await expect(page.getByText(/for pastures in Kochkor/)).toBeVisible();
});
