// Update checks: a new sw.js VERSION shows the "Update now" banner, and updating keeps the draft.
// The test server can serve sw.js with a different VERSION (see tests/server.js) to simulate a release.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { openApp } = require('./helpers/puter-mock');

const CURRENT = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8').match(/const VERSION = '([^']+)'/)[1];
const NEXT = `${CURRENT}-next`;

test.use({ serviceWorkers: 'allow' });
test.describe.configure({ mode: 'serial' });

test.afterEach(async ({ request }) => {
  await request.get('/__test/sw-version');
});

test('a new version shows the update banner and updating keeps the draft', async ({ page, request }) => {
  await request.get('/__test/sw-version');
  await openApp(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await expect(page.locator('#app-version')).toHaveText(`v${CURRENT}`);

  await page.fill('#store-name', 'draft');
  await page.fill('#editor', '{"keep":true}');

  // "Release" a new version and check for updates.
  await request.get(`/__test/sw-version?v=${encodeURIComponent(NEXT)}`);
  await page.click('#check-update');
  await expect(page.locator('#update-banner')).toBeVisible();

  await Promise.all([page.waitForEvent('load'), page.click('#update-reload')]);
  await expect(page.locator('#app-version')).toHaveText(`v${NEXT}`);
  await expect(page.locator('#editor')).toHaveValue('{"keep":true}');
  await expect(page.locator('#store-name')).toHaveValue('draft');
});

test('says so when already up to date', async ({ page, request }) => {
  await request.get('/__test/sw-version');
  await openApp(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await page.click('#check-update');
  await expect(page.locator('#toast')).toHaveText('You are running the latest version');
  await expect(page.locator('#update-banner')).toBeHidden();
});
