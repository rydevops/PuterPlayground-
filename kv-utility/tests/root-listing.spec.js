// Regression test for "subject does not exist" on the home folder (PR #11).
// Listing "/" can describe the home folder in several forms; the tree must always map it to
// /<username>, keep the special folders under it, and be able to open and search it.
const { test, expect } = require('@playwright/test');
const { openApp, DEFAULTS } = require('./helpers/puter-mock');
const { treeRows, node, matchPaths, openFilesTab } = require('./helpers/app');

const U = 'gentle_bicycle_46621';
const H = `/${U}`;
const HUID = `uid:${H}`; // the mock's uid for the home folder
const SAVE = `${H}/AppData/${DEFAULTS.appID}/tropical-merge/save.json`;

const VARIANTS = {
  'root cannot be listed': null,
  'clean path': [{ name: U, path: H, is_dir: true, uid: HUID }],
  'trailing slash': [{ name: U, path: `${H}/`, is_dir: true, uid: HUID }],
  'tilde path': [{ name: U, path: '~', is_dir: true, uid: HUID }],
  'no path': [{ name: U, is_dir: true, uid: HUID }],
  'display name': [{ name: 'Home', path: H, is_dir: true, uid: HUID }],
  'display name and wrong path': [{ name: 'Home', path: '/Home', is_dir: true, uid: HUID }],
};

for (const [label, rootList] of Object.entries(VARIANTS)) {
  test(`home folder works when "/" lists it as: ${label}`, async ({ page }) => {
    await openApp(page, {
      username: U,
      rootList,
      files: { [SAVE]: '{}', [`${H}/notes.txt`]: 'x' },
      unlistable: ['/', `${H}/AppData`],
    });
    await openFilesTab(page);

    const rows = await treeRows(page);
    const homes = rows.filter((r) => r.depth === 1);
    expect(homes).toHaveLength(1);
    expect(homes[0]).toMatchObject({ path: H, open: true, tag: 'home' });
    for (const name of ['AppData', 'Desktop', 'Documents', 'notes.txt']) {
      expect(rows.some((r) => r.path === `${H}/${name}`)).toBe(true);
    }
    await expect(page.locator('#file-list')).not.toContainText('does not exist');

    // Clicking the home folder collapses and re-opens it without errors.
    await node(page, H).click();
    await expect(node(page, `${H}/notes.txt`)).toHaveCount(0);
    await node(page, H).click();
    await expect(node(page, `${H}/notes.txt`)).toBeVisible();

    await page.fill('#fs-filter', 'save.json');
    await expect.poll(() => matchPaths(page)).toEqual([SAVE]);
  });
}
