// A configurable fake of the parts of Puter.js the KV Utility uses (auth, kv, fs, perms, apps).
//
// Tests describe an account with plain data and the mock reproduces Puter's behaviour that
// matters to the app (checked against Puter's backend, src/backend/services/acl/ACLService.ts):
// - an app may only read its own ~/AppData/<app id> folder, the user's Public folder, and
//   folders the user has granted; everything else, including the home folder, needs a grant;
// - Puter hides refusals from apps: a denied app gets 404 "Subject does not exist", never
//   "forbidden" (hideFromApps), so the app can't tell "no access" from "missing";
// - listing "/" returns the user's home folder (/<username>);
// - per-app KV namespaces, relative paths resolving to this app's folder, reads by uid.
//
//   await openApp(page, { username: 'tester', files: { '/tester/notes.txt': 'hi' } });
//   const calls = await mockState(page); // { reqs, kv, granted }

/**
 * @typedef {Object} MockConfig
 * @property {string} [username]   Signed-in user (home folder is /<username>).
 * @property {string} [appID]      This app's Puter app ID.
 * @property {boolean} [signedIn]  Defaults to true.
 * @property {Record<string,string|number[]>} [files]  Absolute path -> text content (or byte array).
 * @property {string[]} [dirs]      Extra (possibly empty) folders; parents are created automatically.
 * @property {string[]} [granted]   Paths the user has already granted (e.g. ['/tester'] for the whole home).
 * @property {string[]} [locked]    Folders that need a grant at or below them even when a parent is granted.
 * @property {string[]} [unlistable] Folders whose listing is refused unless that exact folder is granted.
 * @property {Array|null} [rootList] Raw entries returned when listing "/" (default: the home folder; null: refused).
 * @property {boolean} [maskDenials] Refuse with 404 "Subject does not exist" like Puter does for apps (default true).
 * @property {Record<string,Record<string,unknown>>} [kv]  Namespace ('' = this app, or app id) -> key -> value.
 * @property {Array<{uid:string,name:string,title?:string,index_url?:string}>} [apps]  Apps the user created.
 * @property {boolean} [appsLocked] puter.apps.list() refused until 'apps' access is granted (default true).
 * @property {boolean} [denyRequests] Every permission prompt is declined.
 * @property {number} [delay]       Milliseconds before fs calls resolve (default 5).
 */

const DEFAULTS = {
  username: 'tester',
  appID: 'app-3ead71a6-ce05-58df-a0bc-7734cbcf5ad3',
  signedIn: true,
  files: {},
  dirs: [],
  granted: [],
  locked: [],
  unlistable: [],
  rootList: undefined,
  maskDenials: true,
  kv: {},
  apps: [],
  appsLocked: true,
  denyRequests: false,
  delay: 5,
};

/** Runs inside the page. Must be self-contained (it is serialised with toString()). */
function installPuterMock(cfg) {
  const U = cfg.username;
  const HOME = `/${U}`;
  const OWN = `${HOME}/AppData/${cfg.appID}`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const err = (code, message) => Object.assign(new Error(message), { code, message });
  const notFound = () => err('subject_does_not_exist', 'Subject does not exist');
  // Puter answers apps with 404 "Subject does not exist" when it refuses them (hideFromApps).
  const forbidden = () => (cfg.maskDenials ? notFound() : err('forbidden', 'Permission denied'));
  const parentOf = (p) => (p.lastIndexOf('/') <= 0 ? '/' : p.slice(0, p.lastIndexOf('/')));
  const under = (p, prefix) => p === prefix || p.startsWith(prefix === '/' ? '/' : `${prefix}/`);

  // Build the folder tree from the file and folder lists.
  const entries = new Map(); // path -> { name, path, is_dir, size, uid }
  const children = new Map(); // folder path -> Set of child paths
  const content = new Map();
  const addDir = (p) => {
    if (entries.has(p)) return;
    entries.set(p, { name: p === '/' ? '/' : p.split('/').pop(), path: p, is_dir: true, size: null, uid: `uid:${p}` });
    children.set(p, children.get(p) || new Set());
    if (p !== '/') { addDir(parentOf(p)); children.get(parentOf(p)).add(p); }
  };
  addDir('/');
  addDir(HOME);
  for (const d of cfg.dirs) addDir(d);
  for (const [p, c] of Object.entries(cfg.files)) {
    const bytes = Array.isArray(c) ? new Uint8Array(c) : new TextEncoder().encode(c);
    addDir(parentOf(p));
    entries.set(p, { name: p.split('/').pop(), path: p, is_dir: false, size: bytes.length, uid: `uid:${p}` });
    children.get(parentOf(p)).add(p);
    content.set(p, bytes);
  }
  const byUid = new Map([...entries.values()].map((e) => [e.uid, e.path]));

  const granted = new Set(cfg.granted);
  const isGranted = (p) => [...granted].some((g) => under(p, g));
  // What an app may read: its own AppData folder, the user's Public folder, and granted paths.
  // A `locked` folder additionally needs a grant at or below it.
  const allowed = (p) => {
    if (under(p, OWN) || under(p, `${HOME}/Public`)) return true;
    if (!isGranted(p)) return false;
    const lock = cfg.locked.find((l) => under(p, l));
    return !lock || [...granted].some((g) => under(g, lock) && under(p, g));
  };
  const state = { reqs: [], granted, kv: cfg.kv, calls: 0 };

  // Relative paths and '~' resolve the way Puter.js does for this app.
  const resolve = (p) => {
    if (p.startsWith('/')) return p;
    if (p === '~' || p.startsWith('~/')) return HOME + p.slice(1);
    const rel = p.replace(/^\.\/?/, '');
    return rel ? `${OWN}/${rel}` : OWN;
  };
  const target = (arg) => {
    if (arg && typeof arg === 'object') {
      if (arg.uid) return byUid.get(arg.uid) ?? null;
      return resolve(arg.path);
    }
    if (byUid.has(arg)) return byUid.get(arg);
    return resolve(String(arg));
  };

  async function readdir(arg) {
    state.calls++;
    await sleep(cfg.delay);
    const p = target(arg);
    if (p === '/') {
      if (cfg.rootList === null) throw forbidden();
      return cfg.rootList ?? [{ ...entries.get(HOME) }];
    }
    if (p === null) throw notFound();
    if (cfg.unlistable.includes(p) && !granted.has(p)) throw forbidden();
    if (!allowed(p)) throw forbidden();
    if (!entries.has(p) || !entries.get(p).is_dir) throw notFound();
    return [...children.get(p)].map((c) => ({ ...entries.get(c) }));
  }

  async function read(arg) {
    await sleep(cfg.delay);
    const p = target(arg);
    if (p === null || !content.has(p)) throw notFound();
    if (!allowed(p)) throw forbidden();
    return new Blob([content.get(p)]);
  }

  async function stat(arg) {
    const p = target(arg);
    if (p === null || !entries.has(p)) throw notFound();
    if (!allowed(p)) throw forbidden();
    return { ...entries.get(p) };
  }

  const grantOne = (resource, d = {}) => {
    state.reqs.push([resource, d]);
    if (cfg.denyRequests) return resource === 'folder' ? undefined : false;
    if (resource === 'folder') { granted.add(`${HOME}/${d.name}`); return `${HOME}/${d.name}`; }
    if (resource === 'fs') { granted.add(resolve(d.path)); return true; }
    if (resource === 'appData') { granted.add(`${HOME}/AppData/${d.app}`); granted.add(`kv:${d.app}`); return true; }
    if (resource === 'apps') { granted.add('apps'); return true; }
    return true;
  };

  const kvNs = (opt) => {
    const app = opt && opt.appUuid;
    if (app && app !== cfg.appID && !granted.has(`kv:${app}`)) throw forbidden();
    const key = app && app !== cfg.appID ? app : '';
    cfg.kv[key] = cfg.kv[key] || {};
    return cfg.kv[key];
  };

  let signedIn = cfg.signedIn;
  window.__puterMock = state;
  window.puter = {
    appID: cfg.appID,
    auth: {
      isSignedIn: () => signedIn,
      getUser: async () => ({ username: U }),
      signIn: async () => { signedIn = true; },
      signOut: () => { signedIn = false; },
    },
    kv: {
      list: async (pattern, opt) => Object.keys(kvNs(typeof pattern === 'object' ? pattern : opt)),
      get: async (k, opt) => (k in kvNs(opt) ? kvNs(opt)[k] : null),
      set: async (k, v, opt) => { kvNs(opt)[k] = v; return true; },
      del: async (k, opt) => { delete kvNs(opt)[k]; return true; },
    },
    fs: { readdir, read, stat },
    perms: {
      request: async (resource, details) => (Array.isArray(resource)
        ? resource.map(({ resource: r, ...d }) => grantOne(r, d))
        : grantOne(resource, details)),
    },
    apps: {
      list: async () => {
        if (cfg.appsLocked && !granted.has('apps')) throw forbidden();
        return cfg.apps;
      },
      get: async (name) => {
        const a = cfg.apps.find((x) => x.name === name);
        if (!a) throw notFound();
        return a;
      },
    },
  };
}

/** Serve the mock in place of https://js.puter.com/v2/ and open the app. */
async function openApp(page, config = {}, { path = '/' } = {}) {
  const cfg = { ...DEFAULTS, ...config };
  const script = `(${installPuterMock.toString()})(${JSON.stringify(cfg)});`;
  await page.context().route('https://js.puter.com/v2/', (route) => route.fulfill({ contentType: 'text/javascript', body: script }));
  await page.goto(path);
  return cfg;
}

/** Read what the mock recorded (permission requests, KV data, grants). */
async function mockState(page) {
  return page.evaluate(() => ({
    reqs: window.__puterMock.reqs,
    kv: window.__puterMock.kv,
    granted: [...window.__puterMock.granted],
  }));
}

module.exports = { openApp, mockState, DEFAULTS };
