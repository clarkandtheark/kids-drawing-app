// Layered drawings (#22): layers saved with every drawing, save-anytime on Home, store API, legacy data, zip format.
import { test, expect, type Page } from '@playwright/test';
import { unzipSync, zipSync } from 'fflate';
import { ink, line, toClient, touchStroke, type P } from './helpers';
import cat from '../lessons/cat.json' with { type: 'json' };

let errors: string[];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak() {}, cancel() {}, getVoices: () => [] } });
    (navigator as any).canShare = () => false;
    // Remember whether a celebration ever appeared.
    new MutationObserver(() => { if (document.querySelector('.party')) (window as any).__party = true; })
      .observe(document, { childList: true, subtree: true });
  });
});
test.afterEach(() => expect(errors).toEqual([]));

const circle = (cx: number, cy: number, r: number, n = 72): P[] =>
  Array.from({ length: n + 3 }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)]);
const fs = () => import('node:fs/promises' as string);
const RED = [0xe8, 0x40, 0x2a, 255];

type Img = { w: number; h: number; opaque: number; size: number; px: number[][] } | null;
type Rec = { id: number; lessonId: string | null; createdAt: number; keys: string[]; png: Img; ink: Img; color: Img };
/** Every gallery record, newest first, with each image decoded: size, count of non-transparent pixels, pixels at logical points. */
const records = (page: Page, pts: P[] = []): Promise<Rec[]> => page.evaluate(async (pts) => {
  const { listDrawings } = await import('/src/store.ts' as string);
  const decode = async (b?: Blob) => {
    if (!b) return null;
    const bm = await createImageBitmap(b), c = new OffscreenCanvas(bm.width, bm.height), x = c.getContext('2d')!;
    x.drawImage(bm, 0, 0);
    const d = x.getImageData(0, 0, bm.width, bm.height).data, k = bm.width / 1000;
    let opaque = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) opaque++;
    const px = pts.map(([px, py]) => { const i = (Math.floor(py * k) * bm.width + Math.floor(px * k)) * 4; return [...d.slice(i, i + 4)]; });
    return { w: bm.width, h: bm.height, opaque, size: b.size, px };
  };
  return Promise.all((await listDrawings()).map(async (d: any) => ({
    id: d.id, lessonId: d.lessonId, createdAt: d.createdAt, keys: Object.keys(d).sort(),
    png: await decode(d.png), ink: await decode(d.ink), color: await decode(d.color),
  })));
}, pts);
const completed = (page: Page) => page.evaluate(async () => (await import('/src/store.ts' as string)).getCompleted());
const canvasSize = (page: Page) => page.evaluate(() => document.querySelector<HTMLCanvasElement>('#ink, #paint')!.width);

async function toColor(page: Page, draw = async () => {}) {
  await page.goto('./#lesson/cat');
  await expect(page.locator('#ink')).toBeVisible();
  await draw();
  for (let i = 0; i < cat.steps.length; i++) await page.locator('#next').tap();
  await page.locator('.result .go').tap(); // the result card (#21) sits between tracing and Color mode
  await expect(page.locator('#lesson')).toHaveAttribute('data-phase', 'color');
}
async function fillAt(page: Page, p: P) {
  await page.locator('[data-tool=fill]').tap();
  const [[x, y]] = await toClient(page, [p]);
  await page.touchscreen.tap(x, y);
}
const box = async (page: Page, sel: string) => (await page.locator(sel).boundingBox())!;
type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('finishing a lesson saves the picture plus full-resolution ink and colour layers', async ({ page }) => {
  await toColor(page, async () => {
    await touchStroke(page, circle(500, 500, 250));
    await touchStroke(page, line([100, 930], [900, 930]));
  });
  await fillAt(page, [500, 500]);
  const R = await canvasSize(page);
  await page.locator('[data-act=done]').tap();
  await expect(page.locator('#menu')).toBeVisible({ timeout: 5000 });
  const [d, ...rest] = await records(page, [[500, 500], [500, 930], [20, 20]]);
  expect(rest).toHaveLength(0);
  expect(d.lessonId).toBe('cat');
  expect(d.keys).toEqual(['color', 'createdAt', 'id', 'ink', 'lessonId', 'png']);
  // png: flattened 1024px picture on white
  expect(d.png).toMatchObject({ w: 1024, h: 1024 });
  expect(d.png!.px[0]).toEqual(RED);
  expect(d.png!.px[1].slice(0, 3).every((v) => v < 100)).toBe(true);
  expect(d.png!.px[2]).toEqual([255, 255, 255, 255]);
  // ink: her lines only, transparent elsewhere, at the canvas resolution
  expect(d.ink).toMatchObject({ w: R, h: R });
  expect(d.ink!.px[1][3]).toBe(255);
  expect(d.ink!.px[0][3]).toBe(0);
  expect(d.ink!.px[2][3]).toBe(0);
  // colour: the paint, no line pixels, transparent elsewhere
  expect(d.color).toMatchObject({ w: R, h: R });
  expect(d.color!.px[0]).toEqual(RED);
  expect(d.color!.px[1][3]).toBe(0);
  expect(d.color!.px[2][3]).toBe(0);
  expect(await completed(page)).toEqual(['cat']);
});

test('leaving mid-tracing: back keeps everything, trash saves nothing, save stores her ink without the guide', async ({ page }, info) => {
  await page.goto('./#lesson/cat');
  await expect(page.locator('#ink')).toBeVisible();
  // A point on the guide she does NOT trace.
  const g = await page.locator('#sheet #guide path.now').first().evaluate((p: SVGPathElement) => {
    const q = p.getPointAtLength(p.getTotalLength() / 2);
    return [q.x, q.y] as [number, number];
  });
  expect(Math.abs(g[1] - 930)).toBeGreaterThan(60);
  await touchStroke(page, line([100, 930], [900, 930]));
  const n = await ink(page);

  // back: dialog closes, she is still drawing, nothing lost
  await page.locator('#home').tap();
  await expect(page.locator('.ask button')).toHaveCount(3);
  await page.screenshot({ path: `review/saves/leave-lesson-${info.project.name}.png` });
  await page.locator('.ask .no').tap();
  await expect(page.locator('.ask')).toHaveCount(0);
  await expect(page.locator('#lesson')).toBeVisible();
  expect(await ink(page)).toBe(n);
  // a tap outside is back too
  await page.locator('#home').tap();
  await page.mouse.click(5, 5);
  await expect(page.locator('.ask')).toHaveCount(0);
  await expect(page.locator('#lesson')).toBeVisible();

  // trash: home, nothing saved
  await page.locator('#home').tap();
  await page.locator('.ask .yes').tap();
  await expect(page.locator('#menu')).toBeVisible();
  expect(await records(page)).toHaveLength(0);

  // save: one drawing, her ink, no guide, not completed, no celebration
  await page.locator('.card[data-id=cat]').tap();
  await expect(page.locator('#ink')).toBeVisible();
  await touchStroke(page, line([100, 930], [900, 930]));
  await page.locator('#home').tap();
  await page.locator('.ask .save').tap();
  await expect(page.locator('#menu')).toBeVisible();
  const list = await records(page, [[500, 930], g]);
  expect(list).toHaveLength(1);
  const [d] = list;
  expect(d.lessonId).toBe('cat');
  expect(d.ink!.px[0][3]).toBe(255);
  expect(d.ink!.px[1][3]).toBe(0); // no guide pixels
  expect(d.png!.px[1]).toEqual([255, 255, 255, 255]);
  expect(d.color!.opaque).toBe(0);
  expect(await completed(page)).toEqual([]);
  await expect(page.locator('.card[data-id=cat]')).not.toHaveClass(/done/);
  expect(await page.evaluate(() => (window as any).__party ?? false)).toBe(false);

  // reopening starts clean, and Home then leaves without asking
  await page.locator('.card[data-id=cat]').tap();
  await expect(page.locator('#ink')).toBeVisible();
  expect(await ink(page)).toBe(0);
  await page.locator('#home').tap();
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('.ask')).toHaveCount(0);
});

test('Color mode right after tracing: save stores the line art and an empty colour layer', async ({ page }) => {
  await toColor(page, () => touchStroke(page, circle(500, 500, 250)));
  await page.locator('#home').tap();
  await page.locator('.ask .save').tap();
  await expect(page.locator('#menu')).toBeVisible();
  const [d] = await records(page);
  expect(d.ink!.opaque).toBeGreaterThan(1000);
  expect(d.color!.opaque).toBe(0);
  expect(d.color!.w).toBe(d.ink!.w);
  expect(await completed(page)).toEqual([]);
});

test('free draw: save-on-leave and the star both store a colour layer and no ink', async ({ page }, info) => {
  await page.goto('./#draw');
  await expect(page.locator('#paint')).toBeVisible();
  await touchStroke(page, line([100, 500], [900, 500]));
  await page.locator('#fhome').tap();
  await expect(page.locator('.ask button')).toHaveCount(3);
  await page.screenshot({ path: `review/saves/leave-free-${info.project.name}.png` });
  await page.locator('.ask .save').tap();
  await expect(page.locator('#menu')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__party ?? false)).toBe(false);

  await page.locator('#tofree').tap();
  await expect(page.locator('#paint')).toBeVisible();
  const R = await canvasSize(page);
  await touchStroke(page, line([500, 100], [500, 900]));
  await page.locator('[data-act=done]').tap();
  await expect(page.locator('#menu')).toBeVisible({ timeout: 5000 });
  const list = await records(page, [[500, 500]]);
  expect(list).toHaveLength(2);
  for (const d of list) {
    expect(d.lessonId).toBeNull();
    expect(d.keys).toEqual(['color', 'createdAt', 'id', 'lessonId', 'png']);
    expect(d.color).toMatchObject({ w: R, h: R });
    expect(d.color!.px[0][3]).toBe(255);
  }
});

test('no unsaved work: Home leaves at once, from a lesson and from Free draw', async ({ page }) => {
  await page.goto('./#lesson/cat');
  await expect(page.locator('#ink')).toBeVisible();
  await page.locator('#next').tap(); // stepping is not drawing
  await page.locator('#home').tap();
  await expect(page.locator('#menu')).toBeVisible();
  await page.locator('#tofree').tap();
  await expect(page.locator('#paint')).toBeVisible();
  await page.locator('#fhome').tap();
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('.ask')).toHaveCount(0);
});

test('leave dialog: big, separate buttons, none where Home was; a double tap on Home cannot lose work', async ({ page }) => {
  for (const [url, home, canvas] of [['./#lesson/cat', '#home', '#ink'], ['./#draw', '#fhome', '#paint']]) {
    await page.goto(url);
    await expect(page.locator(canvas)).toBeVisible();
    await touchStroke(page, line([100, 500], [900, 500]));
    const n = await ink(page), h = await box(page, home);
    await page.locator(home).tap();
    const btns = await Promise.all((await page.locator('.ask button').all()).map((b) => b.boundingBox() as Promise<Box>));
    expect(btns).toHaveLength(3);
    for (const [i, b] of btns.entries()) {
      expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(64);
      expect(overlap(b, h)).toBe(false);
      for (const c of btns.slice(i + 1)) expect(overlap(b, c)).toBe(false);
    }
    const [no, save, trash] = btns; // save is the biggest
    expect(save.width).toBeGreaterThan(no.width);
    expect(save.width).toBeGreaterThan(trash.width);
    await page.locator('.ask .no').tap();
    // double tap: the second tap lands outside the dialog, which means "keep drawing"
    await page.touchscreen.tap(h.x + h.width / 2, h.y + h.height / 2);
    await page.touchscreen.tap(h.x + h.width / 2, h.y + h.height / 2);
    await expect(page.locator('.ask')).toHaveCount(0);
    expect(await ink(page)).toBe(n);
    expect(await records(page)).toHaveLength(0);
  }
});

test('updateDrawing replaces picture and layers, keeps id, lessonId and createdAt; getDrawing reads one', async ({ page }) => {
  await page.goto('./');
  const r = await page.evaluate(async () => {
    const s = await import('/src/store.ts' as string);
    const blob = (t: string) => new Blob([t], { type: 'image/png' });
    const id = await s.saveDrawing(blob('p1'), 'cat', 1234, { ink: blob('i1'), color: blob('c1') });
    const ok = await s.updateDrawing(id, { png: blob('p22'), ink: blob('i22'), color: blob('c22') });
    const d = await s.getDrawing(id);
    const missing = await s.updateDrawing(99999, { png: blob('x') });
    return { ok, missing, id, d: { id: d.id, lessonId: d.lessonId, createdAt: d.createdAt, png: await d.png.text(), ink: await d.ink.text(), color: await d.color.text() },
      n: (await s.listDrawings()).length, none: await s.getDrawing(99999) };
  });
  expect(r).toEqual({ ok: true, missing: false, id: r.id, n: 1, none: undefined,
    d: { id: r.id, lessonId: 'cat', createdAt: 1234, png: 'p22', ink: 'i22', color: 'c22' } });
});

test('legacy: a database made by the pre-layers code opens intact; its drawings list, view, share, export and delete', async ({ page }) => {
  // Build the database exactly as the code on main did (version 1, same stores, records with only png), before the app opens it.
  await page.goto('./lessons.json');
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const r = indexedDB.open('kids-drawing', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('gallery', { keyPath: 'id', autoIncrement: true });
      r.result.createObjectStore('kv');
    };
    r.onsuccess = async () => {
      const c = new OffscreenCanvas(64, 64), x = c.getContext('2d')!;
      x.fillStyle = '#00aa00';
      x.fillRect(0, 0, 64, 64);
      const png = await c.convertToBlob({ type: 'image/png' });
      const t = r.result.transaction(['gallery', 'kv'], 'readwrite');
      t.objectStore('gallery').add({ lessonId: 'cat', createdAt: Date.parse('2026-03-01T10:00:00'), png });
      t.objectStore('gallery').add({ lessonId: null, createdAt: Date.parse('2026-03-02T10:00:00'), png });
      t.objectStore('kv').put(['cat'], 'completed');
      t.oncomplete = () => { r.result.close(); resolve(); };
      t.onerror = () => reject(t.error);
    };
    r.onerror = () => reject(r.error);
  }));
  await page.goto('./');
  await expect(page.locator('.card[data-id=cat]')).toHaveClass(/done/);
  const list = await records(page, [[500, 500]]);
  expect(list.map((d) => [d.keys, d.ink, d.color, d.png!.px[0]])).toEqual([
    [['createdAt', 'id', 'lessonId', 'png'], null, null, [0, 0xaa, 0, 255]],
    [['createdAt', 'id', 'lessonId', 'png'], null, null, [0, 0xaa, 0, 255]],
  ]);

  // export: flat pictures only, no layers folder
  const hold = async () => { await page.locator('#logo').hover(); await page.mouse.down(); await page.waitForTimeout(3300); await page.mouse.up(); };
  await hold();
  const dl = page.waitForEvent('download');
  await page.locator('#pexport').tap();
  const names = Object.keys(unzipSync(new Uint8Array(await (await fs()).readFile((await (await dl).path())!)))).sort();
  expect(names).toEqual([expect.stringMatching(/^2026-03-01_10-00-00_cat_\d+\.png$/), expect.stringMatching(/^2026-03-02_10-00-00_free_\d+\.png$/)]);
  await page.locator('#pclose').tap();

  await page.goto('./#gallery');
  await expect(page.locator('.pic')).toHaveCount(2);
  await page.locator('.pic').last().tap();
  await expect(page.locator('#vimg')).toHaveAttribute('src', /^blob:/);
  const share = page.waitForEvent('download');
  await page.locator('#vbar .share').tap();
  expect((await share).suggestedFilename()).toMatch(/_cat_\d+\.png$/);
  await page.locator('#vbar .del').tap();
  await page.locator('.ask .yes').tap();
  await expect(page.locator('.pic')).toHaveCount(1);
  expect((await records(page)).map((d) => d.lessonId)).toEqual([null]);
});

test('zip: flat pictures plus layers/; round trip restores layers; an old flat-only zip still imports', async ({ page }) => {
  // one lesson drawing (ink + colour), one free drawing (colour), one legacy record (no layers)
  await toColor(page, () => touchStroke(page, circle(500, 500, 250)));
  await fillAt(page, [500, 500]);
  await page.locator('[data-act=done]').tap();
  await expect(page.locator('#menu')).toBeVisible({ timeout: 5000 });
  await page.goto('./#draw');
  await expect(page.locator('#paint')).toBeVisible();
  await touchStroke(page, line([100, 500], [900, 500]));
  await page.locator('#fhome').tap();
  await page.locator('.ask .save').tap();
  await expect(page.locator('#menu')).toBeVisible();
  await page.evaluate(async () => {
    const c = new OffscreenCanvas(64, 64), x = c.getContext('2d')!;
    x.fillRect(0, 0, 64, 64);
    await (await import('/src/store.ts' as string)).saveDrawing(await c.convertToBlob({ type: 'image/png' }), 'fish', Date.parse('2026-01-01T09:00:00'));
  });
  const before = await records(page);
  const sig = (l: Rec[]) => [...l].sort((a, b) => b.createdAt - a.createdAt).map((d) => ({ lessonId: d.lessonId, createdAt: Math.floor(d.createdAt / 1000), png: d.png!.size, ink: d.ink?.size, color: d.color?.size }));
  expect(sig(before).map((d) => [d.lessonId, !!d.ink, !!d.color])).toEqual([[null, false, true], ['cat', true, true], ['fish', false, false]]);

  await page.locator('#logo').hover(); await page.mouse.down(); await page.waitForTimeout(3300); await page.mouse.up();
  const dl = page.waitForEvent('download');
  await page.locator('#pexport').tap();
  const path = (await (await dl).path())!;
  const entries = unzipSync(new Uint8Array(await (await fs()).readFile(path)));
  const names = Object.keys(entries).sort();
  const flat = names.filter((n) => !n.includes('/'));
  expect(flat).toHaveLength(3);
  const base = (re: RegExp) => flat.find((n) => re.test(n))!.replace(/\.png$/, '');
  const catName = base(/_cat_/), freeName = base(/_free_/);
  expect(names.filter((n) => n.includes('/')).sort()).toEqual(
    [`layers/${catName}.color.png`, `layers/${catName}.ink.png`, `layers/${freeName}.color.png`].sort());

  await page.evaluate(async () => {
    const s = await import('/src/store.ts' as string);
    for (const d of await s.listDrawings()) await s.deleteDrawing(d.id);
  });
  expect(await records(page)).toHaveLength(0);
  await page.locator('#pimport').setInputFiles(path);
  await expect(page.locator('#pstatus')).toContainText('Added 3');
  expect(sig(await records(page))).toEqual(sig(before)); // byte-identical blobs (zip level 0), layers back on the right drawings

  // An old-format zip: flat pictures only.
  await page.evaluate(async () => {
    const s = await import('/src/store.ts' as string);
    for (const d of await s.listDrawings()) await s.deleteDrawing(d.id);
  });
  const old = zipSync(Object.fromEntries(flat.map((n) => [n, entries[n]])), { level: 0 });
  await page.locator('#pimport').setInputFiles({ name: 'old.zip', mimeType: 'application/zip', buffer: (await import('node:buffer' as string)).Buffer.from(old) });
  await expect(page.locator('#pstatus')).toContainText('Added 3');
  const imported = await records(page);
  expect(imported.map((d) => [d.lessonId, d.ink, d.color])).toEqual([[null, null, null], ['cat', null, null], ['fish', null, null]]);
});
