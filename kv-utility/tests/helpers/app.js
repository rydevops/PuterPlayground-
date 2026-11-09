// Small page helpers shared by the specs.

/** Rows of the Files tree as plain objects (only real nodes, not status rows). */
async function treeRows(page) {
  return page.$$eval('#file-list button.node', (buttons) => buttons.map((b) => ({
    path: b.dataset.path,
    depth: Number(b.style.getPropertyValue('--depth')),
    name: b.querySelector('.name').textContent,
    open: b.closest('li').getAttribute('aria-expanded') === 'true',
    match: b.classList.contains('match'),
    hidden: b.classList.contains('hidden-entry'),
    current: b.classList.contains('current'),
    tag: b.querySelector('.tag')?.textContent ?? null,
  })));
}

/** The tree button for an exact path. */
const node = (page, path) => page.locator(`#file-list button.node[data-path="${path}"]`);

/** Paths of the rows currently marked as search matches. */
async function matchPaths(page) {
  return (await treeRows(page)).filter((r) => r.match).map((r) => r.path).sort();
}

/** Open the Files tab and wait until the background reading of folders has finished. */
async function openFilesTab(page) {
  await page.click('#tab-files');
  await page.waitForFunction(() => {
    const s = document.getElementById('file-count').textContent;
    return document.querySelector('#file-list button.node') && !/reading folders/.test(s);
  });
}

module.exports = { treeRows, node, matchPaths, openFilesTab };
