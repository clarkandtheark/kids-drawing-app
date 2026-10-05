// Production build, served under /kids-drawing-app/ (see playwright.offline.config.ts).
import { test, expect, type Page, type Request } from '@playwright/test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheVersion, precacheList } from '../vite.config';
import { ink, line, touchStroke } from '../tests/helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'speechSynthesis', {
    configurable: true, value: { speak() {}, cancel() {}, getVoices: () => [] },
  }));
});

// First visit: wait until the worker has precached everything and controls the page.
const install = async (page: Page) => {
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
};

const drawAndNext = async (page: Page) => {
  await expect(page.locator('#lesson')).toBeVisible();
  await touchStroke(page, line([150, 500], [850, 500]));
  expect(await ink(page)).toBeGreaterThan(0);
  await expect(page.locator('#dots i').nth(0)).toHaveClass('on');
  await page.locator('#next').tap();
  await expect(page.locator('#dots i').nth(1)).toHaveClass('on');
};

test('works offline after the first load', async ({ page, context }) => {
  await install(page);
  await context.setOffline(true);
  await page.reload(); // home renders with no network
  await expect(page.locator('#lesson')).toBeHidden();
  await expect(page.locator('main:visible')).not.toHaveCount(0);
  // A real navigation with a query string still gets the cached shell.
  await page.goto('./?from=homescreen#lesson/cat');
  await drawAndNext(page);
});

test('after the first load, nothing touches the network', async ({ page, context }) => {
  await install(page);
  const seen: Request[] = [];
  // From the next launch on. The only exception is the browser's own update check for sw.js on launch.
  context.on('request', (r) => { if (!r.url().endsWith('/sw.js')) seen.push(r); });
  await page.reload();
  await page.goto('./#lesson/cat');
  await drawAndNext(page);
  await page.locator('#home').tap();
  await page.locator('.ask .yes').tap(); // unsaved ink: throw it away
  await expect(page.locator('#lesson')).toBeHidden();
  await page.goto('./#lesson/cat');
  await drawAndNext(page);
  expect(seen.map((r) => r.url())).toContain(new URL('lessons.json', page.url()).href); // the relaunch was recorded
  for (const r of seen) {
    expect(new URL(r.url()).origin, r.url()).toBe(new URL(page.url()).origin);
    expect(r.serviceWorker(), `worker went to the network for ${r.url()}`).toBeNull();
    expect((await r.response())?.fromServiceWorker(), `${r.url()} not served by the worker`).toBe(true);
  }
});

test('precache covers dist/ and its version follows file contents', () => {
  const dist = 'dist', sw = readFileSync(join(dist, 'sw.js'), 'utf8');
  const files = precacheList(dist);
  for (const f of ['./', 'lessons.json', 'manifest.webmanifest', 'apple-touch-icon.png', 'icon-512.png']) expect(files).toContain(f);
  expect(files.some((f) => /^assets\/.+\.js$/.test(f))).toBe(true);
  expect(sw).toContain(JSON.stringify(files));
  expect(sw).toContain(JSON.stringify(cacheVersion(dist)));

  const copy = mkdtempSync(join(tmpdir(), 'sw-'));
  try {
    cpSync(dist, copy, { recursive: true });
    const before = cacheVersion(copy), f = join(copy, 'lessons.json');
    writeFileSync(f, readFileSync(f, 'utf8').replace('"cat"', '"kitty"'));
    expect(cacheVersion(copy)).not.toBe(before);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});

test('manifest, icons and apple meta tags', async ({ page, request }) => {
  await page.goto('./');
  for (const name of ['apple-mobile-web-app-capable', 'mobile-web-app-capable', 'apple-mobile-web-app-title',
    'apple-mobile-web-app-status-bar-style', 'theme-color']) await expect(page.locator(`meta[name="${name}"]`)).toHaveCount(1);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  const links = await page.locator('link[rel=manifest], link[rel=apple-touch-icon], link[rel=icon]').evaluateAll(
    (ls) => ls.map((l) => [l.getAttribute('rel'), l.getAttribute('href'), (l as HTMLLinkElement).href]));
  for (const [, href] of links) expect(href).toMatch(/^\.\//);
  const url = (rel: string) => links.find(([r]) => r === rel)![2]!;

  const m = await (await request.get(url('manifest'))).json();
  expect(m.display).toBe('standalone');
  expect(m.start_url).toBe('./');
  expect(m.scope).toBe('./');
  expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
  const icons: [string, string][] = [...m.icons.map((i: { src: string; sizes: string }) => [new URL(i.src, url('manifest')).href, i.sizes]),
    [url('apple-touch-icon'), '180x180'], [url('icon'), '32x32']];
  for (const [src, sizes] of icons) {
    const png = await (await request.get(src)).body();
    expect(png.subarray(1, 4).toString(), src).toBe('PNG');
    expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, src).toBe(sizes); // IHDR width x height
  }
});
