// Browser tests for the KV Utility. Run with `npm test` (see tests/README.md).
const { defineConfig } = require('@playwright/test');

const PORT = Number(process.env.PORT) || 8765;

module.exports = defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: 'chromium',
    viewport: { width: 1280, height: 800 },
    // Most tests don't need the service worker; tests/update.spec.js turns it back on.
    serviceWorkers: 'block',
    trace: 'off',
  },
  webServer: {
    command: 'node tests/server.js',
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
  },
});
