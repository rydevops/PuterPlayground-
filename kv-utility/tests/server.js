// Minimal static file server for the KV Utility (no dependencies).
//
//   node tests/server.js            # serves ./ on http://localhost:8765
//   PORT=9000 node tests/server.js
//
// Test-only hook used by tests/update.spec.js to simulate a new release:
//   GET /__test/sw-version?v=1.2.3   serve sw.js with VERSION = '1.2.3'
//   GET /__test/sw-version           back to the real sw.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8765;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

let swVersionOverride = null;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/__test/sw-version') {
    swVersionOverride = url.searchParams.get('v');
    res.writeHead(204).end();
    return;
  }

  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(ROOT, `.${rel}`);
  // Only serve files inside the app folder, and never the tests or dependencies.
  if (!file.startsWith(ROOT + path.sep) || /[\\/](tests|node_modules)[\\/]/.test(file.slice(ROOT.length))) {
    res.writeHead(404).end('Not found');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    let body = data;
    if (rel === '/sw.js' && swVersionOverride) {
      body = data.toString().replace(/const VERSION = '[^']*';/, `const VERSION = '${swVersionOverride}';`);
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  });
});

server.listen(PORT, () => console.log(`KV Utility on http://localhost:${PORT}`));
