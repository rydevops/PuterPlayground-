// Phone layout: one section at a time with a bottom tab bar, touch-friendly sizes, no overflow.
const { test, expect, devices } = require('@playwright/test');
const { openApp, DEFAULTS } = require('./helpers/puter-mock');
const { node } = require('./helpers/app');

const OWN = `/tester/AppData/${DEFAULTS.appID}`;
const ACCOUNT = {
  kv: { '': { 'game-state': { lvl: 3 } } },
  files: { [`${OWN}/tropical-merge/save.json`]: '{"score":1}' },
  unlistable: ['/', '/tester/AppData'],
};
// iPhone 13 viewport, touch and user agent, but in Chromium like the rest of the suite.
const { defaultBrowserType, ...IPHONE } = devices['iPhone 13'];
const expectView = (page, v) => expect(page.locator('#layout')).toHaveAttribute('data-view', v);

test.describe('iPhone', () => {
  test.use(IPHONE);

  test.beforeEach(async ({ page }) => {
    await openApp(page, structuredClone(ACCOUNT));
  });

  test('shows one section at a time and opens the editor for a store', async ({ page }) => {
    await expect(page.locator('#mobile-nav')).toBeVisible();
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.editor-panel')).toBeHidden();

    await page.tap('#store-list button:text("game-state")');
    await expect(page.locator('.editor-panel')).toBeVisible();
    await expect(page.locator('.sidebar')).toBeHidden();
    await expectView(page, 'editor');

    // Editing shows the unsaved-changes dot on the Editor tab.
    await page.tap('#editor');
    await page.keyboard.type(' ');
    await expect(page.locator('#mobile-nav [data-view=editor] .dot')).toBeVisible();
  });

  test('tapping a file in the tree opens it in the editor', async ({ page }) => {
    await page.tap('#mobile-nav [data-view=files]');
    await page.locator('#fs-filter').fill('save');
    await node(page, `${OWN}/tropical-merge/save.json`).tap();
    await expectView(page, 'editor');
    await expect(page.locator('#doc-title')).toHaveText('save.json');
    await expect(page.locator('.doc-actions')).toBeVisible();
  });

  test('remembers the section after a reload', async ({ page }) => {
    await page.tap('#mobile-nav [data-view=files]');
    await page.reload();
    await expect(page.locator('#pane-files')).toBeVisible();
    await expect(page.locator('#mobile-nav [data-view=files]')).toHaveAttribute('aria-current', 'page');
  });

  test('form fields use 16px text so iOS does not zoom in', async ({ page }) => {
    const sizes = await page.evaluate(() => ['#store-name', '#editor', '#filter', '#fs-filter', '#save-mode', '#app-select']
      .map((s) => getComputedStyle(document.querySelector(s)).fontSize));
    expect(sizes.every((s) => parseFloat(s) >= 16)).toBe(true);
  });
});

for (const width of [320, 360]) {
  test.describe(`${width}px wide`, () => {
    test.use({ viewport: { width, height: 640 }, isMobile: true, hasTouch: true });

    test('nothing spills past the screen edge', async ({ page }) => {
      await openApp(page, structuredClone(ACCOUNT));
      for (const section of ['stores', 'editor', 'files']) {
        await page.tap(`#mobile-nav [data-view=${section}]`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${section} section`).toBeLessThanOrEqual(0);
      }
    });
  });
}

test('desktop keeps the side-by-side layout', async ({ page }) => {
  await openApp(page, structuredClone(ACCOUNT));
  await expect(page.locator('#mobile-nav')).toBeHidden();
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.editor-panel')).toBeVisible();
});
