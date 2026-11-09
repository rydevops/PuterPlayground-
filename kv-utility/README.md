# KV Utility

An installable PWA for working with the [Puter.js](https://docs.puter.com/) key-value store (`puter.kv`).

Each **store** is a key in your Puter KV space, and its value is a JSON document.

## Features

- **Stores:** type a store name, then **Get**, **Save**, **New** or **Delete**. **↻ List** lists every store, and the filter box takes a substring or a glob (`config:*`).
- **Puter files (read-only):** the **Files** tab in the sidebar browses your Puter cloud storage.
  - **Quick folders** (Home, Desktop, Documents, Pictures, Videos, Public, AppData), clickable **breadcrumbs**, a path box (`~` is your home folder) and **↑**.
  - **Search subfolders:** type part of a name and press Enter. Matching ignores case, spaces, `-` and `_`, so `tropical merge` also finds `Tropical_Merge`. Searching from Home also covers Desktop, Documents, Pictures and Videos.
  - Click a file to open it in the editor. JSON is pretty-printed, other text opens as-is, and binary files or files over 10 MB are refused. **Pick file…** opens Puter's own file picker instead.
  - The status bar shows where the editor content came from. **Save** copies a JSON file into the KV store under the suggested store name. Files themselves are never changed.

  **Folder access:** Puter only lets a website read your Desktop, Documents, Pictures, Videos or any other folder after you allow it. Until then those folders can look empty or be missing, and **folders you create on the Puter desktop live in `~/Desktop`**.
  - Opening one of those folders asks for access automatically.
  - A search lists the folders it couldn't check, with a **Grant access and search again** button.
  - **Request access to this folder** below the list covers any other folder.
- **This app's files:** the **This app's files** chip opens `~/AppData/<this app's id>`. Apps served from the same site share one app ID, and so share the same folder and key-value store. For example, a file another app on the same site saved with `puter.fs.write('tropical-merge/save.json', …)` is at `This app's files › tropical-merge › save.json`.
  - If Puter won't list all of `~/AppData`, the AppData folder still shows the app folders this app can open.
  - Picking this app in the app picker, or entering its ID, opens its folder.
  - A search from Home includes this folder.
- **Other apps' data:** every Puter app, including every website that uses Puter.js, has its own key-value namespace and its own folder, `~/AppData/<app id>`.
  - A relative path such as `puter.fs.write('tropical-merge/save.json', …)` is saved in that folder.
  - To work with another app's data, choose **Data from → Connect another app…**. A picker lists the apps on your account, found in two places:
    - apps you created on Puter (`puter.apps.list()`), shown with their name and site;
    - every app that has a folder in `~/AppData`, which includes plain websites that use Puter.js. Unnamed apps are labelled by what their folder contains, for example "App with tropical-merge".
  - The first time, **Allow access to find more apps** asks for both sources in one Puter prompt. The filter box matches names, sites, IDs and folder contents.
  - Picking an app asks once for access to its key-value store (read, write, delete) and its files (read). You can still enter an app ID or name by hand.
  - Stores, Get, Save and Delete then use that app's key-value store. A **<app> files** chip opens its folder, and a search from Home also covers it.
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
