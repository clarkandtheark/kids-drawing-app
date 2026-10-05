// Learning path stop player (#36): every exercise type end to end by touch, retry, result + sticker, progress, leave,
// layout. Screenshots go to review/player/ (gitignored) for a visual check.
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { ink, line, touchStroke, type P } from './helpers';
import unit from '../path/01-lines.json' with { type: 'json' };

type X = { type: string; say?: string; strokes?: string[]; given?: string[]; lesson?: string };
const [straight, zigzag] = unit.stops as { id: string; sticker: string; exercises: X[] }[];
const OUT = 'review/player';

let errors: string[];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    const w = window as any;
    w.__said = [];
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true, value: { speak: (u: SpeechSynthesisUtterance) => w.__said.push(u.text), cancel() {}, getVoices: () => [] },
    });
  });
});
test.afterEach(() => expect(errors).toEqual([]));

const shot = (page: Page, info: TestInfo, name: string) => page.screenshot({ path: `${OUT}/${name}-${info.project.name}.png` });
const said = (page: Page) => page.evaluate(() => (window as any).__said as string[]);
const seg = (page: Page, i: number) => page.locator('#sbar i').nth(i);
const stopEl = (page: Page) => page.locator('#stop');
const progress = (page: Page) => page.evaluate(async () => (await import('/src/store.ts' as string)).getPathProgress());

/** Logical points every `gap` units along a path, optionally mapped. */
const sample = (page: Page, d: string, gap = 20) => page.evaluate(([d, gap]) => {
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d as string);
  const L = p.getTotalLength(), n = Math.max(4, Math.ceil(L / (gap as number)));
  return Array.from({ length: n + 1 }, (_, i) => { const q = p.getPointAtLength((L * i) / n); return [q.x, q.y] as P; });
}, [d, gap] as const);
const draw = async (page: Page, ds: string[], f = (p: P) => p) => { for (const d of ds) await touchStroke(page, (await sample(page, d)).map(f)); };
const half: (p: P) => P = ([x, y]) => [650 + (x - 500) * 0.45, 250 + (y - 500) * 0.45]; // smaller, in the top-right corner

async function open(page: Page, stop: string) {
  await page.goto('about:blank');
  await page.goto(`./#stop/lines/${stop}`);
  await expect(page.locator('#sink')).toBeVisible();
}
const ready = (page: Page) => expect(stopEl(page)).toHaveAttribute('data-phase', 'draw', { timeout: 10_000 });
/** Check, then wait for exercise `i` to be done: its segment shows `r` and the next exercise (or the result) is up. */
async function check(page: Page, i: number, r: string, last = false) {
  await page.locator('#sok').tap();
  await expect(seg(page, i)).toHaveAttribute('data-r', r);
  if (last) await expect(page.locator('.result')).toBeVisible();
  else await expect(seg(page, i + 1)).toHaveClass(/on/);
}

/** A good attempt at exercise i of `ex`, by touch from its own geometry. */
async function pass(page: Page, ex: X[], i: number) {
  const x = ex[i];
  await expect(stopEl(page)).toHaveAttribute('data-kind', x.type);
  if (x.type === 'create') {
    await touchStroke(page, line([200, 700], [500, 300]));
    await page.locator('#stools [data-act=done]').tap();
    await expect(seg(page, i)).toHaveAttribute('data-r', 'great', { timeout: 10_000 });
    return;
  }
  await ready(page);
  await draw(page, x.strokes!, x.type === 'shape' ? half : x.type === 'memory' ? ([a, b]) => [a + 25, b - 20] : undefined);
  await check(page, i, 'great', i === ex.length - 1);
}

test('path.json is built and served with the sample unit; the stop route opens the player', async ({ page }) => {
  const units = await (await page.request.get('./path.json')).json();
  expect(units.map((u: { id: string }) => u.id)).toContain('lines');
  const lines = units.find((u: { id: string }) => u.id === 'lines');
  expect(lines.stops.map((s: { id: string }) => s.id)).toEqual(['straight', 'zigzag']);
  const types = new Set(lines.stops.flatMap((s: { exercises: X[] }) => s.exercises.map((x) => x.type)));
  expect([...types].sort()).toEqual(['create', 'finish', 'lesson', 'memory', 'shape', 'trace']);
  await open(page, 'straight');
  await expect(page.locator('#sbar i')).toHaveCount(straight.exercises.length);
  await expect(page.locator('#menu')).toBeHidden();
  await page.goto('./#stop/lines/nope'); // an unknown stop is just home
  await expect(page.locator('#menu')).toBeVisible();
});

test('trace: the guide demonstrates, tracing it scores great; empty check does nothing but nudge and repeat', async ({ page }, info) => {
  await open(page, 'straight');
  await expect(stopEl(page)).toHaveAttribute('data-kind', 'trace');
  expect((await said(page)).at(-1)).toBe(straight.exercises[0].say);
  await expect(page.locator('#sguide path.now.rest')).toHaveCount(1); // the demonstration ends as a dotted guide
  await shot(page, info, 'trace-start');
  // Empty canvas: the check only nudges and repeats the prompt.
  const n = (await said(page)).length;
  await page.locator('#sok').tap();
  await expect(page.locator('#sok')).toHaveClass(/nudge/);
  expect((await said(page)).slice(n)).toEqual([straight.exercises[0].say]);
  await expect(seg(page, 0)).toHaveClass(/on/);
  await expect(seg(page, 0)).not.toHaveAttribute('data-r', /./);
  // Undo takes the stroke out of the score too.
  await touchStroke(page, line([200, 200], [300, 300]));
  await page.locator('#sundo').tap();
  await expect.poll(() => ink(page)).toBe(0);
  await page.locator('#sok').tap();
  await expect(seg(page, 0)).toHaveClass(/on/);

  await draw(page, straight.exercises[0].strokes!);
  await expect(page.locator('#sok')).toHaveClass(/ready/);
  await page.locator('#sok').tap();
  await expect(seg(page, 0)).toHaveAttribute('data-r', 'great');
  await expect(page.locator('.sreact svg')).toHaveCount(3);
  await page.waitForTimeout(700);
  await shot(page, info, 'trace-good');
  await expect(seg(page, 1)).toHaveClass(/on/);
  await expect.poll(() => ink(page)).toBe(0); // a fresh canvas for the next exercise
});

test('shape: no guide, an example beside the canvas; drawn smaller elsewhere scores high, a different shape gets one retry then moves on', async ({ page }, info) => {
  test.setTimeout(60_000);
  await open(page, 'zigzag');
  await pass(page, zigzag.exercises, 0);
  await expect(stopEl(page)).toHaveAttribute('data-kind', 'shape');
  await expect(page.locator('#sref')).toBeVisible();
  await expect(page.locator('#sexample path')).toHaveCount(1);
  await expect(page.locator('#sguide path')).toHaveCount(0);
  await page.waitForTimeout(2200); // the example has drawn itself
  await shot(page, info, 'shape-start');

  // A circle is not a zigzag: one star, so one gentle retry.
  const circle = 'M 300 500 A 200 200 0 1 1 700 500 A 200 200 0 1 1 300 500 Z';
  await draw(page, [circle]);
  await page.locator('#sok').tap();
  await expect(seg(page, 1)).toHaveAttribute('data-r', 'try');
  await expect(stopEl(page)).toHaveAttribute('data-phase', 'busy');
  await expect(page.locator('#ssheet')).toHaveClass(/wiggle/);
  await page.waitForTimeout(300);
  await shot(page, info, 'shape-retry');
  expect(await ink(page)).toBeGreaterThan(0); // her attempt stays a moment
  await ready(page);
  await expect.poll(() => ink(page)).toBe(0); // then clears, and the check is back
  await expect(page.locator('#scheck')).toBeVisible();
  await expect(seg(page, 1)).toHaveClass(/on/);
  // The retry: the real zigzag, half size, in a corner.
  await draw(page, zigzag.exercises[1].strokes!, half);
  await check(page, 1, 'great');

  // Next time a wrong shape twice: the second attempt moves on anyway.
  await open(page, 'zigzag');
  await pass(page, zigzag.exercises, 0);
  await ready(page);
  await draw(page, [circle]);
  await page.locator('#sok').tap();
  await expect(seg(page, 1)).toHaveAttribute('data-r', 'try');
  await ready(page);
  await draw(page, [circle]);
  await check(page, 1, 'try');
});

test('shape: drawn well, smaller and elsewhere (screenshot after a good attempt)', async ({ page }, info) => {
  await open(page, 'zigzag');
  await pass(page, zigzag.exercises, 0);
  await ready(page);
  await draw(page, zigzag.exercises[1].strokes!, half);
  await page.locator('#sok').tap();
  await expect(seg(page, 1)).toHaveAttribute('data-r', 'great');
  await page.waitForTimeout(700);
  await shot(page, info, 'shape-good');
});

test('memory: blocked while visible, hidden afterwards, replay shows it again and clears her ink, from memory passes', async ({ page }, info) => {
  test.setTimeout(60_000);
  await open(page, 'straight');
  for (let i = 0; i < 3; i++) await pass(page, straight.exercises, i);
  await expect(stopEl(page)).toHaveAttribute('data-kind', 'memory');
  await expect(stopEl(page)).toHaveAttribute('data-phase', 'demo');
  await page.waitForTimeout(1800); // drawn on, still showing
  await expect(page.locator('#sguide path')).toHaveCount(2);
  await shot(page, info, 'memory-start');
  await touchStroke(page, line([200, 200], [800, 800]));
  expect(await ink(page)).toBe(0); // no drawing while it is visible
  await ready(page);
  await expect(page.locator('#sguide path')).toHaveCount(0); // gone
  await shot(page, info, 'memory-hidden');
  await touchStroke(page, line([200, 200], [800, 800]));
  expect(await ink(page)).toBeGreaterThan(0);
  await page.locator('#sreplay').tap();
  await expect(stopEl(page)).toHaveAttribute('data-phase', 'demo');
  await expect(page.locator('#sguide path')).toHaveCount(2);
  await expect.poll(() => ink(page)).toBe(0);
  await ready(page);
  await draw(page, straight.exercises[3].strokes!, ([x, y]) => [x + 25, y - 20]); // roughly where it was
  await page.locator('#sok').tap();
  await expect(seg(page, 3)).toHaveAttribute('data-r', 'great');
  await page.waitForTimeout(700);
  await shot(page, info, 'memory-good');
});

test('finish: given lines show and do not count; the missing strokes score high; then the linked lesson plays and the stop goes on', async ({ page }, info) => {
  test.setTimeout(90_000);
  await open(page, 'straight');
  for (let i = 0; i < 4; i++) await pass(page, straight.exercises, i);
  const x = straight.exercises[4];
  await expect(stopEl(page)).toHaveAttribute('data-kind', 'finish');
  await expect(page.locator('#sguide .given')).toHaveCount(x.given!.length);
  await expect(page.locator('#sguide .hint')).toHaveCount(x.strokes!.length);
  await shot(page, info, 'finish-start');
  await draw(page, x.given!); // tracing what is already there earns nothing
  await page.locator('#sok').tap();
  await expect(seg(page, 4)).toHaveAttribute('data-r', 'try');
  await ready(page);
  await draw(page, x.strokes!);
  await page.locator('#sok').tap();
  await expect(seg(page, 4)).toHaveAttribute('data-r', 'great');
  await page.waitForTimeout(700);
  await shot(page, info, 'finish-good');

  // lesson: the play button opens the lesson; after its result and Color mode it comes back here, done.
  await expect(stopEl(page)).toHaveAttribute('data-kind', 'lesson');
  await expect(page.locator('#sguide .thumb')).not.toHaveCount(0);
  await shot(page, info, 'lesson-start');
  await page.locator('#sok').tap();
  await expect(page.locator('#lesson')).toBeVisible();
  await expect(page).toHaveURL(/#lesson\/sun$/);
  await expect(stopEl(page)).toBeHidden();
  const steps = (await (await page.request.get('./lessons.json')).json()).find((l: { id: string }) => l.id === 'sun').steps;
  for (let i = 0; i < steps.length; i++) {
    if (i === 0) await draw(page, steps[0].strokes);
    await page.locator('#next').tap();
  }
  await expect(page.locator('.result')).toBeVisible();
  const lessonStars = await page.locator('.result .rstars svg.got').count();
  await page.locator('.result .go').tap();
  await expect(page.locator('#lesson')).toHaveAttribute('data-phase', 'color');
  await page.locator('#tools [data-act=done]').tap();
  await expect(page).toHaveURL(/#stop\/lines\/straight$/, { timeout: 10_000 });
  await expect(seg(page, 5)).toHaveAttribute('data-r', ['', 'try', 'good', 'great'][lessonStars]);
  // That was the last exercise: the result, with the sticker.
  await expect(page.locator('.result .sticker')).toHaveText(straight.sticker);
  await expect.poll(async () => (await progress(page))['lines/straight']?.stars).toBe(Math.round((3 * 4 + 3 + lessonStars) / 6));
});

test('lesson exercise: leaving the lesson early comes back to the stop with it still to do', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page, 'straight');
  for (let i = 0; i < 5; i++) await pass(page, straight.exercises, i);
  await page.locator('#sok').tap();
  await expect(page.locator('#lesson')).toBeVisible();
  await page.locator('#home').tap(); // nothing drawn: straight back
  await expect(page).toHaveURL(/#stop\/lines\/straight$/);
  await expect(stopEl(page)).toHaveAttribute('data-kind', 'lesson');
  await expect(seg(page, 5)).toHaveClass(/on/);
  for (let i = 0; i < 5; i++) await expect(seg(page, i)).toHaveAttribute('data-r', 'great'); // her run survived
});

test('create: colour tools appear, Done saves a drawing with layers to the gallery; the stop ends with its sticker; progress only goes up; reset clears it', async ({ page }, info) => {
  test.setTimeout(120_000);
  await open(page, 'zigzag');
  for (let i = 0; i < 5; i++) await pass(page, zigzag.exercises, i);
  await expect(stopEl(page)).toHaveAttribute('data-kind', 'create');
  await expect(page.locator('#stools .crayon')).toHaveCount(12);
  await expect(page.locator('#sok')).toBeHidden();
  await shot(page, info, 'create-start');
  await page.locator('#stools .crayon').nth(5).tap();
  await touchStroke(page, line([150, 800], [350, 300]));
  await touchStroke(page, line([350, 300], [550, 800]));
  await touchStroke(page, line([550, 800], [750, 350]));
  await shot(page, info, 'create-good');
  const before = await page.evaluate(async () => (await (await import('/src/store.ts' as string)).listDrawings()).length);
  await page.locator('#stools [data-act=done]').tap();
  await expect(seg(page, 5)).toHaveAttribute('data-r', 'great', { timeout: 10_000 });
  await expect(page.locator('.result')).toBeVisible();
  const d = await page.evaluate(async () => {
    const list = await (await import('/src/store.ts' as string)).listDrawings();
    return { n: list.length, lessonId: list[0].lessonId, png: list[0].png.size, color: list[0].color?.size ?? 0 };
  });
  expect(d.n).toBe(before + 1);
  expect(d.lessonId).toBeNull();
  expect(d.png).toBeGreaterThan(0);
  expect(d.color).toBeGreaterThan(0);

  await expect(page.locator('.result .sticker')).toHaveText(zigzag.sticker);
  await expect(page.locator('.result .rstars svg.got')).toHaveCount(3);
  expect((await said(page)).at(-1)).toMatch(/sticker/i);
  await page.waitForTimeout(2400); // stars and sticker landed
  await shot(page, info, 'result');
  const go = (await page.locator('.result .go').boundingBox())!;
  expect(Math.min(go.width, go.height)).toBeGreaterThanOrEqual(64);
  await expect.poll(async () => (await progress(page))['lines/zigzag']).toEqual({ stars: 3 });
  await page.locator('.result .go').tap();
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('.result')).toHaveCount(0);

  // A worse run (every graded exercise wrong twice) does not lower it.
  await open(page, 'zigzag');
  for (let i = 0; i < 5; i++) {
    for (let k = 0; k < 2; k++) {
      await ready(page);
      await touchStroke(page, line([100, 900], [130, 880]));
      await page.locator('#sok').tap();
      await expect(seg(page, i)).toHaveAttribute('data-r', 'try');
    }
    await expect(seg(page, i + 1)).toHaveClass(/on/);
  }
  await touchStroke(page, line([200, 700], [500, 300]));
  await page.locator('#stools [data-act=done]').tap();
  await expect(page.locator('.result .rstars svg.got')).toHaveCount(1, { timeout: 10_000 });
  await page.waitForTimeout(300);
  expect((await progress(page))['lines/zigzag']).toEqual({ stars: 3 });

  // Parent area reset clears path progress too.
  await page.locator('.result .go').tap();
  await page.locator('#logo').hover();
  await page.mouse.down();
  await page.waitForTimeout(3300);
  await page.mouse.up();
  await page.locator('#preset').tap();
  await page.locator('.ask .yes').tap();
  await expect.poll(() => progress(page)).toEqual({});
});

test('leaving mid-stop asks first: keep going stays, leave goes home', async ({ page }, info) => {
  await open(page, 'straight');
  await page.locator('#sclose').tap(); // nothing done yet: straight home
  await expect(page.locator('#menu')).toBeVisible();
  await open(page, 'straight');
  await touchStroke(page, line([200, 500], [600, 500]));
  await page.locator('#sclose').tap();
  await expect(page.locator('.ask button')).toHaveCount(2);
  await shot(page, info, 'leave');
  await page.locator('.ask .no').tap();
  await expect(page.locator('.ask')).toHaveCount(0);
  await expect(stopEl(page)).toBeVisible();
  expect(await ink(page)).toBeGreaterThan(0);
  await page.locator('#sclose').tap();
  await page.locator('.ask .yes').tap();
  await expect(page.locator('#menu')).toBeVisible();
  await expect(stopEl(page)).toBeHidden();
});

type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
async function layoutOk(page: Page, label: string) {
  const vp = page.viewportSize()!;
  expect(await page.evaluate(() => document.documentElement.scrollWidth), `${label}: horizontal scroll`).toBeLessThanOrEqual(vp.width);
  const sheet = (await page.locator('#ssheet').boundingBox())!;
  expect(sheet.width, `${label}: canvas size`).toBeGreaterThan(Math.min(vp.width, vp.height) * 0.6);
  const all = [...await page.locator('#stop button:visible').all()];
  const boxes = await Promise.all(all.map(async (b) => ({ box: (await b.boundingBox())!, crayon: await b.evaluate((e) => e.classList.contains('crayon')), name: await b.evaluate((e) => e.id || e.ariaLabel) })));
  const bar = (await page.locator('#sbar').boundingBox())!;
  expect(bar.width, `${label}: progress bar`).toBeGreaterThan(100);
  for (const [i, { box: b, crayon, name }] of boxes.entries()) {
    // ponytail: like Color mode, crayons on a phone are 56-64px wide (6 across), 72px tall
    expect(crayon ? b.height : Math.min(b.width, b.height), `${label}: ${name} size`).toBeGreaterThanOrEqual(64);
    expect(b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width && b.y + b.height <= vp.height, `${label}: ${name} inside`).toBe(true);
    expect(overlap(b, sheet), `${label}: ${name} over the canvas`).toBe(false);
    expect(overlap(b, bar), `${label}: ${name} over the progress bar`).toBe(false);
    for (const c of boxes.slice(i + 1)) expect(overlap(b, c.box), `${label}: ${name} / ${c.name}`).toBe(false);
  }
  if (await page.locator('#sref').isVisible()) {
    const ref = (await page.locator('#sref').boundingBox())!;
    expect(overlap(ref, sheet), `${label}: example over the canvas`).toBe(false);
    for (const { box: b, name } of boxes) expect(overlap(b, ref), `${label}: ${name} over the example`).toBe(false);
  }
}

test('layout: trace, shape and create fit every viewport, big targets clear of the canvas', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page, 'zigzag');
  await layoutOk(page, 'trace');
  await pass(page, zigzag.exercises, 0);
  await expect(stopEl(page)).toHaveAttribute('data-kind', 'shape');
  await layoutOk(page, 'shape');
  for (let i = 1; i < 5; i++) await pass(page, zigzag.exercises, i);
  await expect(stopEl(page)).toHaveAttribute('data-kind', 'create');
  await layoutOk(page, 'create');
  await page.locator('#sclose').tap();
  await expect(page.locator('.ask')).toBeVisible();
  const vp = page.viewportSize()!;
  for (const b of await page.locator('.ask button').all()) {
    const r = (await b.boundingBox())!;
    expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(64);
    expect(r.x >= 0 && r.y >= 0 && r.x + r.width <= vp.width && r.y + r.height <= vp.height).toBe(true);
  }
});

test('phone landscape (844 x 390): trace, shape and create fit beside the canvas', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone only: the projects have no phone-landscape viewport');
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 844, height: 390 });
  await open(page, 'zigzag');
  await expect(page.locator('#sguide path.now.rest')).toHaveCount(1);
  await layoutOk(page, 'trace');
  await shot(page, info, 'trace-start-landscape');
  await pass(page, zigzag.exercises, 0);
  await page.waitForTimeout(2200);
  await layoutOk(page, 'shape');
  await shot(page, info, 'shape-start-landscape');
  await draw(page, zigzag.exercises[1].strokes!, half);
  await page.locator('#sok').tap();
  await expect(seg(page, 1)).toHaveAttribute('data-r', 'great');
  await page.waitForTimeout(700);
  await shot(page, info, 'shape-good-landscape');
  await expect(seg(page, 2)).toHaveClass(/on/);
  for (let i = 2; i < 5; i++) await pass(page, zigzag.exercises, i);
  await layoutOk(page, 'create');
  await shot(page, info, 'create-start-landscape');
});
