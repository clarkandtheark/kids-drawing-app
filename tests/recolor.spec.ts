// Colour a saved drawing again (#23): the viewer's colour button, the re-colour screen, replace / keep both.
import { test, expect, type Page } from '@playwright/test';
import { line, toClient, touchStroke, type P } from './helpers';
import cat from '../lessons/cat.json' with { type: 'json' };

let errors: string[];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak() {}, cancel() {}, getVoices: () => [] } });
    (navigator as any).canShare = () => false;
  });
});
test.afterEach(() => expect(errors).toEqual([]));

const circle = (cx: number, cy: number, r: number, n = 72): P[] =>
  Array.from({ length: n + 3 }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)]);
const RED = [0xe8, 0x40, 0x2a, 255], BLUE = [0x2f, 0x5b, 0xea, 255];
const IN = [500, 500] as P, ON = [750, 500] as P, OUT = [60, 60] as P; // centre of the circle, on its line, far outside

type Rec = { id: number; lessonId: string | null; createdAt: number; keys: string[]; png: string; ink?: string; color?: string };
/** Every record, newest first; each image as a digest of its bytes (equal digest = byte-identical). */
const records = (page: Page): Promise<Rec[]> => page.evaluate(async () => {
  const { listDrawings } = await import('/src/store.ts' as string);
  const dig = async (b?: Blob) => {
    if (!b) return undefined;
    let h = 2166136261;
    for (const v of new Uint8Array(await b.arrayBuffer())) h = Math.imul(h ^ v, 16777619) >>> 0;
    return `${b.size}:${h}`;
  };
  return Promise.all((await listDrawings()).map(async (d: any) => ({
    id: d.id, lessonId: d.lessonId, createdAt: d.createdAt, keys: Object.keys(d).sort(),
    png: await dig(d.png), ink: await dig(d.ink), color: await dig(d.color),
  })));
});
/** Digest of a canvas on screen (#color, #ink or #paint). */
const digest = (page: Page, sel: string) => page.evaluate((sel) => {
  const c = document.querySelector<HTMLCanvasElement>(sel)!;
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let h = 2166136261;
  for (let i = 0; i < d.length; i += 7) h = Math.imul(h ^ d[i] ^ (d[i + 3] << 8), 16777619) >>> 0;
  return h;
}, sel);
const pixel = (page: Page, sel: string, [x, y]: P) => page.evaluate(([sel, x, y]) => {
  const c = document.querySelector<HTMLCanvasElement>(sel as string)!, k = c.width / 1000;
  return [...c.getContext('2d')!.getImageData(Math.floor((x as number) * k), Math.floor((y as number) * k), 1, 1).data];
}, [sel, x, y]);

async function fillAt(page: Page, p: P, color?: string) {
  if (color) await page.locator(`[data-color="${color}"]`).tap();
  await page.locator('[data-tool=fill]').tap();
  const [[x, y]] = await toClient(page, [p]);
  await page.touchscreen.tap(x, y);
  await page.locator('[data-tool=fill]').tap(); // back to the brush
}

/** A lesson drawing made the real way: a circle of ink, optionally filled red, Done. */
async function lessonDrawing(page: Page, fill = true) {
  await page.goto('./#lesson/cat');
  await expect(page.locator('#ink')).toBeVisible();
  await touchStroke(page, circle(500, 500, 250));
  for (let i = 0; i < cat.steps.length; i++) await page.locator('#next').tap();
  await page.locator('.result .go').tap(); // the result card (#21) sits between tracing and Color mode
  await expect(page.locator('#lesson')).toHaveAttribute('data-phase', 'color');
  if (fill) await fillAt(page, IN);
  await page.locator('[data-act=done]').tap();
  await expect(page.locator('#menu')).toBeVisible({ timeout: 5000 });
}
/** A Free draw drawing: one horizontal stroke, saved through Home. */
async function freeDrawing(page: Page) {
  await page.goto('./#draw');
  await expect(page.locator('#paint')).toBeVisible();
  await touchStroke(page, line([100, 500], [900, 500]));
  await page.locator('#fhome').tap();
  await page.locator('.ask .save').tap();
  await expect(page.locator('#menu')).toBeVisible();
}
/** A drawing from before layers existed: a flat 1024px picture, a black line on a green square. */
async function legacyDrawing(page: Page) {
  await page.goto('./');
  await page.evaluate(async () => {
    const c = new OffscreenCanvas(1024, 1024), x = c.getContext('2d')!;
    x.fillStyle = '#fff'; x.fillRect(0, 0, 1024, 1024);
    x.fillStyle = '#00aa00'; x.fillRect(100, 100, 400, 400);
    x.fillStyle = '#000'; x.fillRect(100, 700, 800, 12);
    await (await import('/src/store.ts' as string)).saveDrawing(await c.convertToBlob({ type: 'image/png' }), 'fish', Date.parse('2026-01-01T09:00:00'));
  });
}

/** From the gallery, open the newest drawing and tap its colour button. */
async function openColor(page: Page) {
  await page.goto('./#gallery');
  await page.locator('.pic').first().tap();
  await page.locator('#vbar .color').tap();
  await expect(page.locator('#free')).toBeVisible();
  await expect(page.locator('#fsheet canvas').first()).toBeVisible();
}
const ask = (page: Page) => page.locator('.ask');
const settle = () => new Promise((r) => setTimeout(r, 300));

test('the viewer has a big colour button; it opens her lines and her colour, other screens hidden', async ({ page }) => {
  await lessonDrawing(page);
  await page.goto('./#gallery');
  await page.locator('.pic').tap();
  const b = (await page.locator('#vbar .color').boundingBox())!;
  expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(64);
  await expect(page.locator('#vbar button')).toHaveCount(4);
  await page.locator('#vbar .color').tap();
  await expect(page).toHaveURL(/#color\/\d+$/);
  await expect(page.locator('#color')).toBeVisible();
  for (const s of ['#gallery', '#view', '#menu', '#lesson']) await expect(page.locator(s)).toBeHidden();
  expect(await pixel(page, '#color', IN)).toEqual(RED);
  expect((await pixel(page, '#ink', ON))[3]).toBe(255);
  expect((await pixel(page, '#color', ON))[3]).toBe(0);
  expect(await pixel(page, '#ink', IN)).toEqual([0, 0, 0, 0]);
  await expect(page.locator('#ink')).toHaveCSS('pointer-events', 'none');
});

test('layered: painting changes the colour layer only, and a fill stays inside her closed shape', async ({ page }) => {
  await lessonDrawing(page, false);
  await openColor(page);
  const [ink0, color0] = [await digest(page, '#ink'), await digest(page, '#color')];
  await fillAt(page, IN, '#2f5bea');
  expect(await pixel(page, '#color', IN)).toEqual(BLUE);
  expect((await pixel(page, '#color', OUT))[3]).toBe(0); // the fill did not leak out through her line
  expect(await digest(page, '#color')).not.toBe(color0);
  await page.locator('[data-color="#e8402a"]').tap();
  await touchStroke(page, line([100, 900], [900, 900]));
  expect(await pixel(page, '#color', [500, 900])).toEqual(RED);
  expect(await digest(page, '#ink')).toBe(ink0);
});

test('Done with changes asks; replace updates the same record, nothing else changes', async ({ page }, info) => {
  await lessonDrawing(page);
  await openColor(page);
  const [before] = await records(page);
  await fillAt(page, IN, '#2f5bea');
  await page.locator('[data-act=done]').tap();
  await expect(ask(page).locator('button')).toHaveCount(3);
  await page.screenshot({ path: `review/recolor/choice-${info.project.name}.png` });
  for (const b of await ask(page).locator('button').all()) {
    const r = (await b.boundingBox())!;
    expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(64);
  }
  await page.locator('.ask .replace').tap();
  await expect(page.locator('#grid')).toBeVisible({ timeout: 6000 });
  const list = await records(page);
  expect(list).toHaveLength(1);
  const [after] = list;
  expect([after.id, after.lessonId, after.createdAt]).toEqual([before.id, before.lessonId, before.createdAt]);
  expect(after.keys).toEqual(before.keys);
  expect(after.png).not.toBe(before.png);
  expect(after.color).not.toBe(before.color);
  expect(after.ink).toBe(before.ink);
  // the grid shows the new picture
  const c = await page.locator('.pic img').evaluate(async (i) => {
    const b = await createImageBitmap(await (await fetch((i as HTMLImageElement).src)).blob());
    const x = new OffscreenCanvas(1024, 1024).getContext('2d')!;
    x.drawImage(b, 0, 0);
    return [...x.getImageData(512, 512, 1, 1).data];
  });
  expect(c).toEqual(BLUE);
});

test('Done with changes: keep both adds a new drawing and leaves the original byte-identical', async ({ page }) => {
  await lessonDrawing(page);
  await openColor(page);
  const [before] = await records(page);
  await fillAt(page, IN, '#2f5bea');
  await page.locator('[data-act=done]').tap();
  await page.locator('.ask .both').tap();
  await expect(page.locator('#grid')).toBeVisible({ timeout: 6000 });
  await expect(page.locator('.pic')).toHaveCount(2);
  const [added, original] = await records(page);
  expect(original).toEqual(before);
  expect(added.id).not.toBe(before.id);
  expect(added.lessonId).toBe('cat');
  expect(added.keys).toEqual(before.keys);
  expect(added.png).not.toBe(before.png);
  expect(added.ink).toBe(before.ink);
});

test('Done with no changes goes back to My Drawings: no dialog, nothing saved', async ({ page }) => {
  await lessonDrawing(page);
  await openColor(page);
  const before = await records(page);
  await page.locator('[data-act=done]').tap();
  await expect(page.locator('#grid')).toBeVisible();
  await expect(ask(page)).toHaveCount(0);
  expect(await records(page)).toEqual(before);
});

test('undo cannot remove the opened picture', async ({ page }) => {
  await lessonDrawing(page);
  await openColor(page);
  const [ink0, color0] = [await digest(page, '#ink'), await digest(page, '#color')];
  for (let i = 0; i < 4; i++) await page.locator('[data-act=undo]').tap();
  await settle();
  expect(await digest(page, '#color')).toBe(color0);
  expect(await digest(page, '#ink')).toBe(ink0);
  expect(await pixel(page, '#color', IN)).toEqual(RED);
  await touchStroke(page, line([100, 900], [900, 900]));
  expect(await digest(page, '#color')).not.toBe(color0);
  await page.locator('[data-act=undo]').tap();
  await expect.poll(() => digest(page, '#color')).toBe(color0);
  await page.locator('[data-act=undo]').tap();
  await settle();
  expect(await digest(page, '#color')).toBe(color0);
  expect(await digest(page, '#ink')).toBe(ink0);
});

test('go back keeps her work; Home with unsaved work asks, and trash discards', async ({ page }, info) => {
  await lessonDrawing(page);
  await openColor(page);
  const before = await records(page);
  await fillAt(page, IN, '#2f5bea');
  const d = await digest(page, '#color');
  await page.locator('[data-act=done]').tap();
  await page.locator('.ask .no').tap();
  await expect(ask(page)).toHaveCount(0);
  expect(await digest(page, '#color')).toBe(d);
  await page.locator('#fhome').tap();
  await expect(ask(page).locator('button')).toHaveCount(4);
  await page.screenshot({ path: `review/recolor/leave-${info.project.name}.png` });
  for (const b of await ask(page).locator('button').all()) {
    const r = (await b.boundingBox())!;
    expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(64);
  }
  await page.mouse.click(5, 5); // a tap outside is back too
  await expect(ask(page)).toHaveCount(0);
  await expect(page.locator('#free')).toBeVisible();
  expect(await digest(page, '#color')).toBe(d);
  await page.locator('#fhome').tap();
  await page.locator('.ask .yes').tap();
  await expect(page.locator('#menu')).toBeVisible();
  expect(await records(page)).toEqual(before);
});

test('Home with unsaved work can keep both in the same dialog', async ({ page }) => {
  await lessonDrawing(page);
  await openColor(page);
  await fillAt(page, IN, '#2f5bea');
  await page.locator('#fhome').tap();
  await page.locator('.ask .both').tap();
  await expect(page.locator('#grid')).toBeVisible({ timeout: 6000 });
  expect(await records(page)).toHaveLength(2);
});

for (const kind of ['free', 'legacy'] as const) {
  test(`${kind} drawing opens, paints, and saves by keep both and by replace`, async ({ page }) => {
    await (kind === 'free' ? freeDrawing(page) : legacyDrawing(page));
    await openColor(page);
    await expect(page.locator('#paint')).toBeVisible();
    await expect(page.locator('#ink')).toHaveCount(0);
    const [orig] = await records(page);
    expect(orig.ink).toBeUndefined();
    const there: P = kind === 'free' ? [500, 500] : [300, 300];
    expect((await pixel(page, '#paint', there))[3]).toBe(255); // her stroke / the old picture is there
    const d0 = await digest(page, '#paint');
    await page.locator('[data-act=undo]').tap();
    await settle();
    expect(await digest(page, '#paint')).toBe(d0);
    await page.locator('[data-color="#2f5bea"]').tap();
    await touchStroke(page, line([100, 900], [900, 900]));
    expect(await pixel(page, '#paint', [500, 900])).toEqual(BLUE);
    await page.locator('[data-act=done]').tap();
    await page.locator('.ask .both').tap();
    await expect(page.locator('#grid')).toBeVisible({ timeout: 6000 });
    const [added, same] = await records(page);
    expect(same).toEqual(orig); // the original survives a keep-both
    expect(added.keys).toEqual(['color', 'createdAt', 'id', 'lessonId', 'png']);
    // and replace, on the new one
    await page.locator('.pic').first().tap();
    await page.locator('#vbar .color').tap();
    await expect(page.locator('#paint')).toBeVisible();
    await touchStroke(page, line([100, 800], [900, 800]));
    await page.locator('[data-act=done]').tap();
    await page.locator('.ask .replace').tap();
    await expect(page.locator('#grid')).toBeVisible({ timeout: 6000 });
    const list = await records(page);
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(added.id);
    expect(list[0].png).not.toBe(added.png);
    expect(list[1]).toEqual(orig);
  });
}

test('a drawing that is not there returns to My Drawings', async ({ page }) => {
  await page.goto('./#color/9999');
  await expect(page.locator('#gallery')).toBeVisible();
  await expect(page.locator('#free')).toBeHidden();
  await page.goto('./#color/abc'); // not an id: like any unknown hash, home
  await expect(page.locator('#menu')).toBeVisible();
});

test('review screenshots', async ({ page }, info) => {
  const name = (s: string) => `review/recolor/${s}-${info.project.name}.png`;
  await lessonDrawing(page);
  await page.goto('./#gallery');
  await page.locator('.pic').tap();
  await page.screenshot({ path: name('viewer') });
  await page.locator('#vbar .color').tap();
  await expect(page.locator('#color')).toBeVisible();
  await fillAt(page, [150, 150], '#ffd21f');
  await page.locator('[data-color="#43c04f"]').tap();
  await touchStroke(page, line([100, 880], [900, 880]));
  await page.screenshot({ path: name('screen') });
});
