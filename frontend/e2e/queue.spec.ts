import { expect, test } from '@playwright/test';
import { mapReady } from './helpers';

test('queue: banner, ranking, filters, empty states', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('init')) {
      localStorage.clear();
      sessionStorage.setItem('init', '1');
    }
  });
  await page.goto('/queue');
  await expect(page.getByText('A prioritisation for field checks, not an instruction.')).toBeVisible();
  await expect(page.getByText(/^Score = steepness of decline/)).toBeVisible();
  const rows = page.locator('tbody tr');
  expect(await rows.count()).toBeGreaterThan(5);
  await page.screenshot({ path: 'screenshots/phase-5-queue.png' });

  await page.getByRole('button', { name: /Added from map/ }).click();
  await expect(page.getByText('Nothing in the queue yet')).toBeVisible();
  await page.screenshot({ path: 'screenshots/phase-5-queue-empty.png' });

  await page.getByRole('button', { name: 'All candidates' }).click();
  await page.getByLabel('District').selectOption('SU');
  await page.getByRole('button', { name: 'Good', exact: true }).click();
  await page.getByRole('button', { name: 'High only' }).click();
  await expect(page.getByText('No areas match these filters')).toBeVisible();
  await page.screenshot({ path: 'screenshots/phase-5-queue-nomatch.png' });
  await page.getByRole('button', { name: 'Clear filters' }).click();
  expect(await rows.count()).toBeGreaterThan(5);

  // add from the map, then see it marked here (persisted in localStorage)
  await page.goto('/map');
  await mapReady(page);
  await page.getByRole('complementary', { name: 'Answer card' }).getByRole('button', { name: /Add to queue/ }).click();
  await page.getByRole('link', { name: 'Inspection queue' }).click();
  await expect(page.getByText('added from map', { exact: true })).toHaveCount(1);
  await page.reload();
  await expect(page.getByText('added from map', { exact: true })).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toBe('trendex-inspection-queue.csv');

  await page.getByRole('link', { name: 'Open on map' }).first().click();
  await expect(page).toHaveURL(/\/map\?area=/);
  await expect(page.getByRole('complementary', { name: 'Answer card' })).toBeVisible();
});
