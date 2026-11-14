import { expect, test } from '@playwright/test';
import { mapReady } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
});

test('map screen: default demo selection', async ({ page }) => {
  await page.goto('/map');
  await mapReady(page);
  const card = page.getByRole('complementary', { name: 'Answer card' });
  await expect(card.getByRole('heading', { name: 'Around Suusamyr' })).toBeVisible();
  await expect(card.getByText('High confidence')).toBeVisible();
  await expect(card.getByText('Relative to other pastures in Naryn oblast', { exact: true })).toBeVisible();
  await expect(card.getByText('Not accounted for: livestock load, land rights, water, roads, forage quality')).toBeVisible();
  await expect(card.getByRole('img', { name: /trend −\d\.\d percent per year; 2025 value/ })).toBeVisible();
  // never squares: zones are smoothed paths with many vertices
  const d = await page.locator('path.zone').first().getAttribute('d');
  expect((d ?? '').split('L').length).toBeGreaterThan(20);
  await expect(page.locator('path.zone-selected')).toHaveCount(1);
  await page.screenshot({ path: 'screenshots/phase-2-map.png' });
});

test('matrix filter and layer switch rebuild zones', async ({ page }) => {
  await page.goto('/map');
  await mapReady(page);
  await page.getByRole('button', { name: /^Moderate level, reliable decline/ }).click();
  await expect(page.getByRole('button', { name: /^Moderate level, reliable decline/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('path.zone-dim')).toHaveCount(1);
  await expect(page.getByText('Moderate level × reliable decline')).toBeVisible();
  await page.screenshot({ path: 'screenshots/phase-2-map-filter.png' });
  await page.getByRole('button', { name: 'Clear level × trend filter' }).click();
  await expect(page.locator('path.zone-dim')).toHaveCount(0);

  await page.getByRole('button', { name: 'Level', exact: true }).click();
  await expect(page.locator('path.zone-Lgood')).toHaveCount(1);
  await expect(page.locator('path.zone-decS')).toHaveCount(0);
  await page.getByRole('button', { name: /^Kochkor/ }).click();
  await expect(page.getByText('Kochkor', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: 'screenshots/phase-2-map-level-district.png' });
});

test('search selects a place and better nearby flies', async ({ page }) => {
  await page.goto('/map');
  await mapReady(page);
  const input = page.getByLabel('Search a place or coordinates');
  await input.fill('Кочкор');
  await expect(page.getByRole('button', { name: 'Kochkor Кочкор' })).toBeVisible();
  await page.screenshot({ path: 'screenshots/phase-2-search.png' });
  await input.press('Enter');
  const card = page.getByRole('complementary', { name: 'Answer card' });
  await expect(card.getByText('Excluded', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: /Flag mask for review/ })).toBeVisible();
});

test('draw an area', async ({ page }) => {
  await page.goto('/map');
  await mapReady(page);
  await page.getByRole('button', { name: 'Draw an area' }).click();
  const map = page.locator('.leaflet-container');
  const box = (await map.boundingBox())!;
  const pts: [number, number][] = [
    [0.3, 0.35],
    [0.45, 0.32],
    [0.47, 0.5],
    [0.32, 0.52],
  ];
  for (const [x, y] of pts) await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  await expect(page.getByText('· 4', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'screenshots/phase-2-drawing.png' });
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('· 3', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show answer' }).click();
  const card = page.getByRole('complementary', { name: 'Answer card' });
  await expect(card.getByRole('heading', { name: /^Drawn area near/ })).toBeVisible();
  await expect(page.locator('path.drawn-outline')).toHaveCount(1);
  await card.getByRole('button', { name: /Add to queue/ }).click();
  const undo = card.getByRole('button', { name: 'In queue · undo' });
  await expect(undo).toBeVisible();
  await expect(undo).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.screenshot({ path: 'screenshots/phase-2-drawn.png' });
});
