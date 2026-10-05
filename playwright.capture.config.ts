import { defineConfig } from '@playwright/test';

// Screenshot every screen into review/phone/$SHOTS/<project>/ (not part of `npm test`; ~1 min).
//   SHOTS=before npx playwright test -c playwright.capture.config.ts --project=ipad-portrait --project=ipad-landscape
//   SHOTS=after  npx playwright test -c playwright.capture.config.ts --project=ipad-portrait --project=ipad-landscape
//   node scripts/compare-shots.mjs review/phone/before review/phone/after
// The phone projects feed review/phone/final (SHOTS=final).
declare const process: { env: Record<string, string | undefined> };
const port = process.env.PORT ?? '5191';
const ipad = { hasTouch: true, deviceScaleFactor: 2, browserName: 'chromium' as const };
const phone = { hasTouch: true, isMobile: true, deviceScaleFactor: 3, browserName: 'chromium' as const };

export default defineConfig({
  testDir: 'scripts/capture',
  use: { baseURL: `http://localhost:${port}/` },
  projects: [
    { name: 'ipad-portrait', use: { ...ipad, viewport: { width: 1024, height: 1366 } } },
    { name: 'ipad-landscape', use: { ...ipad, viewport: { width: 1366, height: 1024 } } },
    { name: 'phone-390x844', use: { ...phone, viewport: { width: 390, height: 844 } } },
    { name: 'phone-440x956', use: { ...phone, viewport: { width: 440, height: 956 } } },
    { name: 'phone-375x667', use: { ...phone, viewport: { width: 375, height: 667 } } },
    { name: 'phone-844x390', use: { ...phone, viewport: { width: 844, height: 390 } } },
  ],
  webServer: { command: `npm run dev -- --port ${port} --strictPort`, url: `http://localhost:${port}/`, reuseExistingServer: false },
});
