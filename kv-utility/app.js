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
    fsFilter: $('fs-filter'), refreshTreeBtn: $('refresh-tree-btn'), collapseBtn: $('collapse-btn'),
    fileList: $('file-list'), fileCount: $('file-count'),
    appSelect: $('app-select'), appForget: $('app-forget'), appNote: $('app-note'),
    appDialog: $('app-dialog'), appSearch: $('app-search'), appStatus: $('app-status'), appResults: $('app-results'),
    appAllow: $('app-allow'), appManual: $('app-manual'), appManualGo: $('app-manual-go'),
    layout: $('layout'), mobileNav: $('mobile-nav'),
    editorPanel: $('editor-panel'), docIcon: $('doc-icon'), docKind: $('doc-kind'), docTitle: $('doc-title'), docSub: $('doc-sub'),
    fileReload: $('file-reload'), fileCopy: $('file-copy'), fileClose: $('file-close'), newStoreBtn: $('new-store-btn'),
    fsHint: $('fs-hint'),
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
        renderDocBar();
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
          if (!state.app || !(await requestAppData(state.app.uid))) throw e;
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
          showEditorOnPhone();
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
        showEditorOnPhone();
      } catch (e) {
        toast(`Get failed: ${errMsg(e)}`, true);
      }
    });
  }

  async function saveStore() {
    if (state.loadedFile && !els.editorPanel.classList.contains('copying')) {
      setCopying(true);
      els.storeName.focus();
      toast('Files are read-only here. Choose a store name, then “Save to KV store”.');
      return;
    }
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
        renderFileTree();
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
    showEditorOnPhone();
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

  /* --- App picker --- */
  // Apps are discovered from two places, merged by app ID:
  //  - puter.apps.list(): apps you created on Puter (has names and titles);
  //  - ~/AppData/<app id> folders: every app (including plain websites using Puter.js)
  //    that has stored files for you.
  let discovery = { apps: [], blocked: [] };

  function appLabel(app) {
    if (app.title || app.name) return app.title || app.name;
    return `Unnamed app ${app.uid.slice(4, 12)}`;
  }

  async function discoverApps() {
    const found = new Map();
    const blocked = [];
    const add = (uid, info, source) => {
      if (!uid) return;
      const cur = found.get(uid) || { uid, sources: new Set() };
      Object.assign(cur, Object.fromEntries(Object.entries(info).filter(([, v]) => v)));
      cur.sources.add(source);
      found.set(uid, cur);
    };

    if (puter.appID) add(puter.appID, { saved: 'This app (KV Utility)' }, 'this');
    for (const a of connectedApps()) add(a.uid, { saved: a.label }, 'connected');

    const tasks = [];
    if (puter.apps?.list) {
      tasks.push((async () => {
        try {
          for (const a of (await puter.apps.list()) || []) {
            let host = '';
            try { host = a.index_url ? new URL(a.index_url).host : ''; } catch { /* ignore */ }
            add(a.uid, { name: a.name, title: a.title, host }, 'yours');
          }
        } catch (e) {
          blocked.push({ resource: 'apps', access: 'read' });
        }
      })());
    }
    tasks.push((async () => {
      const dir = `${homePath()}/AppData`;
      try {
        for (const it of (await puter.fs.readdir(dir)) || []) {
          const e = toEntry(it, dir);
          if (e.isDir && APP_UID_RE.test(e.name)) add(e.name, {}, 'files');
        }
      } catch (e) {
        // Puter refuses apps with "Subject does not exist", so any failure means "ask for access".
        blocked.push({ resource: 'fs', path: '~/AppData', access: 'read', create: false });
      }
    })());
    await Promise.all(tasks);

    // Peek inside each app's folder so unnamed website apps can be recognised by their files.
    const withFiles = [...found.values()].filter((a) => a.sources.has('files') || a.sources.has('this'));
    for (let i = 0; i < withFiles.length; i += 6) {
      await Promise.all(withFiles.slice(i, i + 6).map(async (a) => {
        try {
          const items = await readdirAny(`${homePath()}/AppData/${a.uid}`);
          a.peek = items.map((it) => it.name).sort((x, y) => x.localeCompare(y));
        } catch { /* no access to this app's folder yet */ }
      }));
    }

    const apps = [...found.values()].map((a) => ({
      ...a,
      label: a.title || a.name || a.saved || (a.peek?.length ? `App with ${a.peek[0]}${a.peek.length > 1 ? ` +${a.peek.length - 1}` : ''}` : appLabel(a)),
    }));
    // This app first, then named apps, then by label.
    apps.sort((a, b) => (b.sources.has('this') - a.sources.has('this')) || (!!(b.title || b.name || b.saved) - !!(a.title || a.name || a.saved)) || a.label.localeCompare(b.label));
    return { apps, blocked };
  }

  async function openAppDialog() {
    if (!(await ensureSignedIn())) return;
    if (!state.username) await refreshAuth();
    els.appSearch.value = '';
    els.appManual.value = '';
    els.appDialog.showModal();
    await refreshAppDialog();
  }

  async function refreshAppDialog() {
    discovery = { apps: [], blocked: [] };
    els.appStatus.textContent = 'Looking for apps on your account…';
    els.appResults.replaceChildren();
    els.appAllow.hidden = true;
    discovery = await discoverApps();
    renderAppDialog();
    els.appSearch.focus();
  }

  function renderAppDialog() {
    const q = squash(els.appSearch.value.trim());
    const apps = q
      ? discovery.apps.filter((a) => squash(`${a.label} ${a.name || ''} ${a.host || ''} ${a.uid} ${(a.peek || []).join(' ')}`).includes(q))
      : discovery.apps;
    els.appResults.replaceChildren();
    for (const a of apps) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.title = a.uid;
      if (a.uid === state.app?.uid) b.classList.add('current');
      b.append(document.createTextNode(a.label));
      const tags = [];
      if (a.sources.has('this')) tags.push('this app — any other app on the same site shares this ID and data');
      if (a.sources.has('yours')) tags.push('your app');
      if (a.sources.has('files')) tags.push('has files');
      if (a.sources.has('connected')) tags.push('connected');
      const sub = [a.host, a.uid, tags.join(' · ')].filter(Boolean).join(' — ');
      b.append(Object.assign(document.createElement('span'), { className: 'sub', textContent: sub }));
      if (a.peek) {
        const shown = a.peek.slice(0, 4).join(', ') + (a.peek.length > 4 ? `, +${a.peek.length - 4} more` : '');
        b.append(Object.assign(document.createElement('span'), { className: 'sub peek', textContent: a.peek.length ? `contains: ${shown}` : 'folder is empty' }));
      }
      if (a.sources.has('this') && !state.app) b.classList.add('current');
      b.addEventListener('click', () => connectByUid(a.uid, a.label));
      li.append(b);
      els.appResults.append(li);
    }
    if (!apps.length) {
      els.appResults.append(emptyRow(discovery.apps.length ? 'No apps match the filter.' : 'No apps found yet.'));
    }
    const n = discovery.apps.length;
    els.appStatus.textContent = `${n} app${n === 1 ? '' : 's'} found.`
      + (discovery.blocked.length ? ' Some places could not be checked yet.' : '');
    els.appAllow.hidden = !discovery.blocked.length;
  }

  async function allowAppDiscovery() {
    if (!discovery.blocked.length) return;
    try {
      const res = await puter.perms.request(discovery.blocked);
      if (!(Array.isArray(res) ? res.some(Boolean) : res)) { toast('Access was not granted', true); return; }
    } catch (e) {
      toast(`Access request failed: ${errMsg(e)}`, true);
      return;
    }
    await refreshAppDialog();
  }

  async function connectByUid(uid, label) {
    if (uid === puter.appID) {
      // Same app ID as the KV Utility (e.g. another app on the same site): its data is this app's own data.
      if (els.appDialog.open) els.appDialog.close();
      if (state.app) await switchApp('');
      if (state.app) return false; // switch cancelled
      setSideTab('files');
      if (narrow.matches) setMobileView('files');
      revealPath(`${homePath()}/AppData/${uid}`);
      toast("That app shares this app's ID, so its stores and files are this app's own");
      return true;
    }
    if (!(await requestAppData(uid))) return false;
    const apps = connectedApps().filter((a) => a.uid !== uid);
    apps.push({ uid, label });
    saveConnectedApps(apps);
    if (els.appDialog.open) els.appDialog.close();
    await switchApp(uid);
    toast(`Connected to ${label}`);
    return true;
  }

  async function connectManual() {
    const input = els.appManual.value.trim();
    if (!input) { els.appManual.focus(); return; }
    const uid = await resolveAppUid(input);
    if (!uid) {
      toast(`Couldn't find an app called "${input}". Use its app ID instead (puter.appID in that app).`, true);
      return;
    }
    const known = discovery.apps.find((a) => a.uid === uid);
    await connectByUid(uid, known?.label || (APP_UID_RE.test(input) ? `Unnamed app ${uid.slice(4, 12)}` : input));
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
    renderList();
    if (window.puter && puter.auth.isSignedIn()) {
      listStores();
      // The AppData fallback listing includes connected apps, so read it again.
      resetNode(`${homePath()}/AppData`);
      if (!els.paneFiles.hidden && state.app) revealPath(`${homePath()}/AppData/${state.app.uid}`).then(() => startIndex({ restart: true }));
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

  // NOTE: when an app is not allowed to read a folder, Puter answers "Subject does not exist"
  // (404) on purpose instead of "forbidden", so for folder listings a "not found" error usually
  // means "no access yet". Only use isNotFound() where a real 404 needs different handling.
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

  /** This app's own folder, ~/AppData/<this app's id>. Apps on the same site share one id and one folder. */
  const ownAppDir = () => (window.puter?.appID && state.username ? `/${state.username}/AppData/${puter.appID}` : null);

  /** `path` relative to this app's folder (how Puter.js resolves relative paths), or null if it is outside it. */
  function ownRelative(path) {
    const own = ownAppDir();
    if (!own || (path !== own && !path.startsWith(`${own}/`))) return null;
    return path === own ? '.' : path.slice(own.length + 1);
  }

  /** readdir with a fallback to the relative form for this app's own folder. */
  async function readdirAny(target) {
    try {
      return (await puter.fs.readdir(target)) || [];
    } catch (e) {
      const rel = ownRelative(target);
      if (rel === null) throw e;
      return (await puter.fs.readdir(rel)) || [];
    }
  }



  function emptyRow(text) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = text;
    return li;
  }
  /** Normalise names so "tropical merge" also finds "Tropical_Merge" or "tropical-merge". */
  const squash = (s) => s.toLowerCase().replace(/[\s_\-.]+/g, '');

  const isWildcard = (q) => /[*?]/.test(q);

  /** Turn a wildcard pattern into a case-insensitive RegExp:
   *  `*` = any characters except `/`, `**` = anything (across folders), `?` = one character. */
  function wildcardRegex(pattern, anchorStart) {
    let re = '';
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === '*' && pattern[i + 1] === '*') {
        // "**/" also matches no folder at all, so "a/**/b" finds "a/b".
        if (pattern[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
      } else if (c === '*') re += '[^/]*';
      else if (c === '?') re += '[^/]';
      else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`${anchorStart ? '^' : '(?:^|/)'}${re}$`, 'i');
  }

  /**
   * Build a matcher for the file filter / search box.
   * - Plain text: forgiving "contains" match that ignores case, spaces, `-`, `_` and `.`.
   * - With `*` or `?`: a wildcard pattern. Without `/` it matches the name (`*.json`, `save-??.json`);
   *   with `/` it matches the end of the path (`tropical-merge/*.json`, `AppData/**` + `/save.json`),
   *   or the whole path when it starts with `/` or `~`.
   */
  function nameMatcher(query) {
    const q = query.trim();
    if (!q) return () => true;
    if (!isWildcard(q)) {
      const sq = squash(q);
      return (e) => squash(e.name).includes(sq);
    }
    if (!q.includes('/')) {
      const re = wildcardRegex(q, true);
      return (e) => re.test(e.name);
    }
    const absolute = q.startsWith('/') || q.startsWith('~');
    const re = wildcardRegex((absolute ? expandHome(q) : q).replace(/\/+$/, ''), absolute);
    return (e) => re.test(e.path);
  }

  /* --- Explorer tree ---
   * The Files tab shows Puter storage as a tree starting at the root ("/"). Folder contents are
   * cached by path and loaded the first time a folder is expanded. A background indexer also
   * walks every folder this app can read, so the search box can filter the whole tree as you type.
   * Nothing is hidden: dot-files and dot-folders are listed too (dimmed). */
  const ROOT = '/';
  const MAX_ROWS = 1500;
  const INDEX_MAX_ITEMS = 50000;
  const INDEX_CONCURRENCY = 6;
  const tree = {
    nodes: new Map(), // path -> { path, name, isDir, size, children: string[] | null, loading, error }
    expanded: new Set(store.get(PREFS_KEY, {}).expanded || []),
    filterCollapsed: new Set(), // folders the user closed while a search is active
    index: null, // { running, scanned, denied: string[], truncated }
    initialised: false,
  };

  function nodeFor(path, info) {
    let n = tree.nodes.get(path);
    if (!n) {
      n = { path, name: path === ROOT ? '/' : path.split('/').pop(), isDir: true, size: null, children: null, loading: null, error: null };
      tree.nodes.set(path, n);
    }
    if (info) Object.assign(n, info);
    return n;
  }

  function saveExpanded() {
    store.set(PREFS_KEY, { ...store.get(PREFS_KEY, {}), expanded: [...tree.expanded] });
  }

  /**
   * Turn a raw readdir entry into a tree entry whose path is reliably usable.
   * Puter can describe entries in other forms than the plain absolute path we navigate with
   * (e.g. the home folder listed under "/" as "/user/", "~" or with a display name), so:
   * normalise the given path, rebuild it from the parent folder + name when it doesn't sit
   * directly inside that folder, and always map the user's own home folder to /<username>.
   * The entry's uid is kept as a fallback for reading it if the path still isn't found.
   */
  function toChildEntry(it, dir) {
    const e = toEntry(it, dir);
    const home = homePath();
    let given = typeof it.path === 'string' ? it.path.trim() : '';
    if (given === '~' || given.startsWith('~/')) given = expandHome(given);
    if (given.length > 1) given = given.replace(/\/+$/, '');
    let path = given.startsWith('/') && parentOf(given) === dir && given.split('/').pop() === e.name
      ? given
      : joinPath(dir, e.name);
    if (dir === ROOT && home && (e.name === state.username || given === home)) path = home;
    return { ...e, path, uid: it.uid || it.uuid || null };
  }

  /** readdir by path, falling back to the folder's uid when the path is not found. */
  async function readdirNode(path) {
    try {
      return await readdirAny(path);
    } catch (e) {
      const uid = tree.nodes.get(path)?.uid;
      if (!uid || !isNotFound(e)) throw e;
      return (await puter.fs.readdir({ uid })) || [];
    }
  }

  /**
   * List a folder. Only what Puter actually returns is shown: no folders are added by the app.
   * A refused listing is thrown, and the tree then offers Request access for that folder.
   */
  async function listChildren(path) {
    const home = homePath();
    let entries = (await readdirNode(path)).map((it) => toChildEntry(it, path));
    // Under "/", an entry with an unfamiliar name/path may still be the home folder: compare ids.
    if (path === ROOT && home && entries.some((f) => f.uid && f.path !== home)) {
      const homeUid = await puter.fs.stat(home).then((st) => st?.uid || st?.uuid || null).catch(() => null);
      if (homeUid) entries = entries.map((f) => (f.uid === homeUid ? { ...f, path: home } : f));
    }
    // De-duplicate by path (e.g. the home folder listed twice under different names).
    entries = entries.filter((f, i) => entries.findIndex((g) => g.path === f.path) === i);
    return { entries: entries.sort(byDirThenName) };
  }

  /** Load a folder's children into the cache (once). With autoRequest, ask for access to special/app folders. */
  async function loadNode(path, { autoRequest = false } = {}) {
    const n = nodeFor(path);
    if (n.children) return n;
    if (n.loading) { await n.loading; return n; }
    n.loading = (async () => {
      try {
        let res;
        try {
          res = await listChildren(path);
        } catch (e) {
          if (!autoRequest || !(specialFolderOf(path) || appFolderOf(path))) throw e;
          if (!(await requestAccess(path))) throw e;
          res = await listChildren(path);
        }
        n.children = res.entries.map((e) => nodeFor(e.path, { name: e.name, isDir: e.isDir, size: e.size, ...(e.uid ? { uid: e.uid } : {}) }).path);
        n.error = null;
      } catch (e) {
        n.children = null;
        // "Not found" usually means "no access" for apps (see isNotFound), so always offer access.
        n.error = { message: errMsg(e), canRequest: path !== ROOT };
      } finally {
        n.loading = null;
      }
    })();
    await n.loading;
    return n;
  }

  /** Forget a folder's contents (and its subfolders') so they are read again. */
  function resetNode(path) {
    for (const [p, n] of tree.nodes) {
      if (p === path || p.startsWith(path === ROOT ? '/' : `${path}/`)) { n.children = null; n.error = null; }
    }
  }

  /** Start (or restart) walking every readable folder in the background. */
  async function startIndex({ restart = false } = {}) {
    if (!window.puter || !puter.auth.isSignedIn()) return;
    if (tree.index?.running && !restart) return;
    if (!state.username) await refreshAuth();
    const idx = { running: true, scanned: 0, denied: [], truncated: false };
    tree.index = idx;
    const queue = [ROOT];
    const seen = new Set();
    let active = 0;
    await new Promise((resolve) => {
      const pump = () => {
        if (tree.index !== idx) { resolve(); return; }
        while (active < INDEX_CONCURRENCY && queue.length && !idx.truncated) {
          const path = queue.shift();
          if (seen.has(path)) continue;
          seen.add(path);
          active++;
          loadNode(path).then((n) => {
            if (n.error) {
              if (n.error.canRequest && path !== ROOT) idx.denied.push(path);
              return;
            }
            for (const c of n.children) {
              idx.scanned++;
              if (tree.nodes.get(c).isDir) queue.push(c);
            }
            if (idx.scanned >= INDEX_MAX_ITEMS) idx.truncated = true;
          }).finally(() => {
            active--;
            renderFileTree();
            pump();
          });
        }
        if (!active) resolve();
      };
      pump();
    });
    if (tree.index === idx) {
      idx.running = false;
      renderFileTree();
    }
  }

  /** First time the Files tab is shown: open the root and home folder, then index in the background. */
  async function initTree() {
    if (!window.puter || !puter.auth.isSignedIn()) { renderFileTree(); return; }
    if (!state.username) await refreshAuth();
    if (!tree.initialised) {
      tree.initialised = true;
      if (!store.get(PREFS_KEY, {}).expanded) {
        tree.expanded.add(ROOT);
        if (homePath()) tree.expanded.add(homePath());
        saveExpanded();
      }
      // Load what is expanded first so the tree appears quickly.
      for (const p of [...tree.expanded].sort((a, b) => a.length - b.length)) await loadNode(p);
      renderFileTree();
    }
    startIndex();
  }

  function refreshTree() {
    resetNode(ROOT);
    renderFileTree();
    (async () => {
      for (const p of [...tree.expanded].sort((a, b) => a.length - b.length)) await loadNode(p);
      renderFileTree();
      startIndex({ restart: true });
    })();
  }

  async function toggleFolder(path, { openedBySearch = false } = {}) {
    if (openedBySearch) {
      // Folder shown open because it contains matches: clicking closes/reopens it for this search only.
      if (tree.filterCollapsed.has(path)) tree.filterCollapsed.delete(path); else tree.filterCollapsed.add(path);
      renderFileTree();
      return;
    }
    if (tree.expanded.has(path)) {
      tree.expanded.delete(path);
      saveExpanded();
      renderFileTree();
      return;
    }
    tree.expanded.add(path);
    saveExpanded();
    renderFileTree();
    const n = await loadNode(path, { autoRequest: true });
    renderFileTree();
    if (!n.error && tree.index && !tree.index.running && n.children?.some((c) => tree.nodes.get(c).isDir)) startIndex({ restart: true });
  }

  /** Expand the folders leading to `path` (and `path` itself if it is a folder) and scroll it into view. */
  async function revealPath(path) {
    if (!path || !path.startsWith('/')) return;
    els.fsFilter.value = '';
    tree.filterCollapsed.clear();
    tree.expanded.add(ROOT);
    let cur = ROOT;
    for (const part of path.split('/').filter(Boolean)) {
      await loadNode(cur, { autoRequest: true });
      cur = joinPath(cur, part);
      const n = nodeFor(cur);
      if (n.isDir) tree.expanded.add(cur);
    }
    if (nodeFor(path).isDir) await loadNode(path, { autoRequest: true });
    saveExpanded();
    doRenderFileTree();
    const el = [...els.fileList.querySelectorAll('button.node')].find((b) => b.dataset.path === path);
    el?.scrollIntoView({ block: 'nearest' });
  }

  async function grantDenied() {
    const denied = tree.index?.denied || [];
    if (!denied.length || !(await requestFolders(denied))) return;
    denied.forEach(resetNode);
    startIndex({ restart: true });
  }

  /* --- Rendering --- */
  function renderFileTree() {
    if (renderFileTree.pending) return;
    renderFileTree.pending = true;
    requestAnimationFrame(() => { renderFileTree.pending = false; doRenderFileTree(); });
  }

  /** A button that asks Puter for read access to `path`, then reads it (and everything under it) again. */
  function requestAccessButton(path, label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm';
    btn.textContent = label;
    btn.addEventListener('click', async () => {
      if (!(await requestAccess(path))) return;
      resetNode(path);
      await loadNode(path);
      renderFileTree();
      startIndex({ restart: true });
    });
    return btn;
  }

  function statusRow(depth, text, cls) {
    const li = document.createElement('li');
    li.className = `tree-status-row ${cls || ''}`;
    li.style.setProperty('--depth', depth);
    li.setAttribute('role', 'none');
    li.textContent = text;
    return li;
  }

  function doRenderFileTree() {
    const q = els.fsFilter.value.trim();
    const match = q ? nameMatcher(q) : null;
    const frag = document.createDocumentFragment();
    let rows = 0;
    let matches = 0;
    let truncated = false;

    const selfMemo = new Map();
    const selfMatch = (path) => {
      if (!match || path === ROOT) return false;
      if (!selfMemo.has(path)) selfMemo.set(path, match(tree.nodes.get(path)));
      return selfMemo.get(path);
    };
    const descMemo = new Map();
    const descMatch = (path) => {
      if (descMemo.has(path)) return descMemo.get(path);
      descMemo.set(path, false); // guard
      const n = tree.nodes.get(path);
      const r = !!n?.children?.some((c) => selfMatch(c) || (tree.nodes.get(c).isDir && descMatch(c)));
      descMemo.set(path, r);
      return r;
    };

    const own = ownAppDir();
    const addRow = (n, depth, open, openedBySearch, isMatch) => {
      if (rows >= MAX_ROWS) { truncated = true; return false; }
      rows++;
      const li = document.createElement('li');
      li.setAttribute('role', 'treeitem');
      li.setAttribute('aria-level', String(depth + 1));
      if (n.isDir) li.setAttribute('aria-expanded', String(open));
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'node';
      b.dataset.path = n.path;
      b.title = prettyPath(n.path);
      b.style.setProperty('--depth', depth);
      if (n.name.startsWith('.')) b.classList.add('hidden-entry');
      if (n.path === state.loadedFile) b.classList.add('current');
      if (isMatch) b.classList.add('match');
      b.append(Object.assign(document.createElement('span'), { className: 'caret', textContent: n.isDir ? (n.loading ? '…' : open ? '▾' : '▸') : '' }));
      b.append(Object.assign(document.createElement('span'), { className: 'icon', textContent: n.isDir ? (open ? '📂' : '📁') : '📄' }));
      b.append(Object.assign(document.createElement('span'), { className: 'name', textContent: n.path === ROOT ? '/' : n.name }));
      if (n.path === own) b.append(Object.assign(document.createElement('span'), { className: 'tag', textContent: 'this app' }));
      else if (n.path === homePath()) b.append(Object.assign(document.createElement('span'), { className: 'tag', textContent: 'home' }));
      if (!n.isDir && n.size !== null) b.append(Object.assign(document.createElement('span'), { className: 'meta', textContent: formatBytes(n.size) }));
      b.addEventListener('click', () => (n.isDir ? toggleFolder(n.path, { openedBySearch }) : openFile(n.path)));
      li.append(b);
      frag.append(li);
      return true;
    };

    const addFolderStatus = (n, depth) => {
      if (n.loading && !n.children) frag.append(statusRow(depth, 'Loading…'));
      if (n.error) {
        const li = statusRow(depth, n.error.canRequest ? 'No access yet. ' : `Cannot open ${prettyPath(n.path)}: ${n.error.message}`, 'error');
        li.title = n.path;
        if (n.error.canRequest) li.append(requestAccessButton(n.path, 'Request access'));
        frag.append(li);
      }
      if (n.children && !n.children.length) frag.append(statusRow(depth, 'Empty folder', 'empty'));
    };

    // Plain browsing: everything under expanded folders.
    const browse = (path, depth) => {
      const n = nodeFor(path);
      const open = n.isDir && tree.expanded.has(path);
      if (!addRow(n, depth, open, false, false)) return;
      if (!open) return;
      if (n.children) for (const c of n.children) { browse(c, depth + 1); if (truncated) return; }
      addFolderStatus(n, depth + 1);
    };

    // Searching: only matches and the folders leading to them.
    const search = (path, depth) => {
      const n = nodeFor(path);
      const self = selfMatch(path);
      const desc = n.isDir && descMatch(path);
      if (path !== ROOT && !self && !desc) return;
      if (self) matches++;
      if (desc) {
        const open = !tree.filterCollapsed.has(path);
        if (!addRow(n, depth, open, true, self)) return;
        if (open) for (const c of n.children) { search(c, depth + 1); if (truncated) return; }
      } else if (path === ROOT) {
        addRow(n, depth, false, false, false);
      } else {
        // A matching folder with no matching contents: browse into it normally if the user opens it.
        const open = n.isDir && tree.expanded.has(path);
        if (!addRow(n, depth, open, false, true)) return;
        if (open) {
          if (n.children) for (const c of n.children) { browse(c, depth + 1); if (truncated) return; }
          addFolderStatus(n, depth + 1);
        }
      }
    };

    if (match) search(ROOT, 0); else browse(ROOT, 0);

    const idx = tree.index;
    if (match && !matches) {
      frag.append(statusRow(1, idx?.running ? 'No matches yet — still reading folders…' : 'No matches.', 'empty'));
    }
    if (truncated) frag.append(statusRow(1, `Showing the first ${MAX_ROWS} rows — type more to narrow the search.`, 'note'));
    els.fileList.replaceChildren(frag);

    // Status line: matches and indexing progress.
    const parts = [];
    if (match) parts.push(`${matches}${truncated ? '+' : ''} match${matches === 1 ? '' : 'es'}`);
    if (idx?.running) parts.push(`reading folders… ${idx.scanned} items`);
    else if (idx && match) parts.push(`searched ${idx.scanned} items${idx.truncated ? ' (limit reached)' : ''}`);
    els.fileCount.textContent = parts.join(' · ');

    // Folders that could not be read (and so were not searched).
    els.fsHint.replaceChildren();
    if (idx && !idx.running && idx.denied.length) {
      const p = document.createElement('p');
      p.className = 'muted small';
      const names = idx.denied.map((d) => prettyPath(d));
      p.append(`Not readable yet (not searched): ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` +${names.length - 4} more` : ''}. `);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'link';
      b.textContent = 'Grant access';
      b.addEventListener('click', grantDenied);
      p.append(b);
      els.fsHint.append(p);
    }
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
    state.loadedFile = path;
    setEditor(text, null, `File: ${path}`);
    state.loadedFile = path;
    setCopying(false);
    // Suggested name for "Copy to KV store" (the KV controls are hidden while a file is open).
    els.storeName.value = name.replace(/\.[^.]+$/, '');
    onEditorChange();
    renderFileTree();
    toast(`Opened ${name} (read-only)`);
    showEditorOnPhone();
  }

  async function openFile(path) {
    if (isDirty() && !confirm('You have unsaved changes. Discard them and open this file?')) return;
    if (!(await ensureSignedIn())) return;
    try {
      let blob;
      try {
        blob = await puter.fs.read(path);
      } catch (e) {
        // Fall back to this app's relative path, then to the file's uid from the tree.
        const rel = ownRelative(path);
        const uid = tree.nodes.get(path)?.uid;
        if (rel !== null) blob = await puter.fs.read(rel).catch(() => null);
        if (!blob && uid && isNotFound(e)) blob = await puter.fs.read(uid);
        if (!blob) throw e;
      }
      loadFileText(await blobToText(blob, path.split('/').pop()), path);
    } catch (e) {
      toast(`Cannot read file: ${errMsg(e)}`, true);
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
    if (els.layout.dataset.view !== 'editor' && els.layout.dataset.view !== tab) {
      els.layout.dataset.view = tab;
      for (const b of els.mobileNav.querySelectorAll('button')) {
        if (b.dataset.view === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      }
    }
    if (files) initTree();
  }

  /* ---------- Phone layout ----------
   * On narrow screens one section is shown at a time (Stores, Files or Editor),
   * switched with the bottom tab bar. Wider screens show everything side by side. */
  const narrow = window.matchMedia('(max-width: 760px)');

  function setMobileView(view) {
    els.layout.dataset.view = view;
    for (const b of els.mobileNav.querySelectorAll('button')) {
      if (b.dataset.view === view) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
    if (view !== 'editor' && (els.paneFiles.hidden ? 'stores' : 'files') !== view) setSideTab(view);
    store.set(PREFS_KEY, { ...store.get(PREFS_KEY, {}), mobileView: view });
  }

  /** After picking something to edit, go straight to the editor on phones. */
  function showEditorOnPhone() {
    if (narrow.matches) setMobileView('editor');
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
    renderFileTree();
  }

  function setSource(source) {
    state.source = source;
    if (!state.loadedFile) setCopying(false);
    renderDocBar();
  }

  /* ---------- Editor header: what is open ---------- */
  const ICON_FILE = '<svg viewBox="0 0 24 24"><path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z"/><path d="M14 3.5V8h4.5M9 13h6M9 16.5h4"/></svg>';
  const ICON_STORE = '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6"/></svg>';

  function renderDocBar() {
    const file = state.loadedFile;
    const fileMode = !!file;
    els.editorPanel.classList.toggle('file-mode', fileMode);
    els.docIcon.innerHTML = fileMode ? ICON_FILE : ICON_STORE;
    els.docSub.replaceChildren();
    const edited = isDirty();
    if (fileMode) {
      const name = file.split('/').pop();
      // Shorten app IDs so the meaningful end of the path stays visible on small screens.
      const folder = file.includes('/') ? prettyPath(parentOf(file)).replace(/\b(app-[0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '$1…') : '';
      els.docKind.textContent = 'Puter file · read-only';
      els.docTitle.textContent = name;
      els.docTitle.title = file;
      els.docSub.append(folder ? `in ${folder}` : 'Opened from the file picker');
      els.docSub.title = file;
    } else if (state.loadedName) {
      els.docKind.textContent = state.app ? `KV store · ${state.app.label}` : 'KV store';
      els.docTitle.textContent = state.loadedName;
      els.docTitle.title = state.loadedName;
      els.docSub.append(edited ? '' : 'Saved');
      els.docSub.title = '';
    } else {
      els.docKind.textContent = state.app ? `KV store · ${state.app.label}` : 'KV store';
      els.docTitle.textContent = 'New store';
      els.docTitle.title = '';
      els.docSub.append('Not saved yet: enter a store name, then Save');
      els.docSub.title = '';
    }
    if (edited && (fileMode || state.loadedName)) {
      if (els.docSub.textContent) els.docSub.append(' · ');
      els.docSub.append(Object.assign(document.createElement('span'), {
        className: 'edited',
        textContent: fileMode ? 'edited here — the file itself is not changed' : 'unsaved changes',
      }));
    }
    els.saveBtn.textContent = els.editorPanel.classList.contains('copying') ? 'Save to KV store' : 'Save';
  }

  /** Show or hide the KV controls used to save an open file's content as a store. */
  function setCopying(on) {
    els.editorPanel.classList.toggle('copying', !!on && !!state.loadedFile);
    els.fileCopy.setAttribute('aria-pressed', String(els.editorPanel.classList.contains('copying')));
    els.fileCopy.textContent = els.editorPanel.classList.contains('copying') ? 'Cancel copy' : 'Copy to KV store…';
    renderDocBar();
  }

  function closeFile() {
    if (isDirty() && !confirm('Close this file and discard your edits?')) return;
    els.storeName.value = '';
    els.saveMode.value = 'value';
    setEditor('', null);
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
    els.mobileNav.querySelector('[data-view="editor"]').classList.toggle('dirty', isDirty());
    renderDocBar();
    updateCursor();
  }

  function updateCursor() {
    const { line, col } = lineCol(els.editor.value, els.editor.selectionStart);
    els.cursor.textContent = `Ln ${line}, Col ${col}`;
  }

  function writeDraft() {
    store.set(DRAFT_KEY, { name: els.storeName.value, text: els.editor.value, loadedName: state.loadedName, savedText: state.savedText, mode: els.saveMode.value, source: state.source, loadedFile: state.loadedFile });
  }
  const saveDraft = debounce(writeDraft, 400);
  // Don't lose the latest state to the debounce when the page is closed or reloaded.
  window.addEventListener('pagehide', writeDraft);

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
      renderAppSelect();
      openAppDialog();
    } else {
      switchApp(v);
    }
  });
  els.appForget.addEventListener('click', forgetApp);
  els.appSearch.addEventListener('input', renderAppDialog);
  els.appAllow.addEventListener('click', allowAppDiscovery);
  els.appManualGo.addEventListener('click', connectManual);
  els.appManual.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); connectManual(); } });
  for (const b of els.mobileNav.querySelectorAll('button')) b.addEventListener('click', () => setMobileView(b.dataset.view));
  els.newStoreBtn.addEventListener('click', newStore);
  els.fileReload.addEventListener('click', () => { if (state.loadedFile) openFile(state.loadedFile); });
  els.fileCopy.addEventListener('click', () => {
    const on = !els.editorPanel.classList.contains('copying');
    setCopying(on);
    if (on) els.storeName.focus();
  });
  els.fileClose.addEventListener('click', closeFile);
  els.tabStores.addEventListener('click', () => setSideTab('stores'));
  els.tabFiles.addEventListener('click', () => setSideTab('files'));
  els.fsFilter.addEventListener('input', () => {
    tree.filterCollapsed.clear();
    renderFileTree();
    startIndex();
  });
  els.fsFilter.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { els.fsFilter.value = ''; tree.filterCollapsed.clear(); renderFileTree(); }
    if (e.key === 'Enter') e.preventDefault();
  });
  els.refreshTreeBtn.addEventListener('click', refreshTree);
  els.collapseBtn.addEventListener('click', () => {
    tree.expanded.clear();
    tree.expanded.add(ROOT);
    tree.filterCollapsed.clear();
    saveExpanded();
    renderFileTree();
  });
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
      tree.nodes.clear();
      tree.index = null;
      tree.initialised = false;
      state.username = null;
      renderList();
      renderFileTree();
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
    if (prefs.tab === 'files') setSideTab('files');
    if (prefs.mobileView === 'editor') setMobileView('editor');
    onEditorChange();
    renderList();
  }

  {
    const prefs = store.get(PREFS_KEY, {});
    state.app = connectedApps().find((a) => a.uid === prefs.currentApp) || null;
  }
  renderAppSelect();
  restore();
  initServiceWorker();
  refreshAuth().then((signedIn) => {
    if (!signedIn) return;
    listStores();
  });
})();
