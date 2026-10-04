// Color mode, fill bucket, clear, Done → celebration → gallery + progress (IndexedDB).
import { test, expect, type Page } from '@playwright/test';
import { ink, line, toClient, touchStroke, type P } from './helpers';
import cat from '../lessons/cat.json' with { type: 'json' };

let errors: string[];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    const said: string[] = ((window as any).__said = []);
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { speak: (u: SpeechSynthesisUtterance) => said.push(u.text), cancel() {}, getVoices: () => [] },
    });
  });
});
test.afterEach(() => expect(errors).toEqual([]));

const circle = (cx: number, cy: number, r: number, n = 72): P[] =>
  Array.from({ length: n + 3 }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)]);

/** Open the cat lesson, run `draw` (ink) on the first step, then check through to Color mode. */
async function toColor(page: Page, draw = async () => {}) {
  await page.goto('./#lesson/cat');
  await expect(page.locator('#ink')).toBeVisible();
  await draw();
  for (let i = 0; i < cat.steps.length; i++) await page.locator('#next').tap();
  await expect(page.locator('#lesson')).toHaveAttribute('data-phase', 'color');
}

/** Colour-canvas pixels [r,g,b,a] at logical points. */
const colorAt = (page: Page, pts: P[]) => page.evaluate((pts) => {
  const c = document.querySelector<HTMLCanvasElement>('#color')!, k = c.width / 1000;
  return pts.map(([x, y]) => [...c.getContext('2d')!.getImageData(Math.floor(x * k), Math.floor(y * k), 1, 1).data]);
}, pts);
/** Count coloured pixels (alpha > 0) on the colour canvas in a logical rect. */
const colored = (page: Page, [x0, y0, x1, y1] = [0, 0, 1000, 1000]) => page.evaluate(([x0, y0, x1, y1]) => {
  const c = document.querySelector<HTMLCanvasElement>('#color')!, k = c.width / 1000;
  const d = c.getContext('2d')!.getImageData(x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n;
}, [x0, y0, x1, y1]);
/** Sum of every ink pixel byte: changes if any ink pixel changes. */
const inkSum = (page: Page) => page.evaluate(() => {
  const c = document.querySelector<HTMLCanvasElement>('#ink')!;
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let s = 0;
  for (let i = 0; i < d.length; i++) s += d[i] * ((i % 7) + 1);
  return s;
});
/** Tap the colour canvas with the fill tool selected; returns how long the (synchronous) fill took in ms. */
async function fillAt(page: Page, p: P) {
  const [[clientX, clientY]] = await toClient(page, [p]);
  return page.evaluate(({ clientX, clientY }) => {
    const t = performance.now();
    document.querySelector('#color')!.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, clientX, clientY, buttons: 1,
    }));
    document.querySelector('#color')!.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, pointerType: 'touch', bubbles: true, clientX, clientY }));
    return performance.now() - t;
  }, { clientX, clientY });
}

type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('last checkmark enters Color mode: guide hidden, 12 crayons, every tool big and clear of the canvas', async ({ page }) => {
  await toColor(page);
  await expect(page.locator('#guide')).toBeHidden();
  await expect(page.locator('#next')).toBeHidden();
  await expect(page.locator('.crayon')).toHaveCount(12);
  await expect(page.locator('.crayon[aria-pressed=true]')).toHaveCount(1);
  expect((await page.evaluate(() => (window as any).__said)).at(-1)).toMatch(/color/i);
  const sheet = (await page.locator('#sheet').boundingBox())!;
  const vp = page.viewportSize()!;
  expect(Math.min(sheet.width, sheet.height)).toBeGreaterThan(Math.min(vp.width, vp.height) * 0.9);
  const buttons = await page.locator('#lesson button:visible').all();
  expect(buttons.length).toBe(12 + 3 + 2 + 2 + 1 + 2); // crayons, sizes, eraser+fill, undo+clear, done, home+mute
  for (const b of buttons) {
    const r = (await b.boundingBox())!;
    const name = await b.getAttribute('aria-label') ?? '';
    expect(r.width, name).toBeGreaterThanOrEqual(64);
    expect(r.height, name).toBeGreaterThanOrEqual(64);
    expect(overlap(r, sheet), name).toBe(false);
    expect(r.x >= 0 && r.y >= 0 && r.x + r.width <= vp.width && r.y + r.height <= vp.height, name).toBe(true);
  }
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight)).toBe(true);
});

test('brush paints the colour canvas under the ink; eraser removes colour and leaves ink', async ({ page }) => {
  await toColor(page, () => touchStroke(page, line([100, 500], [900, 500])));
  const inkBefore = await inkSum(page), inkPx = await ink(page);
  expect(inkPx).toBeGreaterThan(0);
  await page.locator('.crayon[aria-label=blue]').tap();
  await touchStroke(page, line([500, 100], [500, 900]));
  expect(await colored(page, [480, 100, 520, 900])).toBeGreaterThan(10000);
  expect((await colorAt(page, [[500, 300]]))[0]).toEqual([0x2f, 0x5b, 0xea, 255]);
  expect(await inkSum(page)).toBe(inkBefore);
  await page.locator('[data-tool=eraser]').tap();
  await page.locator('[data-size="80"]').tap(); // stays the eraser, just fatter
  await expect(page.locator('[data-tool=eraser]')).toHaveAttribute('aria-pressed', 'true');
  await touchStroke(page, line([500, 80], [500, 920], 24));
  expect(await colored(page)).toBe(0);
  expect(await inkSum(page)).toBe(inkBefore);
});

test('fill: inside a closed ink shape, no ring at the edge, one undo; outside; no-op refill; fast at 2048', async ({ page }) => {
  await toColor(page, () => touchStroke(page, circle(500, 500, 250)));
  expect(await page.evaluate(() => document.querySelector<HTMLCanvasElement>('#color')!.width)).toBe(2048);
  await page.locator('.crayon[aria-label=green]').tap();
  await page.locator('[data-tool=fill]').tap();
  const ms = await fillAt(page, [500, 500]);
  console.log(`fill inside at 2048: ${ms.toFixed(1)} ms`);
  expect(ms).toBeLessThan(1000);
  const green = [0x43, 0xc0, 0x4f, 255];
  const [inside, outside] = await colorAt(page, [[500, 500], [100, 100]]);
  expect(inside).toEqual(green);
  expect(outside[3]).toBe(0);
  // Walk right from the centre (canvas px): every pixel before the ink's solid core must be fully coloured,
  // so no white shows through the line's soft edge. Past the line, nothing is coloured.
  const ring = await page.evaluate(() => {
    const k = 2048 / 1000, y = Math.round(500 * k), x0 = Math.round(500 * k), w = Math.round(400 * k);
    const c = document.querySelector<HTMLCanvasElement>('#color')!.getContext('2d')!.getImageData(x0, y, w, 1).data;
    const i = document.querySelector<HTMLCanvasElement>('#ink')!.getContext('2d')!.getImageData(x0, y, w, 1).data;
    let x = 0, gaps = 0, soft = 0;
    for (; x < w && i[x * 4 + 3] < 255; x++) { if (i[x * 4 + 3] > 0) soft++; if (c[x * 4 + 3] < 255) gaps++; }
    let lineEnd = x;
    while (lineEnd < w && i[lineEnd * 4 + 3] > 0) lineEnd++;
    let leaked = 0;
    for (let j = lineEnd + 3; j < w; j++) if (c[j * 4 + 3] > 0) leaked++;
    return { reached: x < w, soft, gaps, leaked };
  });
  expect(ring).toEqual({ reached: true, soft: expect.any(Number), gaps: 0, leaked: 0 });
  expect(ring.soft).toBeGreaterThan(0); // the line really has an anti-aliased edge to cover

  expect(await fillAt(page, [500, 500])).toBeGreaterThanOrEqual(0); // same colour again: a no-op, not an undo step
  await page.locator('[data-act=undo]').tap();
  await expect.poll(() => colored(page)).toBe(0); // one undo removed the whole fill

  await fillAt(page, [40, 40]);
  const [out, corner, middle] = await colorAt(page, [[40, 40], [960, 960], [500, 500]]);
  expect(out).toEqual(green);
  expect(corner).toEqual(green);
  expect(middle[3]).toBe(0);
});

test('clear asks first: back keeps everything, trash clears colour only, undo brings it back', async ({ page }) => {
  await toColor(page, () => touchStroke(page, line([100, 500], [900, 500])));
  const inkBefore = await inkSum(page);
  await touchStroke(page, line([500, 100], [500, 900]));
  const n = await colored(page);
  expect(n).toBeGreaterThan(0);
  await page.locator('[data-act=clear]').tap();
  await expect(page.locator('.ask')).toBeVisible();
  await page.locator('.ask .no').tap();
  await expect(page.locator('.ask')).toHaveCount(0);
  expect(await colored(page)).toBe(n);
  await page.locator('[data-act=clear]').tap();
  await page.locator('.ask .yes').tap();
  await expect(page.locator('.ask')).toHaveCount(0);
  expect(await colored(page)).toBe(0);
  expect(await inkSum(page)).toBe(inkBefore);
  await page.locator('[data-act=undo]').tap();
  await expect.poll(() => colored(page)).toBe(n);
});

test('done: celebration, picker, then after reload the gallery has the drawing, the lesson a star, mute persists', async ({ page }, info) => {
  await toColor(page, () => touchStroke(page, circle(500, 500, 250)));
  await page.locator('[data-tool=fill]').tap();
  await fillAt(page, [500, 500]);
  await page.locator('[data-act=done]').tap();
  await expect(page.locator('.party')).toBeVisible();
  expect((await page.evaluate(() => (window as any).__said)).at(-1)).toMatch(/!/);
  await expect(page.locator('#menu')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.party')).toHaveCount(0);
  await expect(page.locator('.card[data-id=cat]')).toHaveClass(/done/);
  await expect(page.locator('.card[data-id=fish]')).not.toHaveClass(/done/);

  await page.reload();
  await expect(page.locator('.card[data-id=cat]')).toHaveClass(/done/);
  const saved = await page.evaluate(async () => {
    const { listDrawings } = await import('/src/store.ts' as string);
    const list = await listDrawings();
    const b = await createImageBitmap(list[0].png);
    const c = new OffscreenCanvas(b.width, b.height), x = c.getContext('2d')!;
    x.drawImage(b, 0, 0);
    const d = x.getImageData(0, 0, b.width, b.height).data;
    let nonWhite = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250) nonWhite++;
    const bytes = new Uint8Array(await list[0].png.arrayBuffer());
    return { n: list.length, lessonId: list[0].lessonId, type: list[0].png.type, w: b.width, h: b.height, nonWhite,
      centre: [...x.getImageData(512, 512, 1, 1).data], corner: [...x.getImageData(20, 20, 1, 1).data],
      b64: btoa(Array.from(bytes, (c) => String.fromCharCode(c)).join('')) };
  });
  expect(saved).toMatchObject({ n: 1, lessonId: 'cat', type: 'image/png', w: 1024, h: 1024 });
  expect(saved.nonWhite).toBeGreaterThan(100000);
  expect(saved.centre).toEqual([0xe8, 0x40, 0x2a, 255]); // the default red fill
  expect(saved.corner).toEqual([255, 255, 255, 255]); // white background, not transparent
  if (info.project.name === 'portrait') { // for eyeballing; the project has no node typings, hence untyped
    const fs = await import('node:fs/promises' as string);
    await fs.writeFile('review/saved-drawing.png', Uint8Array.from(atob(saved.b64), (c) => c.charCodeAt(0)));
  }

  await page.locator('.card[data-id=cat]').tap();
  await page.locator('#mute').tap();
  await page.reload();
  await expect(page.locator('#mute')).toHaveAttribute('aria-pressed', 'true');
});

test('color review screenshots', async ({ page }, info) => {
  const name = (s: string) => `review/color-${s}-${info.project.name}.png`;
  // Trace the whole cat as her ink: sample every lesson stroke into touch points.
  const strokes = await page.evaluate((ds) => ds.map((d) => {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    const L = p.getTotalLength(), n = Math.max(4, Math.ceil(L / 12));
    return Array.from({ length: n + 1 }, (_, i) => { const q = p.getPointAtLength((L * i) / n); return [q.x, q.y] as P; });
  }), cat.steps.flatMap((s) => s.strokes));
  await toColor(page, async () => { for (const s of strokes) await touchStroke(page, s); });
  const pick = (c: string) => page.locator(`.crayon[aria-label="${c}"]`).tap();
  await page.locator('[data-tool=fill]').tap();
  await pick('orange'); await fillAt(page, [500, 250]); // head
  await fillAt(page, [500, 700]); // body
  await pick('pink'); await fillAt(page, [330, 140]); await fillAt(page, [670, 140]); // ears
  await pick('sky blue'); await fillAt(page, [60, 60]); // background
  await pick('brown'); await page.locator('[data-size="40"]').tap(); // back to the brush: stripes
  await touchStroke(page, line([440, 600], [560, 600]));
  await touchStroke(page, line([430, 680], [570, 680]));
  await page.screenshot({ path: name('mode') });
  await page.locator('[data-act=clear]').tap();
  await page.screenshot({ path: name('clear') });
  await page.locator('.ask .no').tap();
  await page.locator('[data-act=done]').tap();
  await page.waitForTimeout(700);
  await page.screenshot({ path: name('party') });
  await expect(page.locator('#menu')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.card[data-id=cat]')).toHaveClass(/done/);
  await page.screenshot({ path: name('picker') });
});
