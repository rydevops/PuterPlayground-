// JSON editor: formatters, validation, tree view and drafts.
const { test, expect } = require('@playwright/test');
const { openApp } = require('./helpers/puter-mock');

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('format, minify and sort keys', async ({ page }) => {
  await page.fill('#editor', '{"b":2,"a":{"d":1,"c":[1,2]}}');
  await page.click('[data-action=sort]');
  await expect(page.locator('#editor')).toHaveValue(JSON.stringify({ a: { c: [1, 2], d: 1 }, b: 2 }, null, 2));
  await page.click('[data-action=minify]');
  await expect(page.locator('#editor')).toHaveValue('{"a":{"c":[1,2],"d":1},"b":2}');
  await page.selectOption('#indent', '4');
  await page.click('[data-action=format]');
  await expect(page.locator('#editor')).toHaveValue(JSON.stringify({ a: { c: [1, 2], d: 1 }, b: 2 }, null, 4));
});

test('escape and unescape round-trip', async ({ page }) => {
  await page.fill('#editor', '{"a":"b"}');
  await page.click('[data-action=stringify]');
  await expect(page.locator('#editor')).toHaveValue('"{\\"a\\":\\"b\\"}"');
  await page.click('[data-action=parse]');
  await expect(page.locator('#editor')).toHaveValue('{\n  "a": "b"\n}');
});

test('shows where invalid JSON fails', async ({ page }) => {
  await page.fill('#editor', '{"a":1,\n "b": }');
  await expect(page.locator('#validity')).toHaveText('✗ Invalid (line 2, col 7)');
  await page.fill('#editor', '[1, 2]');
  await expect(page.locator('#validity')).toHaveText('✓ Valid JSON · array[2]');
});

test('tree view renders nested values', async ({ page }) => {
  await page.fill('#editor', '{"x":[1,true,null,"s"]}');
  await page.click('#view-tree');
  await expect(page.locator('#tree-view')).toContainText('"x": [ 4 items ]');
  await expect(page.locator('#tree-view')).toContainText('"s"');
  await page.click('#view-text');
  await expect(page.locator('#editor')).toBeVisible();
});

test('the draft survives a reload', async ({ page }) => {
  await page.fill('#store-name', 'draft-store');
  await page.fill('#editor', '{"draft":true}');
  await page.reload();
  await expect(page.locator('#store-name')).toHaveValue('draft-store');
  await expect(page.locator('#editor')).toHaveValue('{"draft":true}');
});
