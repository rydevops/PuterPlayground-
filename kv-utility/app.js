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
  };

  const DRAFT_KEY = 'kvutil:draft';
  const PREFS_KEY = 'kvutil:prefs';
  const state = { keys: [], loadedName: null, savedText: '', parseError: null, view: 'text' };

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
        const keys = await puter.kv.list();
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
        const value = await puter.kv.get(name);
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
        await puter.kv.set(name, payload);
        state.loadedName = name;
        state.savedText = text;
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
        await puter.kv.del(name);
        state.keys = state.keys.filter((k) => k !== name);
        if (state.loadedName === name) state.loadedName = null;
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

  /* ---------- Editor ---------- */
  function setEditor(text, loadedName) {
    els.editor.value = text;
    state.loadedName = loadedName;
    state.savedText = text;
    onEditorChange();
    renderList();
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
    store.set(DRAFT_KEY, { name: els.storeName.value, text: els.editor.value, loadedName: state.loadedName, savedText: state.savedText, mode: els.saveMode.value });
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
  els.storeName.addEventListener('keydown', (e) => { if (e.key === 'Enter') getStore(); });
  els.storeName.addEventListener('input', saveDraft);
  els.saveMode.addEventListener('change', saveDraft);
  els.viewText.addEventListener('click', () => setView('text'));
  els.viewTree.addEventListener('click', () => setView('tree'));
  els.indent.addEventListener('change', () => {
    els.editor.style.tabSize = els.indent.value === 'tab' ? 4 : els.indent.value;
    store.set(PREFS_KEY, { indent: els.indent.value });
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
      renderList();
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
    store.set(DRAFT_KEY, { name: els.storeName.value, text: els.editor.value, loadedName: state.loadedName, savedText: state.savedText, mode: els.saveMode.value });
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
    }
    onEditorChange();
    renderList();
  }

  restore();
  initServiceWorker();
  refreshAuth().then((signedIn) => { if (signedIn) listStores(); });
})();
