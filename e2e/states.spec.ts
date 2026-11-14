import { expect, test } from '@playwright/test';
import { mapReady } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
});

const card = (page: import('@playwright/test').Page) => page.getByRole('complementary', { name: 'Answer card' });

test('excluded area card', async ({ page }) => {
  await page.goto('/map?state=excluded');
  await mapReady(page);
  const c = card(page);
  await expect(c.getByText('Excluded', { exact: true })).toBeVisible();
  await expect(c.getByText('Irrigated cropland and settlement')).toBeVisible();
  await expect(c.getByText('Cropland 58%, settlement 21%, grassland 17% (ESA WorldCover 2021)')).toBeVisible();
  await expect(c.getByText('Not a pasture, so this area has no level or trend.')).toBeVisible();
  await expect(c.getByRole('heading', { name: 'Nearest pastures' })).toBeVisible();
  await expect(c.getByRole('button', { name: 'Flag mask for review' })).toBeVisible();
  await expect(c.getByText(/^Not accounted for:/)).toBeVisible();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'screenshots/phase-3-excluded.png' });
});

test('low-confidence card', async ({ page }) => {
  await page.goto('/map?state=lowConfidence');
  await mapReady(page);
  const c = card(page);
  await expect(c.getByText('Low confidence', { exact: true })).toBeVisible();
  await expect(c.getByRole('note')).toContainText('Low confidence. Only 13 of 26 seasons had clear observations');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'screenshots/phase-3-low-confidence.png' });
});

test('not enough data card', async ({ page }) => {
  await page.goto('/map?state=noData');
  await mapReady(page);
  const c = card(page);
  await expect(c.getByText('Not enough data', { exact: true })).toBeVisible();
  await expect(c.getByText('Too few clear seasons to give a level or trend.')).toBeVisible();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'screenshots/phase-3-no-data.png' });
});

test('outside the study area card', async ({ page }) => {
  await page.goto('/map?state=outside');
  await mapReady(page);
  const c = card(page);
  await expect(c.getByText('Outside the study area').first()).toBeVisible();
  await expect(c.getByText('There is no data here, so there is no answer.')).toBeVisible();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'screenshots/phase-3-outside.png' });
});

test('loading skeleton', async ({ page }) => {
  await page.goto('/map?state=loading');
  await mapReady(page);
  await expect(page.getByTestId('matrix-skeleton')).toBeVisible();
  await expect(page.getByTestId('card-skeleton')).toBeVisible();
  await expect(page.locator('path.zone').first()).toHaveAttribute('fill', '#E2E2E2');
  await page.screenshot({ path: 'screenshots/phase-3-loading.png' });
});
