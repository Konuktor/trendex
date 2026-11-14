import { test } from '@playwright/test';
import { mapReady } from './helpers';

const PAGES = [
  ['map', '/map'],
  ['map-excluded', '/map?state=excluded'],
  ['map-low-confidence', '/map?state=lowConfidence'],
  ['map-no-data', '/map?state=noData'],
  ['map-outside', '/map?state=outside'],
  ['map-loading', '/map?state=loading'],
  ['trends', '/trends'],
  ['queue', '/queue'],
  ['methods', '/methods'],
] as const;

for (const [name, url] of PAGES) {
  test(`final ${name}`, async ({ page }, info) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto(url);
    if (url.startsWith('/map')) await mapReady(page);
    else await page.waitForTimeout(600);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `screenshots/final/${info.project.name}-${name}.png` });
  });
}
