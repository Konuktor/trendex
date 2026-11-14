import { expect, test } from '@playwright/test';
import { mapReady } from './helpers';

test('demo tour', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/trends');
  await page.getByRole('button', { name: 'Demo tour' }).click();
  await expect(page).toHaveURL(/\/map$/);
  await mapReady(page);
  const tour = page.getByRole('dialog', { name: 'Read the map' });
  await expect(tour).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Answer card' })).toHaveCount(0);
  const w = await tour.evaluate((e) => e.getBoundingClientRect().width);
  expect(w).toBe(296);
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'screenshots/phase-8-tour-1.png' });

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('dialog', { name: 'Pick an area' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Answer card' }).getByRole('heading', { name: 'Around Suusamyr' })).toBeVisible();
  await page.waitForTimeout(1100);
  await page.screenshot({ path: 'screenshots/phase-8-tour-2.png' });

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('dialog', { name: 'Filter with the matrix' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Moderate level, reliable decline/ })).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(1100);
  await page.screenshot({ path: 'screenshots/phase-8-tour-3.png' });

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('button', { name: /^Moderate level, reliable decline/ })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('dialog', { name: 'How it is built' })).toBeVisible();
  await page.screenshot({ path: 'screenshots/phase-8-tour-4.png' });
  await page.getByRole('button', { name: 'Open Methods' }).click();
  await expect(page).toHaveURL(/\/methods$/);
  await expect(page.getByTestId('tour')).toHaveCount(0);
});
