import { expect, test } from '@playwright/test';
import { mapReady } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
});

async function noHorizontalScroll(page: import('@playwright/test').Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over).toBeLessThanOrEqual(0);
}

test('mobile map: collapsed and expanded answer sheet', async ({ page }) => {
  await page.goto('/map');
  await mapReady(page);
  await noHorizontalScroll(page);
  const sheet = page.getByRole('region', { name: 'Answer card' });
  await expect(sheet.getByRole('heading', { name: 'Around Suusamyr' })).toBeVisible();
  await expect(sheet.getByText('Relative to other pastures in Naryn oblast', { exact: true })).toBeVisible();
  await expect(sheet.getByText(/^Not accounted for:/)).toBeVisible();
  await expect(sheet.getByRole('img')).toHaveCount(0);
  // touch targets
  for (const name of ['Expand answer card', 'Layers', 'Draw an area', 'Close answer card']) {
    const b = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(b!.height).toBeGreaterThanOrEqual(44);
  }
  const search = await page.getByLabel('Search a place or coordinates').boundingBox();
  expect(search!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: 'screenshots/phase-7-mobile-map.png' });

  await page.getByRole('button', { name: 'Expand answer card' }).click();
  await expect(sheet.getByRole('img', { name: /trend −1\.1 percent per year/ })).toBeVisible();
  await page.screenshot({ path: 'screenshots/phase-7-mobile-card-expanded.png' });
});

test('mobile layers sheet', async ({ page }) => {
  await page.goto('/map');
  await mapReady(page);
  await page.getByRole('button', { name: 'Layers' }).click();
  const sheet = page.getByRole('region', { name: 'Layers and filters' });
  await expect(sheet.getByRole('button', { name: 'Level', exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: /^Moderate level, reliable decline/ })).toBeVisible();
  const cell = await sheet.getByRole('button', { name: /^Moderate level, reliable decline/ }).boundingBox();
  expect(cell!.height).toBeGreaterThanOrEqual(40);
  await page.screenshot({ path: 'screenshots/phase-7-mobile-layers.png' });
  await sheet.getByRole('button', { name: /^Moderate level, reliable decline/ }).click();
  await sheet.getByRole('button', { name: 'Close layers' }).click();
  await expect(page.locator('path.zone-dim')).toHaveCount(1);
});

for (const r of ['/trends', '/queue', '/methods']) {
  test(`mobile ${r}`, async ({ page }) => {
    await page.goto(r);
    await page.waitForTimeout(500);
    await noHorizontalScroll(page);
    await page.screenshot({ path: `screenshots/phase-7-mobile${r.replace('/', '-')}.png` });
  });
}
