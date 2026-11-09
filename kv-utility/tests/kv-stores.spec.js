// Stores: listing, filtering, get, save, delete and the JSON-text save mode.
const { test, expect } = require('@playwright/test');
const { openApp, mockState } = require('./helpers/puter-mock');

const KV = {
  '': {
    'config:main': { a: 1 },
    'config:beta': { b: 2 },
    'game-state': { lvl: 3, board: [[2, 4]] },
    'raw-json': '{"x":1}',
  },
};

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await openApp(page, { kv: structuredClone(KV) });
});

test('lists stores on sign-in, sorted', async ({ page }) => {
  await expect(page.locator('#store-list button')).toHaveText(['config:beta', 'config:main', 'game-state', 'raw-json']);
  await expect(page.locator('#store-count')).toHaveText('4 of 4 stores');
});

test('filters stores by text or glob', async ({ page }) => {
  await page.fill('#filter', 'config:*');
  await expect(page.locator('#store-list button')).toHaveText(['config:beta', 'config:main']);
  await page.fill('#filter', 'GAME');
  await expect(page.locator('#store-list button')).toHaveText(['game-state']);
  await page.fill('#filter', 'nope');
  await expect(page.locator('#store-list')).toContainText('No stores match');
});

test('get loads a store as formatted JSON and shows it in the header', async ({ page }) => {
  await page.click('#store-list button:text("game-state")');
  await expect(page.locator('#editor')).toHaveValue(JSON.stringify({ lvl: 3, board: [[2, 4]] }, null, 2));
  await expect(page.locator('#doc-kind')).toHaveText('KV store');
  await expect(page.locator('#doc-title')).toHaveText('game-state');
  await expect(page.locator('#save-mode')).toHaveValue('value');
});

test('a store saved as JSON text is detected and saved back as text', async ({ page }) => {
  await page.click('#store-list button:text("raw-json")');
  await expect(page.locator('#save-mode')).toHaveValue('string');
  await expect(page.locator('#editor')).toHaveValue('{\n  "x": 1\n}');
  await page.fill('#editor', '{"x":2}');
  await page.click('#save-btn');
  await expect.poll(async () => (await mockState(page)).kv['']['raw-json']).toBe('{"x":2}');
});

test('saves a new store and deletes it', async ({ page }) => {
  await page.fill('#store-name', 'new-store');
  await page.fill('#editor', '{"n":1}');
  await page.click('#save-btn');
  await expect.poll(async () => (await mockState(page)).kv['']['new-store']).toEqual({ n: 1 });
  await expect(page.locator('#store-list button:text("new-store")')).toBeVisible();
  await expect(page.locator('#doc-sub')).toHaveText('Saved');

  await page.click('#delete-btn');
  await expect.poll(async () => 'new-store' in (await mockState(page)).kv['']).toBe(false);
  await expect(page.locator('#store-list button:text("new-store")')).toHaveCount(0);
});

test('refuses to save invalid JSON', async ({ page }) => {
  await page.fill('#store-name', 'broken');
  await page.fill('#editor', '{bad');
  await page.click('#save-btn');
  await expect(page.locator('#toast')).toContainText('invalid JSON');
  expect((await mockState(page)).kv['']).not.toHaveProperty('broken');
});
