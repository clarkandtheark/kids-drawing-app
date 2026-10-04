import { defineConfig } from '@playwright/test';

const ipad = { hasTouch: true, deviceScaleFactor: 2, browserName: 'chromium' as const };

export default defineConfig({
  testDir: 'tests',
  use: { baseURL: 'http://localhost:5179/' },
  projects: [
    { name: 'portrait', use: { ...ipad, viewport: { width: 1024, height: 1366 } } },
    { name: 'landscape', use: { ...ipad, viewport: { width: 1366, height: 1024 } } },
  ],
  webServer: { command: 'npm run dev -- --port 5179 --strictPort', url: 'http://localhost:5179/', reuseExistingServer: false },
});
