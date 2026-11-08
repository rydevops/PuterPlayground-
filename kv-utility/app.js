/* KV Utility — a small PWA for the Puter.js key-value store.
 * "Stores" are keys in the Puter KV store; each holds a JSON document. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = {
    editor: $('editor'), gutter: $('gutter'), storeName: $('store-name'), saveMode: $('save-mode'),
    getBtn: $('get-btn'), saveBtn: $('save-btn'), newBtn: $('new-btn'), deleteBtn: $('delete-btn'),
    refreshBtn: $('refresh-btn'), filter: $('filter'), list: $('store-list'), count: $('store-count'),
    indent: $('indent'), validity: $('validity'), cursor: $('cursor-pos'), size: $('size'), dirty: $('dirty'),
    textView: $('text-view'), treeView: $('tree-view'), viewText: $('view-text'), viewTree: $('view-tree'),
    fileInput: $('file-input'), toast: $('toast'), authBtn: $('auth-btn'), userLabel: $('user-label'),
    installBtn: $('install-btn'), banner: $('update-banner'), updateReload: $('update-reload'),
    updateDismiss: $('update-dismiss'), checkUpdate: $('check-update'), version: $('app-version'),
    tabStores: $('tab-stores'), tabFiles: $('tab-files'), paneStores: $('pane-stores'), paneFiles: $('pane-files'),
    pathForm: $('path-form'), fsPath: $('fs-path'), upBtn: $('up-btn'), fsFilter: $('fs-filter'),
    fileList: $('file-list'), fileCount: $('file-count'), pickFileBtn: $('pick-file-btn'), source: $('source'),
    appSelect: $('app-select'), appForget: $('app-forget'), appNote: $('app-note'),
    quickFolders: $('quick-folders'), crumbs: $('crumbs'), searchBtn: $('search-btn'), fsHint: $('fs-hint'),
  };

  const DRAFT_KEY = 'kvutil:draft';
  const PREFS_KEY = 'kvutil:prefs';
  const state = {
    keys: [], loadedName: null, savedText: '', parseError: null, view: 'text',
    source: '', files: [], cwd: null, loadedFile: null, username: null, search: null, listError: null,
    app: null, // { uid, label } when working with another app's data
  };
  const MAX_FILE_BYTES = 10 * 1024 * 1024;

  /* ---------- small utils ---------- */
  const store = {
    get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };

  let toastTimer;
  function toast(msg, isError = false) {
    els.toast.textContent = msg;
    els.toast.classList.toggle('err', isError);
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, isError ? 5000 : 2500);
  }

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  function indentUnit() {
    const v = els.indent.value;
    return v === 'tab' ? '\t' : Number(v);
  }

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  function errMsg(e) {
    if (!e) return 'Unknown error';
    if (typeof e === 'string') return e;
    return e.message || e.error?.message || e.msg || JSON.stringify(e);
  }

  /* ---------- Puter ---------- */
  function puterReady() {
    if (!window.puter) {
      toast('Puter.js could not be loaded — are you offline?', true);
      return false;
    }
    return true;
  }

  async function refreshAuth() {
    if (!window.puter) {
      els.authBtn.disabled = true;
      els.userLabel.textContent = 'Offline';
      return;
    }
    let signedIn = false;
    try { signedIn = puter.auth.isSignedIn(); } catch { /* ignore */ }
    if (signedIn) {
      els.authBtn.textContent = 'Sign out';
      try {
        const user = await puter.auth.getUser();
        state.username = user?.username || null;
        els.userLabel.textContent = user?.username ? `@${user.username}` : '';
      } catch { els.userLabel.textContent = ''; }
    } else {
      els.authBtn.textContent = 'Sign in to Puter';
      els.userLabel.textContent = '';
    }
    return signedIn;
  }

  async function ensureSignedIn() {
    if (!puterReady()) return false;
    if (puter.auth.isSignedIn()) return true;
    try {
      await puter.auth.signIn();
      await refreshAuth();
      return true;
    } catch (e) {
      toast(`Sign-in cancelled: ${errMsg(e)}`, true);
      return false;
    }
  }

  async function withBusy(btn, fn) {
    btn.disabled = true;
    try { return await fn(); } finally { btn.disabled = false; }
  }

  /* ---------- Store operations ---------- */
  async function listStores() {
    if (!(await ensureSignedIn())) return;
    await withBusy(els.refreshBtn, async () => {
      try {
        let keys;
        try {
          keys = state.app ? await puter.kv.list('*', kvOpt()) : await puter.kv.list();
        } catch (e) {
          // Access to another app's data may have been revoked: ask again once.
          if (!state.app || isNotFound(e) || !(await requestAppData(state.app.uid))) throw e;
          keys = await puter.kv.list('*', kvOpt());
        }
        state.keys = (keys || []).map((k) => (typeof k === 'string' ? k : k.key)).sort((a, b) => a.localeCompare(b));
        renderList();
      } catch (e) {
        toast(`List failed: ${errMsg(e)}`, true);
      }
    });
  }

  async function getStore(name = els.storeName.value.trim()) {
    if (!name) { toast('Enter a store name first', true); els.storeName.focus(); return; }
    if (isDirty() && !confirm('You have unsaved changes. Discard them and load this store?')) return;
    if (!(await ensureSignedIn())) return;
    await withBusy(els.getBtn, async () => {
      try {
        const value = state.app ? await puter.kv.get(name, kvOpt()) : await puter.kv.get(name);
        els.storeName.value = name;
        if (value === null || value === undefined) {
          toast(`Store "${name}" does not exist yet — Save to create it`);
          setEditor('', name);
          return;
        }
        let text;
        let mode = 'value';
        if (typeof value === 'string') {
          try {
            text = JSON.stringify(JSON.parse(value), null, indentUnit());
            mode = 'string';
          } catch {
            text = JSON.stringify(value, null, indentUnit());
          }
        } else {
          text = JSON.stringify(value, null, indentUnit());
        }
        els.saveMode.value = mode;
        setEditor(text, name);
        toast(`Loaded "${name}"${mode === 'string' ? ' (stored as JSON text)' : ''}`);
      } catch (e) {
        toast(`Get failed: ${errMsg(e)}`, true);
      }
    });
  }

  async function saveStore() {
    const name = els.storeName.value.trim();
    if (!name) { toast('Enter a store name first', true); els.storeName.focus(); return; }
    const text = els.editor.value;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      toast(`Cannot save — invalid JSON: ${e.message}`, true);
      return;
    }
    if (name !== state.loadedName && state.keys.includes(name)
        && !confirm(`Store "${name}" already exists. Overwrite it?`)) return;
    if (!(await ensureSignedIn())) return;
    await withBusy(els.saveBtn, async () => {
      try {
        const payload = els.saveMode.value === 'string' ? JSON.stringify(parsed) : parsed;
        await (state.app ? puter.kv.set(name, payload, kvOpt()) : puter.kv.set(name, payload));
        state.loadedName = name;
        state.savedText = text;
        state.loadedFile = null;
        setSource(kvSource(name));
        renderFiles();
        if (!state.keys.includes(name)) {
          state.keys.push(name);
          state.keys.sort((a, b) => a.localeCompare(b));
        }
        renderList();
        updateStatus();
        toast(`Saved "${name}"`);
      } catch (e) {
        toast(`Save failed: ${errMsg(e)}`, true);
      }
    });
  }

  async function deleteStore() {
    const name = els.storeName.value.trim();
    if (!name) { toast('Enter a store name first', true); return; }
    if (!confirm(`Permanently delete store "${name}"?`)) return;
    if (!(await ensureSignedIn())) return;
    await withBusy(els.deleteBtn, async () => {
      try {
        await (state.app ? puter.kv.del(name, kvOpt()) : puter.kv.del(name));
        state.keys = state.keys.filter((k) => k !== name);
        if (state.loadedName === name) { state.loadedName = null; setSource(''); }
        state.savedText = '';
        renderList();
        updateStatus();
        toast(`Deleted "${name}"`);
      } catch (e) {
        toast(`Delete failed: ${errMsg(e)}`, true);
      }
    });
  }

  function newStore() {
    if (isDirty() && !confirm('Discard unsaved changes?')) return;
    els.storeName.value = '';
    els.saveMode.value = 'value';
    setEditor('{\n}', null);
    els.storeName.focus();
  }

  /* ---------- Store list ---------- */
  function globToRegex(glob) {
    const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${esc}$`, 'i');
  }

  function renderList() {
    const q = els.filter.value.trim();
    let keys = state.keys;
    if (q) {
      if (/[*?]/.test(q)) {
        const re = globToRegex(q);
        keys = keys.filter((k) => re.test(k));
      } else {
        const lq = q.toLowerCase();
        keys = keys.filter((k) => k.toLowerCase().includes(lq));
      }
    }
    els.list.replaceChildren();
    if (!keys.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = state.keys.length ? 'No stores match the filter.' : 'No stores loaded. Click “List”.';
      els.list.append(li);
    }
    for (const k of keys) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = k;
      b.title = k;
      if (k === state.loadedName) b.classList.add('current');
      b.addEventListener('click', () => getStore(k));
      li.append(b);
      els.list.append(li);
    }
    els.count.textContent = state.keys.length
      ? `${keys.length} of ${state.keys.length} store${state.keys.length === 1 ? '' : 's'}`
      : '';
  }

  /* ---------- Other apps' data ----------
   * Puter gives every app (including every website using Puter.js) its own KV namespace
   * and its own folder, ~/AppData/<app id>. Relative paths such as
   * puter.fs.write('a/b.json') land in that folder. Another app's data can be used
   * after the user grants access with puter.perms.request('appData', ...). */
  const kvOpt = () => (state.app ? { appUuid: state.app.uid } : undefined);
  const kvSource = (name) => `KV store: ${name}${state.app ? ` (${state.app.label})` : ''}`;
  const connectedApps = () => store.get(PREFS_KEY, {}).apps || [];

  function saveConnectedApps(apps) {
    store.set(PREFS_KEY, { ...store.get(PREFS_KEY, {}), apps });
  }

  function renderAppSelect() {
    const sel = els.appSelect;
    sel.replaceChildren();
    sel.append(new Option('This app (KV Utility)', ''));
    for (const a of connectedApps()) sel.append(new Option(a.label, a.uid));
    sel.append(new Option('Connect another app…', '__connect__'));
    sel.value = state.app?.uid ?? '';
    els.appForget.hidden = !state.app;
    els.appNote.textContent = state.app ? `Stores and files of ${state.app.label} (${state.app.uid})` : '';
    els.appNote.title = els.appNote.textContent;
  }

  async function resolveAppUid(input) {
    if (APP_UID_RE.test(input)) return input;
    try {
      const app = await puter.apps.get(input);
      if (app?.uid) return app.uid;
    } catch { /* not a registered app name */ }
    return null;
  }

  /** One Puter prompt for another app's KV store (read/write/delete) and files (read). */
  async function requestAppData(uid) {
    try {
      const granted = await puter.perms.request('appData', { app: uid, scopes: { kv: ['read', 'write', 'delete'], fs: ['read'] } });
      if (!granted) toast('Access to that app\'s data was not granted', true);
      return !!granted;
    } catch (e) {
      toast(`Access request failed: ${errMsg(e)}`, true);
      return false;
    }
  }

  async function connectApp() {
    if (!(await ensureSignedIn())) return false;
    const input = (prompt(
      "Enter the other app's ID (looks like app-1234abcd-…) or its Puter app name.\n\n"
      + "Tip: open that app, then run  puter.appID  in its browser console to see its ID.",
    ) || '').trim();
    if (!input) return false;
    const uid = await resolveAppUid(input);
    if (!uid) {
      toast(`Couldn't find an app called "${input}". Use its app ID instead (puter.appID in that app).`, true);
      return false;
    }
    if (uid === puter.appID) {
      toast('That is this app — choose "This app" instead', true);
      return false;
    }
    if (!(await requestAppData(uid))) return false;
    const label = APP_UID_RE.test(input) ? `${uid.slice(0, 12)}…` : input;
    const apps = connectedApps().filter((a) => a.uid !== uid);
    apps.push({ uid, label });
    saveConnectedApps(apps);
    await switchApp(uid);
    toast(`Connected to ${label}`);
    return true;
  }

  async function switchApp(uid) {
    if (isDirty() && !confirm('You have unsaved changes. Discard them and switch apps?')) {
      renderAppSelect();
      return;
    }
    state.app = connectedApps().find((a) => a.uid === uid) || null;
    store.set(PREFS_KEY, { ...store.get(PREFS_KEY, {}), currentApp: state.app?.uid ?? null });
    state.keys = [];
    state.loadedName = null;
    state.savedText = els.editor.value;
    setSource('');
    renderAppSelect();
    renderQuickFolders();
    renderList();
    if (window.puter && puter.auth.isSignedIn()) {
      listStores();
      if (!els.paneFiles.hidden) listDir(state.app ? `~/AppData/${state.app.uid}` : '~');
    }
  }

  function forgetApp() {
    if (!state.app) return;
    if (!confirm(`Remove ${state.app.label} from this list? (Its data is not touched.)`)) return;
    saveConnectedApps(connectedApps().filter((a) => a.uid !== state.app.uid));
    switchApp('');
  }

  /* ---------- Puter files (read-only) ---------- */
  // Puter only lets a website read the user's special folders (and any other path)
  // after the user grants access, so listings can look incomplete until then.
  const SPECIAL_FOLDERS = ['Desktop', 'Documents', 'Pictures', 'Videos'];
  const QUICK_FOLDERS = ['~', '~/Desktop', '~/Documents', '~/Pictures', '~/Videos', '~/Public', '~/AppData'];
  const SEARCH_MAX_DEPTH = 10;
  const SEARCH_MAX_SCANNED = 50000;
  const SEARCH_MAX_RESULTS = 500;

  function expandHome(path) {
    path = (path || '').trim() || '~';
    if (state.username && (path === '~' || path.startsWith('~/'))) path = `/${state.username}${path.slice(1)}`;
    if (path.length > 1) path = path.replace(/\/+$/, '');
    return path;
  }

  /** Show /<user>/... as ~/... for readability. */
  function prettyPath(path) {
    const home = state.username ? `/${state.username}` : null;
    if (home && (path === home || path.startsWith(`${home}/`))) return `~${path.slice(home.length)}`;
    return path;
  }

  function parentOf(path) {
    if (path === '/' || !path.includes('/')) return '/';
    const i = path.lastIndexOf('/');
    return i <= 0 ? '/' : path.slice(0, i);
  }

  function joinPath(dir, name) {
    return dir === '/' ? `/${name}` : `${dir}/${name}`;
  }

  function toEntry(it, dir) {
    return {
      name: it.name,
      path: it.path || joinPath(dir, it.name),
      isDir: !!(it.is_dir ?? it.isDirectory),
      size: it.size ?? null,
    };
  }

  const byDirThenName = (a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name);

  /** If `path` is one of the user's special folders, return its name. */
  function specialFolderOf(path) {
    if (!state.username) return null;
    const m = path.match(new RegExp(`^/${state.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([^/]+)$`));
    return m && SPECIAL_FOLDERS.includes(m[1]) ? m[1] : null;
  }

  const APP_UID_RE = /^app-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** If `path` is inside another app's private folder (~/AppData/<app id>/...), return that app id. */
  function appFolderOf(path) {
    if (!state.username) return null;
    const prefix = `/${state.username}/AppData/`;
    if (!path.startsWith(prefix)) return null;
    const id = path.slice(prefix.length).split('/')[0];
    return APP_UID_RE.test(id) ? id : null;
  }

  /** The puter.perms.request entry that lets this site read `path`. */
  function accessEntryFor(path) {
    const special = specialFolderOf(path);
    if (special) return { resource: 'folder', name: special, access: 'read' };
    const appUid = appFolderOf(path);
    if (appUid) return { resource: 'appData', app: appUid, scopes: { fs: ['read'] } };
    return { resource: 'fs', path, access: 'read', create: false };
  }

  const isNotFound = (e) => /not.?found|does.?not.?exist|no such|subject_does_not_exist/i.test(`${e?.code ?? ''} ${errMsg(e)}`);

  /** Ask the user (through Puter's own prompt) to let this site read `path`. */
  async function requestAccess(path) {
    if (!window.puter?.perms?.request) {
      toast('This version of Puter.js cannot request folder access', true);
      return false;
    }
    try {
      const { resource, ...details } = accessEntryFor(path);
      const granted = await puter.perms.request(resource, details);
      if (!granted) toast('Access was not granted', true);
      return !!granted;
    } catch (e) {
      toast(`Access request failed: ${errMsg(e)}`, true);
      return false;
    }
  }

  const homePath = () => (state.username ? `/${state.username}` : null);

  /** Ask for several folders behind a single Puter prompt. */
  async function requestFolders(paths) {
    if (!window.puter?.perms?.request) {
      toast('This version of Puter.js cannot request folder access', true);
      return false;
    }
    try {
      const entries = paths.map(accessEntryFor);
      const results = await puter.perms.request(entries);
      const ok = Array.isArray(results) ? results.some(Boolean) : !!results;
      if (!ok) toast('Access was not granted', true);
      return ok;
    } catch (e) {
      toast(`Access request failed: ${errMsg(e)}`, true);
      return false;
    }
  }

  async function readFolder(target) {
    const files = ((await puter.fs.readdir(target)) || []).map((it) => toEntry(it, target));
    // Puter hides special folders from websites that have no access yet; always show them in Home
    // so they can be opened (which asks for access).
    if (target === homePath()) {
      for (const name of SPECIAL_FOLDERS) {
        if (!files.some((f) => f.name === name)) files.push({ name, path: joinPath(target, name), isDir: true, size: null });
      }
    }
    return files.sort(byDirThenName);
  }

  async function listDir(path = els.fsPath.value, { autoRequest = true } = {}) {
    if (!(await ensureSignedIn())) return;
    if (!state.username) await refreshAuth();
    const target = expandHome(path);
    cancelSearch();
    state.search = null;
    state.listError = null;
    els.fsPath.value = prettyPath(target);
    els.fileList.replaceChildren(Object.assign(document.createElement('li'), { className: 'empty', textContent: 'Loading…' }));
    try {
      let files;
      try {
        files = await readFolder(target);
      } catch (e) {
        // Special folders and other apps' folders need a one-time grant; ask straight away.
        if (!autoRequest || isNotFound(e) || !(specialFolderOf(target) || appFolderOf(target))) throw e;
        if (!(await requestAccess(target))) throw e;
        files = await readFolder(target);
      }
      state.files = files;
      els.fsFilter.value = '';
      store.set(PREFS_KEY, { ...store.get(PREFS_KEY, {}), fsPath: target });
    } catch (e) {
      state.files = [];
      state.listError = { path: target, message: errMsg(e), canRequest: !isNotFound(e) };
    }
    state.cwd = target;
    renderBreadcrumbs();
    renderFiles();
  }

  function renderQuickFolders() {
    els.quickFolders.replaceChildren();
    const chips = QUICK_FOLDERS.map((p) => [p === '~' ? 'Home' : p.slice(2), p]);
    if (state.app) chips.unshift([`${state.app.label} files`, `~/AppData/${state.app.uid}`]);
    for (const [label, p] of chips) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      if (state.app && p.endsWith(state.app.uid)) b.classList.add('chip-app');
      b.textContent = label;
      b.title = p;
      b.addEventListener('click', () => listDir(p));
      els.quickFolders.append(b);
    }
  }

  function renderBreadcrumbs() {
    els.crumbs.replaceChildren();
    if (state.cwd === null) return;
    const parts = state.cwd.split('/').filter(Boolean);
    const add = (label, path, last) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'crumb';
      b.textContent = label;
      b.title = path;
      if (last) b.setAttribute('aria-current', 'location');
      else b.addEventListener('click', () => listDir(path));
      els.crumbs.append(b);
    };
    add('/', '/', parts.length === 0);
    parts.forEach((p, i) => {
      els.crumbs.append(Object.assign(document.createElement('span'), { className: 'crumb-sep', textContent: '›' }));
      add(p, `/${parts.slice(0, i + 1).join('/')}`, i === parts.length - 1);
    });
  }

  function fileButton(f, showPath) {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = f.path;
    if (f.isDir) b.classList.add('dir');
    if (f.path === state.loadedFile) b.classList.add('current');
    if (!f.isDir && f.size !== null) b.append(Object.assign(document.createElement('span'), { className: 'meta', textContent: formatBytes(f.size) }));
    b.append(Object.assign(document.createElement('span'), { className: 'icon', textContent: f.isDir ? '📁' : '📄' }), document.createTextNode(f.name));
    if (showPath) b.append(Object.assign(document.createElement('span'), { className: 'sub', textContent: prettyPath(parentOf(f.path)) }));
    b.addEventListener('click', () => (f.isDir ? listDir(f.path) : openFile(f.path)));
    return b;
  }

  function emptyRow(text) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = text;
    return li;
  }

  function accessButton(path, label) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm';
    b.textContent = label;
    b.addEventListener('click', async () => {
      if (await requestAccess(path)) listDir(state.cwd, { autoRequest: false });
    });
    return b;
  }

  /** Normalise names so "tropical merge" also finds "Tropical_Merge" or "tropical-merge". */
  const squash = (s) => s.toLowerCase().replace(/[\s_\-.]+/g, '');

  function renderFiles() {
    els.fileList.replaceChildren();
    els.fsHint.replaceChildren();
    const s = state.search;

    if (s) {
      const head = document.createElement('li');
      head.className = 'search-head';
      head.textContent = s.done
        ? `${s.results.length}${s.results.length >= SEARCH_MAX_RESULTS ? '+' : ''} match${s.results.length === 1 ? '' : 'es'} for “${s.query}” in ${prettyPath(s.root)}`
        : `Searching ${prettyPath(s.root)}… ${s.scanned} items checked`;
      const ctl = document.createElement('button');
      ctl.type = 'button';
      ctl.className = 'link';
      ctl.textContent = s.done ? 'Back to folder' : 'Stop';
      ctl.addEventListener('click', () => {
        if (s.done) { state.search = null; els.fsFilter.value = ''; renderFiles(); } else cancelSearch();
      });
      head.append(' ', ctl);
      els.fileList.append(head);
      for (const f of s.results) {
        const li = document.createElement('li');
        li.append(fileButton(f, true));
        els.fileList.append(li);
      }
      if (s.done && !s.results.length) els.fileList.append(emptyRow('Nothing found. The folder may be in a place this app has not been given access to yet.'));
      if (s.error) els.fileList.append(emptyRow(`Some folders could not be searched: ${s.error}`));
      if (s.truncated) els.fileList.append(emptyRow('Search stopped early because there were too many items; search from a smaller folder.'));
      if (s.done && s.skipped.length) {
        const li = emptyRow(`Not searched yet because this app has no access: ${s.skipped.map((d) => d.split('/').pop()).join(', ')}.`);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-sm';
        b.textContent = 'Grant access and search again';
        b.addEventListener('click', async () => {
          if (await requestFolders(s.skipped)) searchFolders(s.query);
        });
        li.append(document.createElement('br'), b);
        els.fileList.append(li);
      }
      els.fileCount.textContent = '';
      renderAccessHint();
      return;
    }

    if (state.listError) {
      const li = emptyRow(`Cannot open ${prettyPath(state.listError.path)}: ${state.listError.message}`);
      li.classList.add('error-row');
      if (state.listError.canRequest) {
        li.append(document.createElement('br'), accessButton(state.listError.path, 'Request access to this folder'));
      }
      els.fileList.append(li);
      els.fileCount.textContent = '';
      return;
    }

    const q = squash(els.fsFilter.value.trim());
    const files = q ? state.files.filter((f) => squash(f.name).includes(q)) : state.files;
    if (!files.length) {
      els.fileList.append(emptyRow(state.cwd === null ? 'Choose a folder above, or enter a path and click “Go”.'
        : state.files.length ? 'Nothing here matches. Press Enter or “Search subfolders” to look deeper.' : 'This folder is empty (or this app cannot see inside it yet).'));
    }
    for (const f of files) {
      const li = document.createElement('li');
      li.append(fileButton(f, false));
      els.fileList.append(li);
    }
    els.fileCount.textContent = state.cwd === null ? '' : `${files.length} of ${state.files.length} item${state.files.length === 1 ? '' : 's'}`;
    renderAccessHint();
  }

  function renderAccessHint() {
    if (state.cwd === null) return;
    const home = homePath();
    const p = document.createElement('p');
    p.className = 'muted small';
    p.append('Missing a folder? ');
    if (state.cwd === home) {
      p.append('Files an app saves with a relative path are in AppData/<app id>: pick that app under “Data from”. ');
      p.append('Folders on your Puter desktop are inside ');
      const d = document.createElement('button');
      d.type = 'button';
      d.className = 'link';
      d.textContent = 'Desktop';
      d.addEventListener('click', () => listDir('~/Desktop'));
      p.append(d, '. ');
    }
    const r = document.createElement('button');
    r.type = 'button';
    r.className = 'link';
    r.textContent = 'Request access to this folder';
    r.addEventListener('click', async () => {
      if (await requestAccess(state.cwd)) listDir(state.cwd, { autoRequest: false });
    });
    p.append(r);
    els.fsHint.append(p);
  }

  /* --- Deep search --- */
  let searchController = null;

  function cancelSearch() {
    if (searchController) searchController.abort();
    searchController = null;
  }

  /** Yield arrays of entries under `root`: server-side recursive listing when available, else a walk. */
  async function* walkTree(root, signal) {
    let yielded = false;
    try {
      const iter = puter.fs.readdir({ path: root, recursive: true, depth: SEARCH_MAX_DEPTH, stream: true });
      if (iter && typeof iter[Symbol.asyncIterator] === 'function') {
        for await (const page of iter) {
          if (signal.aborted) return;
          const items = Array.isArray(page) ? page : (page?.items ?? []);
          yielded = true;
          yield items.map((it) => toEntry(it, root));
        }
        return;
      }
    } catch (e) {
      if (yielded) throw e;
      // Older Puter.js or backend: fall back to walking folder by folder.
    }
    let level = [root];
    for (let depth = 0; depth < SEARCH_MAX_DEPTH && level.length && !signal.aborted; depth++) {
      const next = [];
      for (let i = 0; i < level.length && !signal.aborted; i += 6) {
        const batch = await Promise.all(level.slice(i, i + 6).map(async (dir) => {
          try { return (await puter.fs.readdir(dir) || []).map((it) => toEntry(it, dir)); } catch { return []; }
        }));
        for (const entries of batch) {
          next.push(...entries.filter((e) => e.isDir).map((e) => e.path));
          yield entries;
        }
      }
      level = next;
    }
  }

  async function searchFolders(query = els.fsFilter.value.trim()) {
    if (!query) { toast('Type part of a file or folder name first', true); els.fsFilter.focus(); return; }
    if (!(await ensureSignedIn())) return;
    if (!state.username) await refreshAuth();
    const root = state.cwd ?? expandHome(els.fsPath.value);
    cancelSearch();
    const controller = new AbortController();
    searchController = controller;
    const q = squash(query);
    const s = { query, root, results: [], scanned: 0, done: false, error: null, truncated: false, skipped: [] };
    state.search = s;
    renderFiles();
    let lastPaint = 0;
    const seenDirs = new Set();
    const scan = async (start) => {
      for await (const entries of walkTree(start, controller.signal)) {
        if (controller.signal.aborted) return false;
        s.scanned += entries.length;
        for (const e of entries) {
          if (e.isDir) seenDirs.add(e.path);
          if (s.results.length < SEARCH_MAX_RESULTS && squash(e.name).includes(q) && !s.results.some((r) => r.path === e.path)) s.results.push(e);
        }
        if (s.scanned >= SEARCH_MAX_SCANNED) { s.truncated = true; return false; }
        if (Date.now() - lastPaint > 150 && state.search === s) { lastPaint = Date.now(); renderFiles(); }
      }
      return true;
    };
    try {
      let more = await scan(root);
      // Special folders are often missing from the home listing, so search them directly too.
      const home = homePath();
      const extra = root === home || root === '/'
        ? [...SPECIAL_FOLDERS.map((n) => joinPath(home, n)), ...connectedApps().map((a) => `${home}/AppData/${a.uid}`)]
        : [];
      for (const dir of extra) {
        if (!more || controller.signal.aborted) break;
        if (seenDirs.has(dir)) continue;
        try {
          await puter.fs.readdir(dir);
        } catch (e) {
          if (!isNotFound(e)) s.skipped.push(dir);
          continue;
        }
        const name = dir.split('/').pop();
        if (squash(name).includes(q)) s.results.push({ name, path: dir, isDir: true, size: null });
        more = await scan(dir);
      }
    } catch (e) {
      s.error = errMsg(e);
    }
    if (searchController === controller) searchController = null;
    s.done = true;
    // Folders first, then shallower paths, then name.
    s.results.sort((a, b) => (b.isDir - a.isDir) || (a.path.split('/').length - b.path.split('/').length) || a.name.localeCompare(b.name));
    if (state.search === s) renderFiles();
  }

  /** Turn a Blob into editor text; JSON is pretty-printed, binary is rejected. */
  async function blobToText(blob, label) {
    if (blob.size > MAX_FILE_BYTES) throw new Error(`${label} is ${formatBytes(blob.size)}; the limit is ${formatBytes(MAX_FILE_BYTES)}`);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { text = null; }
    if (text === null || text.includes('\u0000')) throw new Error(`${label} looks like a binary file and can't be shown as text`);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    try { return JSON.stringify(JSON.parse(text), null, indentUnit()); } catch { return text; }
  }

  function loadFileText(text, path) {
    const name = path.split('/').pop();
    const suggest = (p) => (p ? p.split('/').pop().replace(/\.[^.]+$/, '') : '');
    const current = els.storeName.value.trim();
    // Suggest a store name unless the user typed their own.
    const replaceName = !current || current === suggest(state.loadedFile);
    setEditor(text, null, `File: ${path}`);
    state.loadedFile = path;
    if (replaceName) els.storeName.value = suggest(path);
    onEditorChange();
    renderFiles();
    toast(`Opened ${name} — Save to store it in the KV store`);
  }

  async function openFile(path) {
    if (isDirty() && !confirm('You have unsaved changes. Discard them and open this file?')) return;
    if (!(await ensureSignedIn())) return;
    try {
      const blob = await puter.fs.read(path);
      loadFileText(await blobToText(blob, path.split('/').pop()), path);
    } catch (e) {
      toast(`Cannot read file: ${errMsg(e)}`, true);
    }
  }

  async function pickFile() {
    if (isDirty() && !confirm('You have unsaved changes. Discard them and open another file?')) return;
    if (!(await ensureSignedIn())) return;
    try {
      let item = await puter.ui.showOpenFilePicker();
      if (Array.isArray(item)) item = item[0];
      if (!item) return;
      const blob = item.read ? await item.read() : await puter.fs.read(item.path);
      loadFileText(await blobToText(blob, item.name), item.path || item.name);
      if (item.path) {
        const dir = parentOf(item.path);
        if (dir !== state.cwd) listDir(dir);
      }
    } catch (e) {
      if (e?.name === 'AbortError' || /cancel/i.test(errMsg(e))) return;
      toast(`Cannot open file: ${errMsg(e)}`, true);
    }
  }

  function setSideTab(tab) {
    const files = tab === 'files';
    els.paneStores.hidden = files;
    els.paneFiles.hidden = !files;
    els.tabStores.classList.toggle('active', !files);
    els.tabFiles.classList.toggle('active', files);
    els.tabStores.setAttribute('aria-selected', String(!files));
    els.tabFiles.setAttribute('aria-selected', String(files));
    store.set(PREFS_KEY, { ...store.get(PREFS_KEY, {}), tab });
    if (files && state.cwd === null && window.puter && puter.auth.isSignedIn()) listDir();
  }

  /* ---------- Editor ---------- */
  function setEditor(text, loadedName, source = loadedName ? kvSource(loadedName) : '') {
    els.editor.value = text;
    state.loadedName = loadedName;
    state.savedText = text;
    if (!source.startsWith('File:')) state.loadedFile = null;
    setSource(source);
    onEditorChange();
    renderList();
    renderFiles();
  }

  function setSource(source) {
    state.source = source;
    els.source.textContent = source;
    els.source.title = source;
  }

  function isDirty() {
    return els.editor.value !== state.savedText && els.editor.value.trim() !== '';
  }

  function updateGutter() {
    const lines = els.editor.value.split('\n').length;
    if (updateGutter.last !== lines) {
      let s = '';
      for (let i = 1; i <= lines; i++) s += i + '\n';
      els.gutter.textContent = s;
      updateGutter.last = lines;
    }
    els.gutter.scrollTop = els.editor.scrollTop;
  }

  /* Locate a JSON.parse error as an absolute offset (engine messages differ). */
  function errorOffset(err, text) {
    const m = err.message;
    let pos = m.match(/at position (\d+)/);
    if (pos) return Number(pos[1]);
    const lc = m.match(/line (\d+) column (\d+)/);
    if (lc) {
      const lines = text.split('\n');
      let off = 0;
      for (let i = 0; i < Number(lc[1]) - 1 && i < lines.length; i++) off += lines[i].length + 1;
      return off + Number(lc[2]) - 1;
    }
    return scanErrorOffset(text);
  }

  /* Minimal strict JSON scanner, used only to find where parsing fails when the
   * engine's message has no position (e.g. newer Chrome, Safari). */
  function scanErrorOffset(text) {
    let i = 0;
    const fail = () => { throw i; };
    const ws = () => { while (i < text.length && ' \t\n\r'.includes(text[i])) i++; };
    const lit = (w) => { if (text.startsWith(w, i)) i += w.length; else fail(); };
    const str = () => {
      i++;
      while (i < text.length) {
        const c = text[i];
        if (c === '"') { i++; return; }
        if (c < ' ') fail();
        if (c === '\\') {
          i++;
          if (text[i] === 'u') { if (!/^[0-9a-fA-F]{4}/.test(text.slice(i + 1, i + 5))) fail(); i += 5; }
          else if ('"\\/bfnrt'.includes(text[i])) i++;
          else fail();
        } else i++;
      }
      fail();
    };
    const num = () => {
      const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
      if (!m) fail();
      i += m[0].length;
    };
    const val = () => {
      ws();
      const c = text[i];
      if (c === '{') {
        i++; ws();
        if (text[i] === '}') { i++; return; }
        for (;;) {
          ws(); if (text[i] !== '"') fail(); str(); ws();
          if (text[i] !== ':') fail(); i++; val(); ws();
          if (text[i] === ',') { i++; continue; }
          if (text[i] === '}') { i++; return; }
          fail();
        }
      } else if (c === '[') {
        i++; ws();
        if (text[i] === ']') { i++; return; }
        for (;;) {
          val(); ws();
          if (text[i] === ',') { i++; continue; }
          if (text[i] === ']') { i++; return; }
          fail();
        }
      } else if (c === '"') str();
      else if (c === 't') lit('true');
      else if (c === 'f') lit('false');
      else if (c === 'n') lit('null');
      else num();
    };
    try {
      val(); ws();
      return i < text.length ? i : null;
    } catch (pos) {
      return typeof pos === 'number' ? Math.min(pos, text.length) : null;
    }
  }

  function lineCol(text, offset) {
    const before = text.slice(0, offset).split('\n');
    return { line: before.length, col: before[before.length - 1].length + 1 };
  }

  function validate() {
    const text = els.editor.value;
    state.parseError = null;
    if (!text.trim()) {
      els.validity.textContent = 'Empty';
      els.validity.className = 'status-pill';
      return undefined;
    }
    try {
      const v = JSON.parse(text);
      const kind = Array.isArray(v) ? `array[${v.length}]` : v === null ? 'null' : typeof v === 'object' ? `object{${Object.keys(v).length}}` : typeof v;
      els.validity.textContent = `✓ Valid JSON · ${kind}`;
      els.validity.className = 'status-pill ok';
      els.validity.title = '';
      return v;
    } catch (e) {
      const off = errorOffset(e, text);
      state.parseError = { message: e.message, offset: off };
      const where = off !== null ? (({ line, col }) => ` (line ${line}, col ${col})`)(lineCol(text, off)) : '';
      els.validity.textContent = `✗ Invalid${where}`;
      els.validity.title = `${e.message}\nClick to jump to the error.`;
      els.validity.className = 'status-pill err';
      return undefined;
    }
  }

  function updateStatus() {
    const text = els.editor.value;
    els.size.textContent = formatBytes(new TextEncoder().encode(text).length);
    els.dirty.textContent = isDirty() ? '● Unsaved changes' : '';
    updateCursor();
  }

  function updateCursor() {
    const { line, col } = lineCol(els.editor.value, els.editor.selectionStart);
    els.cursor.textContent = `Ln ${line}, Col ${col}`;
  }

  const saveDraft = debounce(() => {
    store.set(DRAFT_KEY, { name: els.storeName.value, text: els.editor.value, loadedName: state.loadedName, savedText: state.savedText, mode: els.saveMode.value, source: state.source, loadedFile: state.loadedFile });
  }, 400);

  const debouncedValidate = debounce(() => {
    const v = validate();
    if (state.view === 'tree') renderTree(v);
  }, 200);

  function onEditorChange() {
    updateGutter();
    updateStatus();
    debouncedValidate();
    saveDraft();
  }

  /** Replace editor content while keeping native undo where supported. */
  function replaceEditorText(text) {
    els.editor.focus();
    els.editor.select();
    if (!document.execCommand || !document.execCommand('insertText', false, text)) {
      els.editor.value = text;
    }
    els.editor.setSelectionRange(0, 0);
    els.editor.scrollTop = 0;
    onEditorChange();
  }

  function parseOrComplain() {
    try {
      return { ok: true, value: JSON.parse(els.editor.value) };
    } catch (e) {
      toast(`Invalid JSON: ${e.message}`, true);
      jumpToError();
      return { ok: false };
    }
  }

  function sortKeysDeep(v) {
    if (Array.isArray(v)) return v.map(sortKeysDeep);
    if (v && typeof v === 'object') {
      return Object.keys(v).sort((a, b) => a.localeCompare(b)).reduce((o, k) => { o[k] = sortKeysDeep(v[k]); return o; }, {});
    }
    return v;
  }

  const actions = {
    format() { const r = parseOrComplain(); if (r.ok) replaceEditorText(JSON.stringify(r.value, null, indentUnit())); },
    minify() { const r = parseOrComplain(); if (r.ok) replaceEditorText(JSON.stringify(r.value)); },
    sort() { const r = parseOrComplain(); if (r.ok) replaceEditorText(JSON.stringify(sortKeysDeep(r.value), null, indentUnit())); },
    stringify() {
      const r = parseOrComplain();
      if (r.ok) replaceEditorText(JSON.stringify(JSON.stringify(r.value)));
    },
    parse() {
      const r = parseOrComplain();
      if (!r.ok) return;
      if (typeof r.value !== 'string') { toast('Unescape expects a JSON string, e.g. "{\\"a\\":1}"', true); return; }
      let out = r.value;
      try { out = JSON.stringify(JSON.parse(r.value), null, indentUnit()); } catch { /* not JSON inside — keep raw */ }
      replaceEditorText(out);
    },
    async copy() {
      try { await navigator.clipboard.writeText(els.editor.value); toast('Copied to clipboard'); } catch { toast('Clipboard unavailable', true); }
    },
    import() { els.fileInput.click(); },
    download() {
      const name = (els.storeName.value.trim() || 'store').replace(/[^\w.-]+/g, '_');
      const blob = new Blob([els.editor.value], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name.endsWith('.json') ? name : `${name}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
  };

  function jumpToError() {
    const pe = state.parseError ?? (validate(), state.parseError);
    if (!pe || pe.offset === null) return;
    setView('text');
    els.editor.focus();
    const off = Math.min(pe.offset, els.editor.value.length);
    els.editor.setSelectionRange(off, Math.min(off + 1, els.editor.value.length));
    const { line } = lineCol(els.editor.value, off);
    const lh = parseFloat(getComputedStyle(els.editor).lineHeight) || 20;
    els.editor.scrollTop = Math.max(0, (line - 5) * lh);
    updateCursor();
  }

  /* ---------- Tree view ---------- */
  function span(cls, text) {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  }

  function valueSpan(v) {
    if (v === null) return span('z', 'null');
    switch (typeof v) {
      case 'string': return span('s', JSON.stringify(v));
      case 'number': return span('n', String(v));
      case 'boolean': return span('b', String(v));
      default: return span('', String(v));
    }
  }

  function treeNode(key, v, depth) {
    const keyEl = key === null ? null : span('k', typeof key === 'number' ? `${key}: ` : `${JSON.stringify(key)}: `);
    if (v && typeof v === 'object') {
      const isArr = Array.isArray(v);
      const entries = isArr ? v.map((x, i) => [i, x]) : Object.entries(v);
      const d = document.createElement('details');
      d.open = depth < 2;
      const sum = document.createElement('summary');
      if (keyEl) sum.append(keyEl);
      sum.append(span('', isArr ? '[ ' : '{ '), span('meta', isArr ? `${entries.length} item${entries.length === 1 ? "" : "s"}` : `${entries.length} key${entries.length === 1 ? "" : "s"}`), span('', isArr ? ' ]' : ' }'));
      d.append(sum);
      for (const [k, x] of entries) d.append(treeNode(k, x, depth + 1));
      return d;
    }
    const div = document.createElement('div');
    div.className = 'leaf';
    if (keyEl) div.append(keyEl);
    div.append(valueSpan(v));
    return div;
  }

  function renderTree(value) {
    els.treeView.replaceChildren();
    if (!els.editor.value.trim()) {
      els.treeView.append(span('meta', 'Nothing to show.'));
      return;
    }
    if (value === undefined) {
      const p = document.createElement('p');
      p.className = 'error';
      p.textContent = `Invalid JSON: ${state.parseError?.message ?? ''}`;
      els.treeView.append(p);
      return;
    }
    els.treeView.append(treeNode(null, value, 0));
  }

  function setView(view) {
    state.view = view;
    const tree = view === 'tree';
    els.textView.hidden = tree;
    els.treeView.hidden = !tree;
    els.viewText.classList.toggle('active', !tree);
    els.viewTree.classList.toggle('active', tree);
    els.viewText.setAttribute('aria-selected', String(!tree));
    els.viewTree.setAttribute('aria-selected', String(tree));
    if (tree) renderTree(validate());
  }

  /* ---------- Event wiring ---------- */
  els.editor.addEventListener('input', onEditorChange);
  els.editor.addEventListener('scroll', () => { els.gutter.scrollTop = els.editor.scrollTop; });
  ['click', 'keyup', 'select'].forEach((ev) => els.editor.addEventListener(ev, updateCursor));
  els.editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const unit = indentUnit() === '\t' ? '\t' : ' '.repeat(indentUnit());
      if (!document.execCommand('insertText', false, unit)) els.editor.setRangeText(unit, els.editor.selectionStart, els.editor.selectionEnd, 'end');
      onEditorChange();
    }
  });

  document.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => actions[b.dataset.action]()));
  els.validity.addEventListener('click', jumpToError);
  els.getBtn.addEventListener('click', () => getStore());
  els.saveBtn.addEventListener('click', saveStore);
  els.deleteBtn.addEventListener('click', deleteStore);
  els.newBtn.addEventListener('click', newStore);
  els.refreshBtn.addEventListener('click', listStores);
  els.filter.addEventListener('input', renderList);
  els.appSelect.addEventListener('change', async () => {
    const v = els.appSelect.value;
    if (v === '__connect__') {
      if (!(await connectApp())) renderAppSelect();
    } else {
      switchApp(v);
    }
  });
  els.appForget.addEventListener('click', forgetApp);
  els.tabStores.addEventListener('click', () => setSideTab('stores'));
  els.tabFiles.addEventListener('click', () => setSideTab('files'));
  els.pathForm.addEventListener('submit', (e) => { e.preventDefault(); listDir(); });
  els.upBtn.addEventListener('click', () => listDir(parentOf(state.cwd ?? expandHome(els.fsPath.value))));
  els.fsFilter.addEventListener('input', () => { if (!state.search) renderFiles(); });
  els.fsFilter.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchFolders(); } });
  els.searchBtn.addEventListener('click', () => searchFolders());
  els.pickFileBtn.addEventListener('click', pickFile);
  els.storeName.addEventListener('keydown', (e) => { if (e.key === 'Enter') getStore(); });
  els.storeName.addEventListener('input', saveDraft);
  els.saveMode.addEventListener('change', saveDraft);
  els.viewText.addEventListener('click', () => setView('text'));
  els.viewTree.addEventListener('click', () => setView('tree'));
  els.indent.addEventListener('change', () => {
    els.editor.style.tabSize = els.indent.value === 'tab' ? 4 : els.indent.value;
    store.set(PREFS_KEY, { ...store.get(PREFS_KEY, {}), indent: els.indent.value });
  });

  els.fileInput.addEventListener('change', async () => {
    const file = els.fileInput.files[0];
    els.fileInput.value = '';
    if (!file) return;
    const text = await file.text();
    replaceEditorText(text);
    if (!els.storeName.value.trim()) els.storeName.value = file.name.replace(/\.json$/i, '');
    toast(`Imported ${file.name}`);
  });

  els.authBtn.addEventListener('click', async () => {
    if (!puterReady()) return;
    if (puter.auth.isSignedIn()) {
      puter.auth.signOut();
      state.keys = [];
      cancelSearch();
      state.files = [];
      state.cwd = null;
      state.search = null;
      state.listError = null;
      state.username = null;
      renderBreadcrumbs();
      renderList();
      renderFiles();
      await refreshAuth();
      toast('Signed out');
    } else if (await ensureSignedIn()) {
      toast('Signed in');
      listStores();
    }
  });

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    if (e.key.toLowerCase() === 's') { e.preventDefault(); saveStore(); }
    else if (e.key === 'Enter') { e.preventDefault(); getStore(); }
    else if (e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); actions.format(); }
  });

  window.addEventListener('beforeunload', (e) => {
    if (isDirty() && !state.reloadingForUpdate) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------- Install prompt ---------- */
  let deferredInstall;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    els.installBtn.hidden = false;
  });
  els.installBtn.addEventListener('click', async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    els.installBtn.hidden = true;
  });
  window.addEventListener('appinstalled', () => { els.installBtn.hidden = true; });

  /* ---------- Service worker & update checks ---------- */
  const UPDATE_INTERVAL_MS = 30 * 60 * 1000;
  let waitingWorker = null;

  function showUpdateBanner(worker) {
    waitingWorker = worker;
    els.banner.hidden = false;
  }

  function askVersion(target) {
    if (!target) return;
    const ch = new MessageChannel();
    ch.port1.onmessage = (ev) => { if (ev.data?.version) els.version.textContent = `v${ev.data.version}`; };
    target.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
  }

  async function initServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      els.checkUpdate.hidden = true;
      return;
    }
    let reg;
    try {
      // updateViaCache: 'none' makes the browser bypass the HTTP cache when checking sw.js for changes.
      reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
    } catch (e) {
      console.warn('Service worker registration failed', e);
      return;
    }
    if (!reg) return;

    const track = (worker) => {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(worker);
      });
    };

    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg.waiting);
    if (reg.installing) track(reg.installing);
    reg.addEventListener('updatefound', () => track(reg.installing));

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      state.reloadingForUpdate = true;
      location.reload();
    });

    askVersion(navigator.serviceWorker.controller || reg.active);
    navigator.serviceWorker.ready.then((r) => askVersion(navigator.serviceWorker.controller || r.active));

    // Periodic + opportunistic update checks.
    const check = () => reg.update().catch(() => {});
    setInterval(check, UPDATE_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    window.addEventListener('online', check);

    els.checkUpdate.addEventListener('click', async () => {
      els.checkUpdate.disabled = true;
      try {
        await reg.update();
        // Give a freshly found worker a moment to finish installing.
        const pending = reg.installing || reg.waiting;
        if (pending) {
          toast('Update found — downloading…');
          if (reg.waiting) showUpdateBanner(reg.waiting);
        } else {
          toast('You are running the latest version');
        }
      } catch {
        toast('Could not check for updates (offline?)', true);
      } finally {
        els.checkUpdate.disabled = false;
      }
    });
  }

  els.updateReload.addEventListener('click', () => {
    saveDraft();
    store.set(DRAFT_KEY, { name: els.storeName.value, text: els.editor.value, loadedName: state.loadedName, savedText: state.savedText, mode: els.saveMode.value, source: state.source, loadedFile: state.loadedFile });
    state.reloadingForUpdate = true;
    if (waitingWorker) waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    else location.reload();
  });
  els.updateDismiss.addEventListener('click', () => { els.banner.hidden = true; });

  /* ---------- Boot ---------- */
  function restore() {
    const prefs = store.get(PREFS_KEY, {});
    if (prefs.indent) els.indent.value = prefs.indent;
    els.editor.style.tabSize = els.indent.value === 'tab' ? 4 : els.indent.value;
    const draft = store.get(DRAFT_KEY, null);
    if (draft) {
      els.storeName.value = draft.name || '';
      els.saveMode.value = draft.mode || 'value';
      els.editor.value = draft.text || '';
      state.loadedName = draft.loadedName ?? null;
      state.savedText = draft.savedText ?? '';
      state.loadedFile = draft.loadedFile ?? null;
      setSource(draft.source || '');
    }
    if (prefs.fsPath) els.fsPath.value = prefs.fsPath;
    if (prefs.tab === 'files') setSideTab('files');
    onEditorChange();
    renderList();
  }

  {
    const prefs = store.get(PREFS_KEY, {});
    state.app = connectedApps().find((a) => a.uid === prefs.currentApp) || null;
  }
  renderAppSelect();
  renderQuickFolders();
  restore();
  initServiceWorker();
  refreshAuth().then((signedIn) => {
    if (!signedIn) return;
    listStores();
  });
})();
