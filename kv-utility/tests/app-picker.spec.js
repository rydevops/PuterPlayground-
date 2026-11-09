// "Data from" › Connect another app: discovering apps, connecting, and this app's own data.
const { test, expect } = require('@playwright/test');
const { openApp, mockState, DEFAULTS } = require('./helpers/puter-mock');
const { node } = require('./helpers/app');

const H = '/tester';
const OWN_ID = DEFAULTS.appID;
const CREATED = 'app-11111111-2222-3333-4444-555555555555'; // an app the user created on Puter
const WEBSITE = 'app-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'; // a website that only has an AppData folder

const ACCOUNT = {
  files: {
    [`${H}/AppData/${OWN_ID}/tropical-merge/save.json`]: '{}',
    [`${H}/AppData/${WEBSITE}/tropical-merge/save.json`]: '{"web":true}',
    [`${H}/AppData/${CREATED}/data.json`]: '{}',
  },
  // Default app restrictions: AppData and other apps' folders need a grant.
  apps: [
    { uid: CREATED, name: 'tropical', title: 'Tropical Merge', index_url: 'https://tropical.puter.site/' },
    { uid: OWN_ID, name: 'kvutil', title: 'KV Utility' },
  ],
  kv: { '': { mine: 1 }, [CREATED]: { 'created-key': 1 }, [WEBSITE]: { 'web-key': 2 } },
};

const rows = (page) => page.locator('#app-results li');

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await openApp(page, structuredClone(ACCOUNT));
  await expect(page.locator('#store-list button')).toHaveText(['mine']);
  await page.selectOption('#app-select', '__connect__');
  await expect(page.locator('#app-dialog')).toBeVisible();
});

test('lists this app first, then finds more apps after one access prompt', async ({ page }) => {
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('This app (KV Utility)');
  await expect(rows(page).first()).toContainText('contains: tropical-merge');
  await expect(page.locator('#app-allow')).toBeVisible();

  await page.click('#app-allow');
  await expect(rows(page)).toHaveCount(3);
  await expect(page.locator('#app-allow')).toBeHidden();
  await expect(rows(page).nth(0)).toContainText('KV Utility');
  await expect(rows(page).nth(1)).toContainText('Tropical Merge');
  await expect(rows(page).nth(1)).toContainText('tropical.puter.site');
  // The website app has no name, so it is labelled by its folder contents.
  await expect(rows(page).nth(2)).toContainText('App with tropical-merge');
  expect((await mockState(page)).reqs[0]).toEqual(['apps', { access: 'read' }]);
});

test('the filter matches names, sites, IDs and folder contents', async ({ page }) => {
  await page.click('#app-allow');
  await page.fill('#app-search', 'puter.site');
  await expect(rows(page)).toHaveText([/Tropical Merge/]);
  await page.fill('#app-search', 'aaaaaaaa');
  await expect(rows(page)).toHaveText([/App with tropical-merge/]);
  await page.fill('#app-search', 'nothing-here');
  await expect(rows(page)).toHaveText(['No apps match the filter.']);
});

test("connecting an app switches the stores to that app's KV data", async ({ page }) => {
  await page.click('#app-allow');
  await rows(page).nth(1).locator('button').click();
  await expect(page.locator('#app-dialog')).toBeHidden();
  await expect(page.locator('#app-select option:checked')).toHaveText('Tropical Merge');
  await expect(page.locator('#store-list button')).toHaveText(['created-key']);
  const { reqs } = await mockState(page);
  expect(reqs.at(-1)).toEqual(['appData', { app: CREATED, scopes: { kv: ['read', 'write', 'delete'], fs: ['read'] } }]);

  // Back to this app's own data.
  await page.selectOption('#app-select', '');
  await expect(page.locator('#store-list button')).toHaveText(['mine']);
});

test("picking this app opens its own folder in the file tree", async ({ page }) => {
  await rows(page).first().locator('button').click();
  await expect(page.locator('#app-dialog')).toBeHidden();
  await expect(page.locator('#pane-files')).toBeVisible();
  await expect(node(page, `${H}/AppData/${OWN_ID}/tropical-merge`)).toBeVisible();
});

test('an app ID can still be entered by hand', async ({ page }) => {
  await page.click('#app-dialog summary');
  await page.fill('#app-manual', WEBSITE);
  await page.click('#app-manual-go');
  await expect(page.locator('#app-dialog')).toBeHidden();
  await expect(page.locator('#store-list button')).toHaveText(['web-key']);
});

test('unknown app names are reported', async ({ page }) => {
  await page.click('#app-dialog summary');
  await page.fill('#app-manual', 'no-such-app');
  await page.click('#app-manual-go');
  await expect(page.locator('#toast')).toContainText(`Couldn't find an app called "no-such-app"`);
  await expect(page.locator('#app-dialog')).toBeVisible();
});
