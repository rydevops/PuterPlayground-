// What a user sees with Puter's real app restrictions.
//
// Puter only lets an app read its own ~/AppData/<app id> folder, the user's Public folder and
// granted folders, and refuses everything else with 404 "Subject does not exist" (not
// "forbidden"). The tree shows only what Puter returns: nothing is added by the app, and a
// folder that can't be listed offers Request access instead.
const { test, expect } = require('@playwright/test');
const { openApp, mockState, DEFAULTS } = require('./helpers/puter-mock');
const { treeRows, node, matchPaths, openFilesTab } = require('./helpers/app');

const U = 'gentle_bicycle_46621';
const H = `/${U}`;
const OWN = `${H}/AppData/${DEFAULTS.appID}`;
const ACCOUNT = {
  username: U,
  files: {
    [`${OWN}/tropical-merge/save.json`]: '{"score":1234}',
    [`${H}/Desktop/tropical merge/recipe.json`]: '{}',
    [`${H}/Documents/notes.txt`]: 'notes',
    [`${H}/.config/settings.json`]: '{}',
  },
  // Desktop needs its own grant even after the home folder is allowed.
  locked: [`${H}/Desktop`],
  // No `granted`: exactly what a new user of the app has.
};

const requestHome = (page) => page.locator('#file-list .tree-status-row.error button:text("Request access")');

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await openApp(page, structuredClone(ACCOUNT));
  await openFilesTab(page);
});

test('with no access, the home folder offers Request access and shows no made-up folders', async ({ page }) => {
  const rows = await treeRows(page);
  expect(rows.map((r) => r.path)).toEqual(['/', H]); // only what listing "/" returned
  expect(rows[1]).toMatchObject({ open: true, tag: 'home' });
  await expect(page.locator('#file-list .tree-status-row.error')).toContainText('No access yet.');
  await expect(requestHome(page)).toBeVisible();
  await expect(page.locator('#file-list')).not.toContainText('does not exist');
});

test('granting the home folder discovers exactly what is in it, hidden folders included', async ({ page }) => {
  await requestHome(page).click();
  expect((await mockState(page)).reqs).toEqual([['fs', { path: H, access: 'read', create: false }]]);
  await expect(node(page, `${H}/.config`)).toBeVisible();
  const names = (await treeRows(page)).filter((r) => r.depth === 2).map((r) => r.name);
  // No Pictures or Videos: this account doesn't have them, so they must not appear.
  expect(names).toEqual(['.config', 'AppData', 'Desktop', 'Documents']);
});

test("this app's files are found once the home folder can be read", async ({ page }) => {
  await requestHome(page).click();
  await page.fill('#fs-filter', 'save.json');
  await expect.poll(() => matchPaths(page)).toEqual([`${OWN}/tropical-merge/save.json`]);
  await node(page, `${OWN}/tropical-merge/save.json`).click();
  await expect(page.locator('#doc-title')).toHaveText('save.json');
});

test('opening a special folder asks for access even though Puter answered "not found"', async ({ page }) => {
  await requestHome(page).click();
  await node(page, `${H}/Desktop`).click();
  await expect(node(page, `${H}/Desktop/tropical merge`)).toBeVisible();
  expect((await mockState(page)).reqs.at(-1)).toEqual(['folder', { name: 'Desktop', access: 'read' }]);
});

test('a declined request keeps offering Request access', async ({ page }) => {
  await openApp(page, { ...structuredClone(ACCOUNT), denyRequests: true });
  await openFilesTab(page);
  await requestHome(page).click();
  await expect(page.locator('#toast')).toContainText('Access was not granted');
  await expect(requestHome(page)).toBeVisible();
});

test('folders that could not be read are listed with Grant access', async ({ page }) => {
  await expect(page.locator('#fs-hint')).toContainText('Not readable yet (not searched): ~.');
  await page.click('#fs-hint button:text("Grant access")');
  await page.fill('#fs-filter', 'notes');
  await expect.poll(() => matchPaths(page)).toEqual([`${H}/Documents/notes.txt`]);
});

test('the app picker offers to find more apps when AppData is refused', async ({ page }) => {
  await page.selectOption('#app-select', '__connect__');
  await expect(page.locator('#app-allow')).toBeVisible();
  // This app's own folder is always readable, so its contents can still be shown.
  await expect(page.locator('#app-results li').first()).toContainText('contains: tropical-merge');
});
