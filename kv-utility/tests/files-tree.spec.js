// Files tab: explorer tree, search as you type, wildcards, access requests and opening files.
const { test, expect } = require('@playwright/test');
const { openApp, mockState, DEFAULTS } = require('./helpers/puter-mock');
const { treeRows, node, matchPaths, openFilesTab } = require('./helpers/app');

const H = '/tester';
const OWN = `${H}/AppData/${DEFAULTS.appID}`;
const ACCOUNT = {
  files: {
    [`${OWN}/tropical-merge/save.json`]: '{"board":[[2,4]],"score":1234}',
    [`${OWN}/tropical-merge/backup.json`]: '{}',
    [`${OWN}/tropical-merge/log.txt`]: 'started',
    [`${H}/Documents/a/b/save.json`]: '{"deep":true}',
    [`${H}/Documents/save-01.json`]: '{}',
    [`${H}/Documents/save-100.json`]: '{}',
    [`${H}/.config/puter/settings.json`]: '{}',
    [`${H}/.profile`]: 'x',
    [`${H}/notes.txt`]: 'hello',
    [`${H}/Desktop/tropical merge/recipe.json`]: '{"recipe":1}',
    [`${H}/image.bin`]: [0, 159, 146, 150],
  },
  dirs: [`${H}/Documents/empty`],
  locked: [`${H}/Desktop`],
  unlistable: ['/', `${H}/AppData`],
};

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await openApp(page, structuredClone(ACCOUNT));
  await openFilesTab(page);
});

test('starts at the root with the home folder open, listing hidden entries', async ({ page }) => {
  const rows = await treeRows(page);
  expect(rows.slice(0, 2).map((r) => [r.path, r.open, r.tag])).toEqual([['/', true, null], [H, true, 'home']]);
  const home = rows.filter((r) => r.depth === 2).map((r) => r.name);
  // Puter's special folders are always listed under home, plus hidden entries.
  expect(home).toEqual(['.config', 'AppData', 'Desktop', 'Documents', 'Pictures', 'Videos', '.profile', 'image.bin', 'notes.txt']);
  expect(rows.find((r) => r.name === '.config').hidden).toBe(true);
  expect(rows.find((r) => r.name === '.profile').hidden).toBe(true);
});

test('expands and collapses folders on click', async ({ page }) => {
  await node(page, `${H}/Documents`).click();
  await expect(node(page, `${H}/Documents/a`)).toBeVisible();
  await node(page, `${H}/Documents/empty`).click();
  await expect(page.locator('#file-list')).toContainText('Empty folder');
  await node(page, `${H}/Documents`).click();
  await expect(node(page, `${H}/Documents/a`)).toHaveCount(0);
});

test('AppData shows the folders this app can open when it cannot be listed', async ({ page }) => {
  await node(page, `${H}/AppData`).click();
  await expect(node(page, OWN)).toBeVisible();
  await expect(node(page, OWN)).toContainText('this app');
  await expect(page.locator('#file-list')).toContainText('Puter did not allow listing all of AppData');
});

test('filters the whole tree as you type', async ({ page }) => {
  await page.locator('#fs-filter').pressSequentially('save.json');
  await expect.poll(() => matchPaths(page)).toEqual([`${OWN}/tropical-merge/save.json`, `${H}/Documents/a/b/save.json`].sort());
  // Folders leading to matches are opened; everything else is hidden.
  const rows = await treeRows(page);
  expect(rows.every((r) => r.match || r.open)).toBe(true);
  await expect(page.locator('#file-count')).toHaveText(/^2 matches · searched \d+ items$/);

  await page.press('#fs-filter', 'Escape');
  await expect(page.locator('#fs-filter')).toHaveValue('');
  await expect(node(page, `${H}/notes.txt`)).toBeVisible();
});

test('single letters filter immediately and match inside hidden folders', async ({ page }) => {
  await page.fill('#fs-filter', 'settings');
  await expect.poll(() => matchPaths(page)).toEqual([`${H}/.config/puter/settings.json`]);
});

const PATTERNS = [
  ['*.json', [`${H}/.config/puter/settings.json`, `${H}/Documents/a/b/save.json`, `${H}/Documents/save-01.json`, `${H}/Documents/save-100.json`, `${OWN}/tropical-merge/backup.json`, `${OWN}/tropical-merge/save.json`]],
  ['save-??.json', [`${H}/Documents/save-01.json`]],
  ['SAVE*', [`${H}/Documents/a/b/save.json`, `${H}/Documents/save-01.json`, `${H}/Documents/save-100.json`, `${OWN}/tropical-merge/save.json`]],
  ['tropical-merge/*.json', [`${OWN}/tropical-merge/backup.json`, `${OWN}/tropical-merge/save.json`]],
  ['Documents/**/save.json', [`${H}/Documents/a/b/save.json`]],
  ['~/AppData/*/tropical-merge/*.txt', [`${OWN}/tropical-merge/log.txt`]],
  ['tropical merge', [`${OWN}/tropical-merge`]],
  ['nothing*', []],
];
for (const [pattern, expected] of PATTERNS) {
  test(`search pattern ${pattern}`, async ({ page }) => {
    await page.fill('#fs-filter', pattern);
    await expect.poll(() => matchPaths(page)).toEqual(expected.sort());
    if (!expected.length) await expect(page.locator('#file-list')).toContainText('No matches.');
  });
}

test('lists unreadable folders and grants access to them', async ({ page }) => {
  await expect(page.locator('#fs-hint')).toContainText('Not readable yet (not searched): ~/Desktop');
  await page.fill('#fs-filter', 'recipe');
  await expect(page.locator('#file-list')).toContainText('No matches.');
  await page.click('#fs-hint button:text("Grant access")');
  await expect.poll(() => matchPaths(page)).toEqual([`${H}/Desktop/tropical merge/recipe.json`]);
  // One prompt for everything that couldn't be read.
  expect((await mockState(page)).reqs).toEqual([['folder', { name: 'Desktop', access: 'read' }]]);
});

test('expanding a locked special folder asks for access', async ({ page }) => {
  await node(page, `${H}/Desktop`).click();
  await expect(node(page, `${H}/Desktop/tropical merge`)).toBeVisible();
  expect((await mockState(page)).reqs).toEqual([['folder', { name: 'Desktop', access: 'read' }]]);
});

test('a declined request shows Request access in the tree', async ({ page }) => {
  await openApp(page, { ...structuredClone(ACCOUNT), denyRequests: true });
  await openFilesTab(page);
  await node(page, `${H}/Desktop`).click();
  await expect(page.locator('#file-list .tree-status-row.error')).toContainText('No access yet.');
  await expect(page.locator('#file-list .tree-status-row.error button')).toHaveText('Request access');
});

test('opens a file read-only and can copy it into the KV store', async ({ page }) => {
  await page.fill('#fs-filter', 'save.json');
  await node(page, `${OWN}/tropical-merge/save.json`).click();
  await expect(page.locator('#doc-kind')).toHaveText('Puter file · read-only');
  await expect(page.locator('#doc-title')).toHaveText('save.json');
  await expect(page.locator('#doc-sub')).toHaveText(/in ~\/AppData\/app-3ead71a6…\/tropical-merge/);
  await expect(page.locator('#editor')).toHaveValue('{\n  "board": [\n    [\n      2,\n      4\n    ]\n  ],\n  "score": 1234\n}');
  await expect(page.locator('.store-bar')).toBeHidden();
  expect((await treeRows(page)).find((r) => r.current)?.path).toBe(`${OWN}/tropical-merge/save.json`);

  // Saving while a file is open first shows the copy controls.
  await page.keyboard.press('Control+s');
  await expect(page.locator('#save-btn')).toHaveText('Save to KV store');
  await expect(page.locator('#store-name')).toHaveValue('save');
  await page.click('#save-btn');
  await expect.poll(async () => (await mockState(page)).kv['']?.save).toEqual({ board: [[2, 4]], score: 1234 });
  await expect(page.locator('#doc-kind')).toHaveText('KV store');
  await expect(page.locator('#doc-title')).toHaveText('save');
});

test('reload and close an open file', async ({ page }) => {
  await node(page, `${H}/notes.txt`).click();
  await expect(page.locator('#editor')).toHaveValue('hello');
  await page.fill('#editor', 'changed');
  await expect(page.locator('#doc-sub')).toContainText('edited here');
  await page.click('#file-reload');
  await expect(page.locator('#editor')).toHaveValue('hello');
  await page.click('#file-close');
  await expect(page.locator('#doc-title')).toHaveText('New store');
  await expect(page.locator('.store-bar')).toBeVisible();
});

test('refuses binary files', async ({ page }) => {
  await node(page, `${H}/image.bin`).click();
  await expect(page.locator('#toast')).toContainText("looks like a binary file");
});

test('collapse all and refresh', async ({ page }) => {
  await node(page, `${H}/Documents`).click();
  await expect(node(page, `${H}/Documents/a`)).toBeVisible();
  await page.click('#collapse-btn');
  await expect.poll(async () => (await treeRows(page)).map((r) => r.path)).toEqual(['/', H]);
  await page.click('#refresh-tree-btn');
  await expect(node(page, H)).toBeVisible();
});
