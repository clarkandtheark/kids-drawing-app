// The Library (the lesson grid, home before the path), Free draw, My Drawings, parent area. The path home screen is pathhome.spec.ts.
import { test, expect, type Page } from '@playwright/test';

import { unzipSync } from 'fflate';
import { lessons, line, touchStroke } from './helpers';

let errors: string[];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true, value: { speak() {}, cancel() {}, getVoices: () => [] },
    });
    // Never open a real share sheet; tests that want sharing stub it themselves.
    (navigator as any).canShare = () => false;
  });
});
test.afterEach(() => expect(errors).toEqual([]));

/** Save solid-colour PNGs to the gallery, oldest first: [colour, lessonId, createdAt]. */
const seed = (page: Page, items: [string, string | null, number][]) => page.evaluate(async (items) => {
  const { saveDrawing } = await import('/src/store.ts' as string);
  for (const [color, lessonId, at] of items) {
    const c = new OffscreenCanvas(64, 64), x = c.getContext('2d')!;
    x.fillStyle = color;
    x.fillRect(0, 0, 64, 64);
    await saveDrawing(await c.convertToBlob({ type: 'image/png' }), lessonId, at);
  }
}, items);
const stored = (page: Page): Promise<{ lessonId: string | null; createdAt: number; type: string }[]> => page.evaluate(async () => {
  const { listDrawings } = await import('/src/store.ts' as string);
  return (await listDrawings()).map((d: any) => ({ lessonId: d.lessonId, createdAt: d.createdAt, type: d.png.type }));
});
const holdLogo = async (page: Page, ms: number) => {
  await page.locator('#logo').hover();
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
};
const openParent = async (page: Page) => { await holdLogo(page, 3300); await expect(page.locator('#parent')).toBeVisible(); };

test('Library: a card per lesson, three level sections, every target at least 64px', async ({ page }) => {
  await page.goto('./#library');
  const all = await lessons(page);
  await expect(page.locator('.card')).toHaveCount(all.length);
  await expect(page.locator('section.level[data-level]')).toHaveCount(3);
  for (const n of [1, 2, 3]) {
    const sec = page.locator(`section.level[data-level="${n}"]`);
    await expect(sec.locator('.card')).toHaveCount(all.filter((l) => l.difficulty === n && !l.category).length);
    await expect(sec.locator('.lvl svg')).toHaveCount(n); // crayons, not stars: stars are her scores
  }
  await expect(page.locator('.card[data-id=cat]')).not.toHaveClass(/done/);
  for (const el of await page.locator('#menu a:visible, #menu button:visible').all()) {
    const r = (await el.boundingBox())!;
    expect(r.width).toBeGreaterThanOrEqual(64);
    expect(r.height).toBeGreaterThanOrEqual(64);
  }
});

test('Library scrolls by touch; pinch and the drawing screens stay blocked', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 500 }); // short enough that even a few lessons overflow
  await page.goto('./#library');
  await expect(page.locator('.card').first()).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', y: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: 512, y, id: 1 }] });
  await touch('touchStart', 400);
  for (let y = 380; y >= 100; y -= 20) await touch('touchMove', y);
  await touch('touchEnd', 100);
  await expect.poll(() => page.locator('#menu').evaluate((e) => e.scrollTop)).toBeGreaterThan(50);

  // What the document does with raw touchmoves: one finger in a scroll container passes, everything else is stopped.
  const prevented = (page: Page, sel: string, fingers: number) => page.evaluate(([sel, fingers]) => {
    const t = document.querySelector(sel as string)!;
    const touches = Array.from({ length: fingers as number }, (_, i) => new Touch({ identifier: i, target: t, clientX: 10 + i, clientY: 10 }));
    const e = new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches, targetTouches: touches, changedTouches: touches });
    t.dispatchEvent(e);
    return e.defaultPrevented;
  }, [sel, fingers] as const);
  expect(await prevented(page, '.card', 1)).toBe(false);
  expect(await prevented(page, '.card', 2)).toBe(true);
  await page.goto('./#draw');
  await expect(page.locator('#paint')).toBeVisible();
  expect(await prevented(page, '#paint', 1)).toBe(true);
  expect(await prevented(page, '#fhome', 1)).toBe(true);
  await page.goto('./#lesson/cat');
  await expect(page.locator('#sheet')).toBeVisible();
  expect(await prevented(page, '#sheet', 1)).toBe(true);
});

test('Free draw and My Drawings buttons navigate, home buttons return', async ({ page }) => {
  await page.goto('./');
  await page.locator('#tofree').tap();
  await expect(page).toHaveURL(/#draw$/);
  await expect(page.locator('#free')).toBeVisible();
  await expect(page.locator('#path')).toBeHidden();
  await page.locator('#fhome').tap();
  await expect(page.locator('#path')).toBeVisible();
  await expect(page.locator('#free')).toBeHidden();
  await expect(page.locator('#paint')).toHaveCount(0); // the canvas is released
  await page.locator('#togallery').tap();
  await expect(page).toHaveURL(/#gallery$/);
  await expect(page.locator('#gallery')).toBeVisible();
  await page.locator('#ghome').tap();
  await expect(page.locator('#path')).toBeVisible();
  await expect(page.locator('#gallery')).toBeHidden();
});

test('free draw: every control is 64px+, paint, Done saves a drawing with no lesson', async ({ page }) => {
  await page.goto('./#draw');
  await expect(page.locator('#paint')).toBeVisible();
  const narrow = page.viewportSize()!.width < 700;
  for (const b of await page.locator('#free button:visible').all()) {
    const r = (await b.boundingBox())!;
    expect(r.width).toBeGreaterThanOrEqual(narrow && await b.evaluate((e) => e.matches('.crayon')) ? 56 : 64); // phone crayons: 56px+ (#29)
    expect(r.height).toBeGreaterThanOrEqual(64);
  }
  expect(await stored(page)).toHaveLength(0);
  await touchStroke(page, line([100, 500], [900, 500]));
  await page.locator('[data-act=done]').tap();
  await expect(page.locator('.party')).toBeVisible();
  await expect(page.locator('#path')).toBeVisible({ timeout: 5000 });
  const list = await stored(page);
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ lessonId: null, type: 'image/png' });
});

test('free draw: home with paint asks; trash discards', async ({ page }) => {
  await page.goto('./#draw');
  await expect(page.locator('#paint')).toBeVisible();
  await touchStroke(page, line([100, 500], [900, 500]));
  await page.locator('#fhome').tap();
  await page.locator('.ask .yes').tap();
  await expect(page.locator('#path')).toBeVisible();
  await expect(page.locator('#paint')).toHaveCount(0);
  expect(await stored(page)).toHaveLength(0);
});

test('gallery: newest first, open full-screen, delete asks first, empty state', async ({ page }) => {
  await page.goto('./');
  await seed(page, [['#ff0000', 'cat', 1000], ['#0000ff', null, 2000]]);
  await page.goto('./#gallery');
  await expect(page.locator('.pic')).toHaveCount(2);
  const colors = await page.locator('.pic img').evaluateAll((imgs) => Promise.all(imgs.map(async (i) => {
    const b = await createImageBitmap(await (await fetch((i as HTMLImageElement).src)).blob());
    const x = new OffscreenCanvas(1, 1).getContext('2d')!;
    x.drawImage(b, 0, 0);
    return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3);
  })));
  expect(colors).toEqual([[0, 0, 255], [255, 0, 0]]); // saved last = shown first
  for (const el of await page.locator('#gallery button:visible, #gallery a:visible').all()) {
    const r = (await el.boundingBox())!;
    expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(64);
  }

  await page.locator('.pic').first().tap();
  await expect(page.locator('#view')).toBeVisible();
  await expect(page.locator('#vimg')).toHaveAttribute('src', /^blob:/);
  for (const b of await page.locator('#vbar button').all()) {
    const r = (await b.boundingBox())!;
    expect(r.width).toBeGreaterThanOrEqual(64);
    expect(r.height).toBeGreaterThanOrEqual(64);
  }
  await page.locator('#vbar .del').tap(); // cancel keeps it
  await expect(page.locator('.ask')).toBeVisible();
  await page.locator('.ask .no').tap();
  await expect(page.locator('.ask')).toHaveCount(0);
  await expect(page.locator('.pic')).toHaveCount(2);
  expect(await stored(page)).toHaveLength(2);
  await page.locator('#vbar .del').tap(); // confirm removes it
  await page.locator('.ask .yes').tap();
  await expect(page.locator('#view')).toBeHidden();
  await expect(page.locator('.pic')).toHaveCount(1);
  expect(await stored(page)).toMatchObject([{ lessonId: 'cat' }]);

  await page.locator('.pic').tap(); // back
  await page.locator('#vbar .back').tap();
  await expect(page.locator('#view')).toBeHidden();
  await page.locator('.pic').tap();
  await page.locator('#vbar .del').tap();
  await page.locator('.ask .yes').tap();
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('#grid')).toBeHidden();
});

test('gallery: share passes a PNG file to navigator.share; without file sharing it downloads', async ({ page }) => {
  await page.goto('./');
  await seed(page, [['#00aa00', 'cat', 1000]]);
  await page.goto('./#gallery');
  await page.locator('.pic').tap();
  // No file sharing: download fallback.
  const dl = page.waitForEvent('download');
  await page.locator('#vbar .share').tap();
  expect((await dl).suggestedFilename()).toMatch(/_cat_\d+\.png$/);
  // File sharing available: the share sheet gets one PNG File.
  await page.evaluate(() => {
    (navigator as any).canShare = (d: any) => !!d.files?.length;
    (navigator as any).share = async (d: any) => { (window as any).__shared = d.files.map((f: File) => ({ name: f.name, type: f.type, size: f.size })); };
  });
  await page.locator('#vbar .share').tap();
  const shared = await page.evaluate(() => (window as any).__shared);
  expect(shared).toHaveLength(1);
  expect(shared[0]).toMatchObject({ type: 'image/png' });
  expect(shared[0].name).toMatch(/^\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d_cat_\d+\.png$/);
  expect(shared[0].size).toBeGreaterThan(50);
});

test('parent area: a short tap on the logo does nothing, a 3s hold opens it', async ({ page }) => {
  await page.goto('./');
  await page.locator('#logo').tap();
  await page.waitForTimeout(3400);
  await expect(page.locator('#parent')).toBeHidden();
  await holdLogo(page, 1500); // let go early: nothing
  await page.waitForTimeout(2000);
  await expect(page.locator('#parent')).toBeHidden();
  await page.locator('#logo').hover();
  await page.mouse.down();
  await page.waitForTimeout(1000);
  await expect(page.locator('#logo')).toHaveClass(/holding/); // the progress ring is running
  await page.mouse.move(400, 900); // drifting away cancels
  await expect(page.locator('#logo')).not.toHaveClass(/holding/);
  await page.mouse.up();
  await openParent(page);
  await page.locator('#pclose').tap();
  await expect(page.locator('#parent')).toBeHidden();
});

test('parent area: voice toggle drives muted()', async ({ page }) => {
  await page.goto('./');
  await openParent(page);
  const muted = () => page.evaluate(async () => (await import('/src/speech.ts' as string)).muted());
  expect(await muted()).toBe(false);
  await page.locator('#pvoice').tap();
  expect(await muted()).toBe(true);
  await expect(page.locator('#pvoice')).toHaveAttribute('aria-checked', 'false');
  await page.locator('#pvoice').tap();
  expect(await muted()).toBe(false);
});

test('parent area: reset progress removes stars only, after asking', async ({ page }) => {
  await page.goto('./');
  await seed(page, [['#ff0000', 'cat', 1000]]);
  await page.evaluate(async () => (await import('/src/store.ts' as string)).markCompleted('cat'));
  await page.goto('./#library');
  await page.reload();
  await expect(page.locator('.card[data-id=cat]')).toHaveClass(/done/);
  await page.locator('#lhome').tap(); // to the path (the logo), same page: the Library's cards stay, hidden
  await openParent(page);
  await page.locator('#preset').tap();
  await page.locator('.ask .no').tap();
  await expect(page.locator('.card[data-id=cat]')).toHaveClass(/done/);
  await page.locator('#preset').tap();
  await page.locator('.ask .yes').tap();
  await expect(page.locator('.card.done')).toHaveCount(0);
  await page.locator('#pclose').tap();
  await page.locator('#tolibrary').tap();
  await expect(page.locator('.card[data-id=cat]')).toBeVisible();
  await expect(page.locator('.card.done')).toHaveCount(0);
  expect(await stored(page)).toHaveLength(1);
});

test('parent area: export a zip of PNGs, import it into an empty gallery', async ({ page }) => {
  await page.goto('./');
  await seed(page, [['#ff0000', 'cat', Date.parse('2026-03-01T10:00:00')], ['#0000ff', null, Date.parse('2026-03-02T11:30:15')]]);
  await openParent(page);
  const dl = page.waitForEvent('download');
  await page.locator('#pexport').tap();
  const download = await dl;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  const path = (await download.path())!;
  const entries = Object.entries(unzipSync(new Uint8Array(await (await import('node:fs/promises' as string)).readFile(path))));
  expect(entries.map(([n]) => n).sort()).toEqual([
    expect.stringMatching(/^2026-03-01_10-00-00_cat_\d+\.png$/),
    expect.stringMatching(/^2026-03-02_11-30-15_free_\d+\.png$/),
  ]);
  for (const [, b] of entries) expect([...b.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  await page.evaluate(async () => {
    const s = await import('/src/store.ts' as string);
    for (const d of await s.listDrawings()) await s.deleteDrawing(d.id);
  });
  expect(await stored(page)).toHaveLength(0);
  await page.locator('#pimport').setInputFiles(path);
  await expect(page.locator('#pstatus')).toContainText('Added 2');
  const list = await stored(page); // newest first, dates and lessons restored
  expect(list.map((d: any) => d.lessonId)).toEqual([null, 'cat']);
  expect(list.map((d: any) => d.createdAt)).toEqual([Date.parse('2026-03-02T11:30:15'), Date.parse('2026-03-01T10:00:00')]);
  await page.locator('#pimport').setInputFiles({ name: 'x.zip', mimeType: 'application/zip', buffer: (await import('node:buffer' as string)).Buffer.from('not a zip') });
  await expect(page.locator('#pstatus')).toContainText('not a drawings zip');
  expect(await stored(page)).toHaveLength(2);
});

test('home, free draw, gallery and parent review screenshots', async ({ page }, info) => {
  const name = (s: string) => `review/home-${s}-${info.project.name}.png`;
  await page.goto('./');
  await seed(page, [['#ffd21f', 'cat', 1000], ['#4cc3ff', null, 2000]]);
  await page.evaluate(async () => (await import('/src/store.ts' as string)).markCompleted('cat'));
  await page.goto('./#library');
  await page.reload();
  await expect(page.locator('.card[data-id=cat]')).toHaveClass(/done/);
  await page.screenshot({ path: name('library') });
  await page.goto('./#draw');
  await expect(page.locator('#paint')).toBeVisible();
  await touchStroke(page, line([150, 300], [850, 700]));
  await page.screenshot({ path: name('draw') });
  await page.goto('./#gallery');
  await expect(page.locator('.pic')).toHaveCount(2);
  await page.screenshot({ path: name('gallery') });
  await page.locator('.pic').first().tap();
  await page.screenshot({ path: name('view') });
  await page.goto('./');
  await openParent(page);
  await page.screenshot({ path: name('parent') });
  await page.evaluate(async () => {
    const s = await import('/src/store.ts' as string);
    for (const d of await s.listDrawings()) await s.deleteDrawing(d.id);
  });
  await page.goto('./#gallery');
  await expect(page.locator('#empty')).toBeVisible();
  await page.screenshot({ path: name('empty') });
});
