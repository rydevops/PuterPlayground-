# KV Utility

An installable PWA for working with the [Puter.js](https://docs.puter.com/) key-value store (`puter.kv`).

Each **store** is a key in your Puter KV space, and its value is a JSON document.

## Features

- **Stores:** type a store name, then **Get**, **Save**, **New** or **Delete**. **↻ List** lists every store, and the filter box takes a substring or a glob (`config:*`).
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
