import { expect, test } from '@playwright/test';
import { mapReady } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
});

/** Press Tab until the focused element matches, up to a limit. */
async function tabTo(page: import('@playwright/test').Page, match: (el: { tag: string; name: string }) => boolean, max = 80) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const el = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      return { tag: a?.tagName ?? '', name: (a?.getAttribute('aria-label') || a?.textContent || '').trim() };
    });
    if (match(el)) return el;
  }
  throw new Error('focus target not reached');
}

test('keyboard: search, matrix, card actions, tabs', async ({ page }) => {
  await page.goto('/map');
  await mapReady(page);
  // Search by keyboard and pick with Arrow + Enter
  await tabTo(page, (e) => e.tag === 'INPUT');
  await page.keyboard.type('Ак-Сай');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const card = page.getByRole('complementary', { name: 'Answer card' });
  await expect(card.getByRole('heading', { name: 'Around Ak-Sai' })).toBeVisible();
  await expect(card.getByRole('note')).toContainText('Low confidence.');

  // Matrix toggle with Space
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await tabTo(page, (e) => e.name.startsWith('Moderate level, reliable decline'));
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
  expect(outline).toBe('solid');
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: /^Moderate level, reliable decline/ })).toHaveAttribute('aria-pressed', 'true');

  // District row toggle with Enter
  await tabTo(page, (e) => e.name.startsWith('Kochkor'));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /^Kochkor/ })).toHaveAttribute('aria-pressed', 'true');

  // Card: queue toggle reachable
  await tabTo(page, (e) => e.name.includes('Add to queue'), 120);
  await page.keyboard.press('Enter');
  await expect(card.getByRole('button', { name: 'In queue · undo' })).toBeVisible();
});

test('keyboard: every route is reachable from the tabs', async ({ page }) => {
  await page.goto('/map');
  for (const [name, path] of [['Trends', '/trends'], ['Inspection queue', '/queue'], ['Methods & limits', '/methods'], ['Map', '/map']]) {
    await page.getByRole('link', { name, exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  }
});

test('contrast: body text never uses the axis grey', async ({ page }) => {
  for (const r of ['/map', '/trends', '/queue', '/methods']) {
    await page.goto(r);
    await page.waitForTimeout(800);
    const bad = await page.evaluate(() => {
      const out: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const t = walker.currentNode.textContent?.trim();
        const el = walker.currentNode.parentElement;
        if (!t || !el) continue;
        if (el.closest('[aria-hidden="true"], .leaflet-container, svg')) continue;
        if (getComputedStyle(el).color === 'rgb(138, 138, 138)') out.push(t);
      }
      return out;
    });
    expect(bad, `${r}: ${bad.join(' | ')}`).toEqual([]);
  }
});
