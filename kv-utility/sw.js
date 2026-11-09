/* KV Utility service worker.
 * Bump VERSION on every release: the browser sees sw.js change, installs the
 * new worker, and the app shows an "Update now" banner. */
const VERSION = '1.5.0';
const CACHE = `kv-utility-${VERSION}`;
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];
const PUTER_SCRIPT = 'https://js.puter.com/v2/';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' makes sure we precache fresh files, not HTTP-cached ones.
    await cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })));
    // Best effort: lets the UI load offline. (cache.add rejects opaque responses, so put manually.)
    try {
      const req = new Request(PUTER_SCRIPT, { mode: 'no-cors', cache: 'reload' });
      await cache.put(req, await fetch(req));
    } catch { /* optional */ }
  })());
  // No skipWaiting() here: an update waits until the user clicks "Update now".
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('kv-utility-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'SKIP_WAITING') self.skipWaiting();
  if (msg.type === 'GET_VERSION' && event.ports[0]) event.ports[0].postMessage({ version: VERSION });
});

/* Network-first: always fresh when online, cached shell when offline. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, { cache: 'no-cache' });
    if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true })
      || (request.mode === 'navigate' ? await cache.match('index.html') : undefined);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  // Only handle our own files and the Puter.js loader; leave Puter API traffic alone.
  if (sameOrigin || request.url === PUTER_SCRIPT) {
    event.respondWith(networkFirst(request));
  }
});
