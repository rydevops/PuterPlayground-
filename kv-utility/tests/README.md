# KV Utility tests

Browser tests written with [Playwright](https://playwright.dev/). They run the real app in Chromium against a **fake Puter.js** (`helpers/puter-mock.js`), so they need no Puter account or network access.

## Running

```sh
cd kv-utility
npm install
npx playwright install chromium   # first time only, if Chromium isn't installed yet
npm test                          # all tests, headless
npx playwright test files-tree    # one file
npm run test:headed               # watch them run in a browser window
```

`npm test` starts the test server (`tests/server.js`) on port 8765 automatically.

## What's covered

| File | Covers |
|---|---|
| `kv-stores.spec.js` | Listing, filtering (text and `*` globs), get, save, delete, JSON-text save mode, invalid JSON |
| `editor.spec.js` | Format, minify, sort keys, escape/unescape, error line and column, tree view, draft after reload |
| `files-tree.spec.js` | Explorer tree from `/`, hidden entries, expand/collapse, search as you type, wildcard patterns, access requests, opening files read-only, copying a file to a KV store |
| `app-access.spec.js` | Puter's real app restrictions: with no grants the home folder offers Request access and nothing is made up; granting it discovers exactly what's there (hidden folders included); this app's files; access prompts; declined requests; Grant access; app picker |
| `root-listing.spec.js` | Regression for the home folder "subject does not exist" bug: the home folder in every shape listing `/` can return |
| `app-picker.spec.js` | Discovering apps, the one-prompt access request, filtering, connecting another app's KV data, this app's own folder, manual app IDs |
| `mobile.spec.js` | Phone layout: bottom tab bar, tap a store or file to open the editor, unsaved dot, 16px inputs, no overflow at 320 and 360px |
| `update.spec.js` | A new `sw.js` VERSION shows the update banner; updating keeps the draft |

## The fake Puter

`openApp(page, config)` serves the mock instead of `https://js.puter.com/v2/` and opens the app. Describe the account with plain data:

```js
await openApp(page, {
  username: 'tester',
  files: { '/tester/Documents/notes.txt': 'hello' },   // parent folders are created for you
  granted: ['/tester'],                                  // folders the user already allowed (default: none)
  locked: ['/tester/Desktop'],                          // still needs its own grant
  kv: { '': { mine: 1 }, 'app-…': { theirs: 2 } },      // '' is this app's namespace
});
const { reqs, kv, granted } = await mockState(page);    // what the app asked for and stored
```

By default it applies Puter's real restrictions for apps, as checked against Puter's backend (`ACLService`). An app may read only its own `~/AppData/<app id>` folder, the user's `Public` folder and granted folders. Refusals come back as 404 "Subject does not exist", never "forbidden". Pass `granted: ['/tester']` when a test needs a home folder the user has already allowed.

It also follows the rest of the Puter behaviour the app depends on:
- per-app key-value namespaces;
- `~/AppData/<app id>` folders, with relative paths resolving to this app's folder;
- reading folders and files by uid;
- `puter.perms.request` grants for `folder`, `fs`, `appData` and `apps`.

See the comments in `helpers/puter-mock.js` for every option.
