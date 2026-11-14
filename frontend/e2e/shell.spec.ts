import { expect, test } from '@playwright/test';

const ROUTES = ['/map', '/trends', '/queue', '/methods'];

test('root redirects to /map', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/map$/);
});

for (const r of ROUTES) {
  test(`top bar on ${r}`, async ({ page }) => {
    await page.goto(r);
    const bar = page.getByRole('banner');
    await expect(bar).toHaveCSS('height', '48px');
    await expect(bar.getByText('TrendeX')).toBeVisible();
    await expect(bar.getByText('Sample data')).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Demo tour' })).toBeVisible();
    for (const t of ['Map', 'Trends', 'Inspection queue', 'Methods & limits']) {
      await expect(bar.getByRole('link', { name: t, exact: true })).toBeVisible();
    }
    await page.screenshot({ path: `screenshots/phase-0${r.replace('/', '-')}.png` });
  });
}
