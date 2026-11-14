import type { Page } from '@playwright/test';

/** Wait for zones, then give map tiles a moment to arrive. */
export async function mapReady(page: Page) {
  await page.waitForSelector('path.zone', { state: 'attached', timeout: 20_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(600);
}
