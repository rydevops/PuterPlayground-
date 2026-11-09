// What a freshly signed-in user sees with Puter's real app restrictions and no grants yet.
//
// Puter only lets an app read its own ~/AppData/<app id> folder, the user's Public folder and
// granted folders, and it refuses everything else with 404 "Subject does not exist" (not
// "forbidden"). Regression test for the home folder showing "Subject does not exist" and no
// folders at all.
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
    [`${H}/Public/shared.txt`]: 'public',
    [`${H}/.config/settings.json`]: '{}',
  },
  // No `granted`: exactly what a new user of the app has.
};

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await openApp(page, structuredClone(ACCOUNT));
  await openFilesTab(page);
});

test('the home folder shows its standard folders instead of "Subject does not exist"', async ({ page }) => {
  const rows = await treeRows(page);
  expect(rows.find((r) => r.path === H)).toMatchObject({ open: true, tag: 'home' });
  expect(rows.filter((r) => r.depth === 2).map((r) => r.name))
    .toEqual(['AppData', 'Desktop', 'Documents', 'Pictures', 'Public', 'Videos']);
  await expect(page.locator('#file-list')).not.toContainText('does not exist');
  const note = page.locator('#file-list .tree-status-row.note').first();
  await expect(note).toContainText("Puter doesn't let apps list your home folder");
  await expect(note.locator('button')).toHaveText('Request access');
});

test("this app's own files are reachable and searchable without any prompt", async ({ page }) => {
  await node(page, `${H}/AppData`).click();
  await expect(node(page, OWN)).toContainText('this app');
  await page.fill('#fs-filter', 'save.json');
  await expect.poll(() => matchPaths(page)).toEqual([`${OWN}/tropical-merge/save.json`]);
  await node(page, `${OWN}/tropical-merge/save.json`).click();
  await expect(page.locator('#doc-title')).toHaveText('save.json');
  expect((await mockState(page)).reqs).toEqual([]);
});

test('Public is readable without a grant', async ({ page }) => {
  await node(page, `${H}/Public`).click();
  await expect(node(page, `${H}/Public/shared.txt`)).toBeVisible();
});

test('opening a special folder asks for access even though Puter answered "not found"', async ({ page }) => {
  await node(page, `${H}/Desktop`).click();
  await expect(node(page, `${H}/Desktop/tropical merge`)).toBeVisible();
  expect((await mockState(page)).reqs).toEqual([['folder', { name: 'Desktop', access: 'read' }]]);
});

test('other folders that fail offer Request access', async ({ page }) => {
  await openApp(page, { ...structuredClone(ACCOUNT), denyRequests: true });
  await openFilesTab(page);
  await node(page, `${H}/Documents`).click();
  const row = page.locator('#file-list .tree-status-row.error');
  await expect(row).toContainText('No access yet.');
  await expect(row.locator('button')).toHaveText('Request access');
});

test('folders that could not be read are listed with Grant access', async ({ page }) => {
  await expect(page.locator('#fs-hint')).toContainText('Not readable yet (not searched)');
  await expect(page.locator('#fs-hint')).toContainText('~/Desktop');
  await page.click('#fs-hint button:text("Grant access")');
  await page.fill('#fs-filter', 'recipe');
  await expect.poll(() => matchPaths(page)).toEqual([`${H}/Desktop/tropical merge/recipe.json`]);
});

test('granting access to the home folder lists everything in it', async ({ page }) => {
  await page.locator('#file-list .tree-status-row.note button').first().click();
  expect((await mockState(page)).reqs[0]).toEqual(['fs', { path: H, access: 'read', create: false }]);
  await expect(node(page, `${H}/.config`)).toBeVisible();
  await expect(page.locator('#file-list')).not.toContainText("Puter doesn't let apps list your home folder");
  await page.fill('#fs-filter', 'notes');
  await expect.poll(() => matchPaths(page)).toEqual([`${H}/Documents/notes.txt`]);
});

test('the app picker offers to find more apps when AppData is refused', async ({ page }) => {
  await page.selectOption('#app-select', '__connect__');
  await expect(page.locator('#app-allow')).toBeVisible();
  await expect(page.locator('#app-results li').first()).toContainText('contains: tropical-merge');
});
