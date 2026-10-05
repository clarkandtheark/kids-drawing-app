// Production build, served under /kids-drawing-app/ (see playwright.offline.config.ts).
import { test, expect, type Page, type Request } from '@playwright/test';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join } from 'node:path';
import { cacheVersion, precacheList } from '../vite.config';
import { ink, line, touchStroke } from '../tests/helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak() {}, cancel() {}, getVoices: () => [] } });
    (window as any).__played = []; // speech.ts's hook: [text, 'clip' | 'synth'] as each line starts
  });
});

// First visit: wait until the worker has precached everything and controls the page.
const install = async (page: Page) => {
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
};

// The narration clips' own cache (src/sw.js) is warmed by the page in the background a few seconds after launch.
const VOICE = 'kids-drawing-voice-1';
const voiceCached = (page: Page) => page.evaluate(async (name) =>
  (await (await caches.open(name)).keys()).map((k) => k.url.split('/').pop()!).sort(), VOICE);
const clipFiles = () => [...new Set(Object.values(JSON.parse(readFileSync('dist/voice/index.json', 'utf8')).lines as Record<string, { file: string }>)
  .map((c) => c.file))].sort();
const warm = (page: Page) => expect.poll(() => voiceCached(page), { timeout: 60_000 }).toEqual(clipFiles());
const played = (page: Page) => page.evaluate(() => (window as any).__played as [string, string][]);

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
  await warm(page); // narration clips included
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
  // Narration: the clip list is precached, the clips themselves are not (they warm into their own cache later).
  expect(files).toContain('voice/index.json');
  expect(files.filter((f) => f.endsWith('.m4a'))).toEqual([]);
  expect(clipFiles().length).toBeGreaterThan(100);
  for (const f of clipFiles()) expect(existsSync(join(dist, 'voice', f)), f).toBe(true);
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

test('narration offline: a lesson line plays from the audio cache once warmed; before that, the browser voice, no errors', async ({ page, context }) => {
  const failed: string[] = [], errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  // A clip not warmed yet may be tried once offline (navigator.onLine can't always tell); it must fall back quietly.
  context.on('requestfailed', (r) => { if (!/\/voice\/\w+\.m4a$/.test(r.url())) failed.push(`${r.url()} ${r.failure()?.errorText}`); });
  const cat = JSON.parse(readFileSync('lessons/cat.json', 'utf8'));
  const openCat = async () => {
    await page.goto('./#library');
    await page.reload();
    await page.locator('.card[data-id=cat]').tap();
    await expect(page.locator('#lesson')).toBeVisible();
  };
  await install(page);
  await context.setOffline(true); // straight away: the warm-up (a few seconds after launch) has not started
  await openCat();
  await expect.poll(() => played(page)).toEqual([[cat.steps[0].say, 'synth']]);
  expect(await voiceCached(page)).toEqual([]);

  await context.setOffline(false);
  await page.reload();
  await warm(page);
  await context.setOffline(true);
  await openCat();
  await expect.poll(() => played(page)).toEqual([[cat.steps[0].say, 'clip']]);
  await page.locator('#next').tap(); // the next step's line too
  await expect.poll(() => played(page)).toEqual([[cat.steps[0].say, 'clip'], [cat.steps[1].say, 'clip']]);
  expect(failed).toEqual([]);
  expect(errors).toEqual([]);
});

test('an app update that keeps the same clips downloads none of them again', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'portrait', 'one run is enough: it serves its own copy of dist/');
  test.setTimeout(120_000);
  // Its own copy of dist/ on its own server, so the "new version" never touches what the other tests use.
  const dir = mkdtempSync(join(tmpdir(), 'update-')), base = '/kids-drawing-app/';
  cpSync('dist', dir, { recursive: true });
  const types: Record<string, string> = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.m4a': 'audio/mp4', '.css': 'text/css' };
  const server = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url!, 'http://x').pathname).slice(base.length) || 'index.html';
    try {
      const body = readFileSync(join(dir, p));
      res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>((ok) => server.listen(0, ok));
  const url = `http://localhost:${(server.address() as AddressInfo).port}${base}`;
  try {
    await page.goto(url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await warm(page);
    // Every clip request that reached the network (the worker fetching, or the page not served by the worker).
    const net: string[] = [];
    context.on('requestfinished', async (r) => {
      if (r.url().endsWith('.m4a') && (r.serviceWorker() || !(await r.response())?.fromServiceWorker())) net.push(r.url());
    });
    // A new version: same clips, a different precache version.
    const sw = readFileSync(join(dir, 'sw.js'), 'utf8'), v = JSON.stringify(cacheVersion('dist'));
    expect(sw).toContain(v);
    writeFileSync(join(dir, 'sw.js'), sw.replace(v, '"update-test"'));
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting);
    const next = await context.newPage();
    await page.close(); // the last window of the old version: the new one takes over on the next launch
    await next.waitForTimeout(500); // let the old window go before the next launch
    await next.goto(url);
    // The old version's cache is gone, the clips' cache stays.
    await expect.poll(async () => (await next.evaluate(() => caches.keys())).filter((k) => k.startsWith('kids-drawing-')).sort())
      .toEqual(['kids-drawing-update-test', VOICE]);
    await next.waitForTimeout(5000); // past the warm-up's start
    await warm(next);
    expect(net).toEqual([]);
  } finally {
    server.closeAllConnections();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
