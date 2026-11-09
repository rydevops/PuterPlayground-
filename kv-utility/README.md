# KV Utility

An installable PWA for working with the [Puter.js](https://docs.puter.com/) key-value store (`puter.kv`).

Each **store** is a key in your Puter KV space, and its value is a JSON document.

## Features

- **Stores:** type a store name, then **Get**, **Save**, **New** or **Delete**. **↻ List** lists every store, and the filter box takes a substring or a glob (`config:*`).
- **Puter files (read-only):** the **Files** tab shows your Puter storage as an explorer tree that starts at the root (`/`), with your home folder already open.
  - **Browsing:** click or tap a folder to expand or collapse it; its contents load the first time it opens. Click or tap a file to open it in the editor. The tree shows only what Puter returns when a folder is listed; the app never adds folders of its own. Everything returned is listed, including hidden dot-files and dot-folders, which are dimmed.
  - **Toolbar:** **⊟** collapses every folder and **↻** reads the folders again.
  - **Search as you type:** every keystroke filters the whole tree down to the files and folders that match, plus the folders that lead to them. To make that work for folders you haven't opened yet, the app reads every folder it can in the background when the Files tab opens, and results fill in as it goes. Escape clears the search.
    - Plain text matches part of a name, ignoring case, spaces, `-` and `_`, so `tropical merge` also finds `Tropical_Merge`.
    - **Wildcards:** `*` matches any characters within a name, `?` matches one character, and `**` matches any number of folders. Without a `/` a pattern matches names (`*.json`, `save-??.json`). With a `/` it matches the end of the path (`tropical-merge/*.json`, `Documents/**/save.json`). Starting with `/` or `~` it matches the whole path.
  - Opened files: JSON is pretty-printed, other text opens as-is, and binary files or files over 10 MB are refused.
  - A header at the top of the editor always shows what is open. For a store it shows the store name, which app's data it is, and whether there are unsaved changes. For a file it shows the file name, its folder, and that it is read-only.
  - While a file is open, the key-value controls are hidden. The header offers **Reload**, **Copy to KV store…** (pick a store name, then **Save to KV store**) and **Close**. Files themselves are never changed.

  **Folder access:** an app can read only three kinds of folder on its own: its own `~/AppData/<app id>` folder, your `~/Public` folder, and folders you've allowed. Everything else needs your permission first, including your home folder itself. **Folders you create on the Puter desktop live in `~/Desktop`.**
  - Puter answers a refused app with "Subject does not exist" rather than "permission denied", so the app treats a failed folder as "no access yet" and offers access.
  - A folder that can't be listed yet, including your home folder the first time, shows **Request access** instead of its contents. Once you allow it, its real contents are listed.
  - Expanding Desktop, Documents, Pictures, Videos or an app's folder asks for access automatically.
  - Any other folder that can't be read shows **Request access** in the tree.
  - Folders the background reading couldn't open (and so couldn't search) are listed under the tree, with **Grant access**.
- **This app's files:** apps served from the same site share one app ID, and so share the same folder, `~/AppData/<app id>` (tagged "this app" in the tree), and the same key-value store. For example, a file another app on the same site saved with `puter.fs.write('tropical-merge/save.json', …)` is at `AppData › <app id> › tropical-merge › save.json`.
  - Picking this app in the app picker, or entering its ID, opens its folder in the tree.
- **Other apps' data:** every Puter app, including every website that uses Puter.js, has its own key-value namespace and its own folder, `~/AppData/<app id>`.
  - A relative path such as `puter.fs.write('tropical-merge/save.json', …)` is saved in that folder.
  - To work with another app's data, choose **Data from → Connect another app…**. A picker lists the apps on your account, found in two places:
    - apps you created on Puter (`puter.apps.list()`), shown with their name and site;
    - every app that has a folder in `~/AppData`, which includes plain websites that use Puter.js. Unnamed apps are labelled by what their folder contains, for example "App with tropical-merge".
  - The first time, **Allow access to find more apps** asks for both sources in one Puter prompt. The filter box matches names, sites, IDs and folder contents.
  - Picking an app asks once for access to its key-value store (read, write, delete) and its files (read). You can still enter an app ID or name by hand.
  - Stores, Get, Save and Delete then use that app's key-value store, and its folder opens in the tree.
  - Opening an app's folder under **AppData** asks for access automatically.
- **JSON editor:**
  - Line numbers, plus a cursor position and size readout.
  - Live validation. Click the red pill to jump to the error.
  - Format with 2 spaces, 4 spaces or tabs, Minify, and recursive Sort keys.
  - Escape/Unescape to turn JSON into a JSON string and back.
  - Copy, Import from a file, and Download.
  - A collapsible **Tree** view.
- **Save mode:** saves the value as a native JSON value or as JSON text (a string). The mode is picked automatically when a store is loaded, so other apps that read the store keep working.
- **Drafts:** your work in the editor is saved locally and comes back after a reload or an app update.
- **Phones:** below 760px wide, the app shows one section at a time (Stores, Files or Editor), switched with a bottom tab bar.
  - Picking a store or file opens the Editor, and a dot on the Editor tab marks unsaved changes.
  - The editor controls fit in two rows, the formatting toolbar scrolls sideways, and the app picker opens as a bottom sheet.
  - Tap targets are larger, and form fields use 16px text so iOS doesn't zoom in when you tap one.
- **Shortcuts:** `Ctrl/⌘+S` saves, `Ctrl/⌘+Enter` gets, `Ctrl/⌘+Shift+F` formats, and `Tab` indents.

## Update checks

`sw.js` holds a `VERSION` constant. The service worker is registered with `updateViaCache: 'none'` and checks for a new `sw.js`:

- every 30 minutes,
- whenever the app regains focus or comes back online,
- when you click **Check for updates** in the footer.

When it finds a new version, a banner offers **Update now**. That activates the new worker and reloads the app with your draft kept. Files are served network-first, so you get fresh files when online and cached ones when offline.

**To release:** change your files, then bump `VERSION` in `sw.js`.

## Running

Serve the folder over HTTPS (or `localhost`):

```sh
cd kv-utility
python3 -m http.server 8080
# open http://localhost:8080
```

All paths are relative, so the app also works from a sub-path such as GitHub Pages (`/<repo>/kv-utility/`).

You will be asked to sign in to Puter the first time you list, get or save a store.

## Running the tests

```sh
cd kv-utility
npm install
npm test
```

The browser tests use Playwright and a fake Puter.js, so they need no Puter account. See [`tests/README.md`](tests/README.md) for what they cover and how to write new ones.
