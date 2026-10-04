import { defineConfig } from '@playwright/test';

// PORT lets parallel checkouts run the tests at the same time.
const port = process.env.PORT ?? '5179';
const ipad = { hasTouch: true, deviceScaleFactor: 2, browserName: 'chromium' as const };

export default defineConfig({
  testDir: 'tests',
  use: { baseURL: `http://localhost:${port}/` },
  projects: [
    { name: 'portrait', use: { ...ipad, viewport: { width: 1024, height: 1366 } } },
    { name: 'landscape', use: { ...ipad, viewport: { width: 1366, height: 1024 } } },
  ],
  webServer: { command: `npm run dev -- --port ${port} --strictPort`, url: `http://localhost:${port}/`, reuseExistingServer: false },
});
