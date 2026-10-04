import { defineConfig } from '@playwright/test';

// The PWA test needs the PRODUCTION build (the service worker only exists there), served from the same
// sub-path as GitHub Pages. Run with `npm run test:offline`; Playwright stops the server afterwards.
const port = 5183, base = '/kids-drawing-app/';
const ipad = { hasTouch: true, deviceScaleFactor: 2, browserName: 'chromium' as const };

export default defineConfig({
  testDir: 'tests-offline',
  use: { baseURL: `http://localhost:${port}${base}` },
  projects: [
    { name: 'portrait', use: { ...ipad, viewport: { width: 1024, height: 1366 } } },
    { name: 'landscape', use: { ...ipad, viewport: { width: 1366, height: 1024 } } },
  ],
  webServer: {
    command: `npm run build && vite preview --base ${base} --port ${port} --strictPort`,
    url: `http://localhost:${port}${base}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
