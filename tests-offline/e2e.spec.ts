// End-to-end pass (SPEC process step 4) on the PRODUCTION build under /kids-drawing-app/, both iPad viewports,
// simulated touch. Screenshots for eyeballing go to review/final/ (gitignored).
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { ink, line, toClient, touchStroke, type P } from '../tests/helpers';

type Lesson = { id: string; title: string; difficulty: number; category?: string; steps: { say: string; strokes: string[] }[] };
const OUT = 'review/final';
mkdirSync(OUT, { recursive: true });

let errors: string[];
test.beforeEach(async ({ page, context }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await context.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak() {}, cancel() {}, getVoices: () => [] } });
    const shared: File[] = ((window as any).__shared = []);
    (navigator as any).canShare = (d: any) => !!d?.files?.length;
    (navigator as any).share = async (d: any) => { shared.push(...d.files); };
  });
});
test.afterEach(() => expect(errors).toEqual([]));

const shot = (page: Page, info: TestInfo, name: string) => page.screenshot({ path: `${OUT}/${name}-${info.project.name}.png` });
const lessonsOf = async (page: Page) => (await (await page.request.get('lessons.json')).json()) as Lesson[];
const phase = (page: Page) => page.locator('#lesson').getAttribute('data-phase');

/** Logical points along an SVG path, about every `gap` units: what a child tracing the guide would draw. */
const sample = (page: Page, d: string, gap = 25) => page.evaluate(([d, gap]) => {
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d as string);
  const L = p.getTotalLength(), n = Math.max(4, Math.ceil(L / (gap as number)));
  return Array.from({ length: n + 1 }, (_, i) => { const q = p.getPointAtLength((L * i) / n); return [q.x, q.y] as [number, number]; });
}, [d, gap] as const);

/** Touch-tap a logical point on the drawing square. */
const tapAt = async (page: Page, p: P) => { const [[x, y]] = await toClient(page, [p]); await page.touchscreen.tap(x, y); };

/** Colour-layer pixel [r,g,b,a] at a logical point (#color in a lesson, #paint in Free draw). */
const pixel = (page: Page, sel: string, [x, y]: P) => page.evaluate(([sel, x, y]) => {
  const c = document.querySelector<HTMLCanvasElement>(sel as string)!, k = c.width / 1000;
  return [...c.getContext('2d')!.getImageData(Math.floor((x as number) * k), Math.floor((y as number) * k), 1, 1).data];
}, [sel, x, y] as const);

/** Every visible tap target in `scope` is at least 64x64 CSS px and fully on screen (sideways only, for a scroller). */
async function bigTargets(page: Page, scope: string, scrolls = false) {
  const vp = page.viewportSize()!;
  const els = await page.locator(`${scope} :is(button, a, label):visible`).all();
  expect(els.length, scope).toBeGreaterThan(0);
  for (const el of els) {
    const r = (await el.boundingBox())!, name = `${scope} ${await el.getAttribute('aria-label') ?? await el.textContent()}`;
    expect(Math.min(r.width, r.height), name).toBeGreaterThanOrEqual(64);
    const across = r.x >= 0 && r.x + r.width <= vp.width + 0.5, down = r.y >= 0 && r.y + r.height <= vp.height + 0.5;
    expect(across && (scrolls || down), `${name} on screen`).toBe(true);
  }
}

/** No visible text in the child's screens smaller than 24px (the parent area is excluded by design). */
const smallText = (page: Page) => page.evaluate(() => {
  const small: string[] = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const el = n.parentElement!;
    if (!n.textContent!.trim() || el.closest('#parent') || !el.checkVisibility()) continue;
    if (parseFloat(getComputedStyle(el).fontSize) < 24) small.push(n.textContent!.trim());
  }
  return small;
});

const noHorizontalOverflow = (page: Page) => page.evaluate(() =>
  [document.documentElement, ...document.querySelectorAll<HTMLElement>('main:not([hidden])')]
    .every((e) => e.scrollWidth <= e.clientWidth));

/** Long-press the logo with a finger. */
async function holdLogo(page: Page, ms: number) {
  const b = (await page.locator('#logo').boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const pt = [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
  await page.waitForTimeout(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** Count of not-quite-white pixels in a decoded <img>. */
const nonWhite = (page: Page, sel: string) => page.locator(sel).evaluate(async (img: HTMLImageElement) => {
  await img.decode();
  const c = new OffscreenCanvas(img.naturalWidth, img.naturalHeight), x = c.getContext('2d')!;
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) n++;
  return n;
});

/** Trace every stroke of every step of the open lesson, tapping Next after each, to Color mode. */
async function traceToColor(page: Page, l: Lesson) {
  for (const s of l.steps) {
    for (const d of s.strokes) await touchStroke(page, await sample(page, d));
    await page.locator('#next').tap();
  }
  await page.locator('.result .go').tap();
  await expect(page.locator('#lesson')).toHaveAttribute('data-phase', 'color');
}

test('fresh home: a card per lesson in three levels, nothing overflows sideways, scrolls by touch', async ({ page }, info) => {
  await page.goto('./');
  const all = await lessonsOf(page);
  await expect(page.locator('.card')).toHaveCount(all.length);
  await expect(page.locator('section.level[data-level]')).toHaveCount(3);
  for (const n of [1, 2, 3]) {
    const ids = await page.locator(`section.level[data-level="${n}"] .card`).evaluateAll((cs) => cs.map((c) => (c as HTMLElement).dataset.id));
    expect(ids).toEqual(all.filter((l) => l.difficulty === n && !l.category).map((l) => l.id));
    expect(ids).toHaveLength(10);
  }
  await expect(page.locator('.card.done')).toHaveCount(0);
  expect(await noHorizontalOverflow(page)).toBe(true);
  const vp = page.viewportSize()!;
  for (const c of await page.locator('.card').all()) {
    const r = (await c.boundingBox())!;
    expect(r.x >= 0 && r.x + r.width <= vp.width).toBe(true);
  }
  await bigTargets(page, '#menu', true);
  expect(await smallText(page)).toEqual([]);
  expect(await page.locator('a[href^="http"], a[target]').count()).toBe(0); // no external links anywhere
  await shot(page, info, 'home-top');

  // Finger drags scroll the home screen until level 3 is in view.
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', y: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: vp.width / 2, y, id: 1 }] });
  const level3Top = () => page.locator('section.level[data-level="3"]').evaluate((e) => e.getBoundingClientRect().top);
  const atEnd = () => page.locator('#menu').evaluate((e) => e.scrollTop + e.clientHeight >= e.scrollHeight - 1);
  for (let i = 0; i < 20 && (await level3Top()) > 40 && !(await atEnd()); i++) {
    await touch('touchStart', vp.height * 0.8);
    for (let y = vp.height * 0.8; y >= vp.height * 0.3; y -= 25) await touch('touchMove', y);
    await touch('touchEnd', vp.height * 0.3);
  }
  expect(await page.locator('#menu').evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  // Level 3 is up near the top, or (a short page, 5 cards per row) scrolled fully into view at the end.
  const l3 = await page.locator('section.level[data-level="3"]').evaluate((e) => e.getBoundingClientRect());
  expect(l3.top < vp.height / 3 || (await atEnd() && l3.top >= 0 && l3.bottom <= vp.height + 1)).toBe(true);
  await shot(page, info, 'home-level3');
});

test('every lesson: trace a stroke per step, the guide shows the right strokes, reach Color mode', async ({ page }, info) => {
  test.setTimeout(300_000);
  await page.goto('./');
  const all = await lessonsOf(page);
  const shots = new Set(['house', 'owl', 'unicorn']); // one per level, mid-lesson, Trace and Copy
  for (const l of all) {
    await page.locator(`.card[data-id="${l.id}"]`).tap();
    await expect(page.locator('#lesson')).toBeVisible();
    await expect(page.locator('#lesson')).toHaveAttribute('data-mode', 'trace');
    await expect(page.locator('#dots i')).toHaveCount(l.steps.length);
    for (let i = 0; i < l.steps.length; i++) {
      const where = `${l.id} step ${i + 1}`;
      const guide = await page.locator('#sheet #guide path').evaluateAll((ps) => ps.map((p) => [p.classList[0], p.getAttribute('d')]));
      expect(guide, where).toEqual([
        ...l.steps.slice(0, i).flatMap((s) => s.strokes.map((d) => ['gray', d])),
        ...l.steps[i].strokes.map((d) => ['now', d]),
      ]);
      expect(await page.locator('#dots i').evaluateAll((ds) => ds.map((d) => d.className)), where)
        .toEqual(l.steps.map((_, j) => (j < i ? 'past' : j === i ? 'on' : '')));
      await expect(page.locator('#next')).toHaveAttribute('aria-label', i === l.steps.length - 1 ? 'Done' : 'Next');
      const pts = await sample(page, l.steps[i].strokes[0], 120);
      const box = [Math.min(...pts.map((p) => p[0])) - 20, Math.min(...pts.map((p) => p[1])) - 20,
        Math.max(...pts.map((p) => p[0])) + 20, Math.max(...pts.map((p) => p[1])) + 20];
      const before = await ink(page, box);
      await touchStroke(page, pts);
      expect(await ink(page, box), where).toBeGreaterThan(before);
      if (shots.has(l.id) && i === Math.floor(l.steps.length / 2)) {
        await expect.poll(() => phase(page)).toBe('guide');
        await shot(page, info, `lesson-${l.difficulty}-${l.id}-trace`);
        await bigTargets(page, '#lesson');
        await page.locator('#mode').tap();
        await expect.poll(() => phase(page)).toBe('guide');
        await expect(page.locator('#ref #guide path.now')).toHaveCount(l.steps[i].strokes.length);
        await shot(page, info, `lesson-${l.difficulty}-${l.id}-copy`);
        await bigTargets(page, '#lesson');
        await page.locator('#mode').tap();
      }
      await page.locator('#next').tap();
    }
    await expect(page.locator('.result .pct')).toBeVisible();
    await page.locator('.result .go').tap();
    await expect(page.locator('#lesson')).toHaveAttribute('data-phase', 'color');
    await expect(page.locator('#guide')).toBeHidden();
    await expect(page.locator('.crayon')).toHaveCount(12);
    await page.locator('#home').tap();
    await page.locator('.ask .yes').tap(); // her tracing is unsaved: throw it away
    await expect(page.locator('#menu')).toBeVisible();
  }
});

test('step animation: ~1.5s highlight draw then a pause, earlier strokes gray, dotted resting guide; Copy panel', async ({ page }) => {
  await page.goto('./');
  await page.locator('.card[data-id=cat]').tap();
  await expect.poll(() => phase(page), { timeout: 5000 }).toBe('guide');
  // Record phase changes with page timestamps.
  await page.evaluate(() => {
    const r = document.querySelector<HTMLElement>('#lesson')!, log: [string, number][] = ((window as any).__ph = []);
    new MutationObserver(() => log.push([r.dataset.phase!, performance.now()])).observe(r, { attributeFilter: ['data-phase'] });
  });
  await page.locator('#next').tap(); // step 2: two ears
  const style = (sel: string) => page.locator(sel).first().evaluate((p) => {
    const s = getComputedStyle(p);
    return { stroke: s.stroke, dash: s.strokeDasharray };
  });
  expect((await style('#guide path.gray')).stroke).toBe('rgb(197, 201, 207)');
  expect((await style('#guide path.now')).stroke).toBe('rgb(255, 90, 54)');
  await page.waitForTimeout(1200);
  expect(await phase(page)).toBe('anim');
  await expect.poll(() => phase(page), { timeout: 4000 }).toBe('guide');
  const log: [string, number][] = await page.evaluate(() => (window as any).__ph);
  const t0 = log.find(([p]) => p === 'anim')![1], t1 = log.find(([p]) => p === 'guide')![1];
  console.log(`step animation: ${Math.round(t1 - t0)} ms to the resting guide`);
  expect(t1 - t0).toBeGreaterThan(1500 + 300); // 1.5s draw, then a pause
  expect(t1 - t0).toBeLessThan(2600);
  const rest = await style('#sheet #guide path.now.rest');
  expect(rest.stroke).toBe('rgb(255, 154, 122)');
  expect(rest.dash).not.toBe('none'); // dotted
  await expect(page.locator('#next')).toHaveClass(/ready/);

  // Copy mode: the reference moves to a panel beside the canvas, the canvas has no guide.
  await page.locator('#mode').tap();
  await expect(page.locator('#lesson')).toHaveAttribute('data-mode', 'copy');
  await expect(page.locator('#sheet #guide')).toHaveCount(0);
  await expect(page.locator('#ref #guide path')).toHaveCount(3);
  const ref = (await page.locator('#ref').boundingBox())!, sheet = (await page.locator('#sheet').boundingBox())!;
  const apart = ref.y + ref.height <= sheet.y || ref.x >= sheet.x + sheet.width;
  expect(apart).toBe(true);
  await touchStroke(page, line([200, 500], [800, 500]));
  expect(await ink(page)).toBeGreaterThan(0);
});

test('colour phase: brush undo goes back at least 30 levels', async ({ page }) => {
  await page.goto('./');
  await page.locator('.card[data-id=sun]').tap();
  for (let i = 0; i < 6; i++) await page.locator('#next').tap();
  await page.locator('.result .go').tap();
  await expect(page.locator('#lesson')).toHaveAttribute('data-phase', 'color');
  const colored = () => page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#color')!, d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return n;
  });
  await page.locator('[data-size="20"]').tap();
  for (let i = 0; i < 31; i++) await touchStroke(page, line([100, 40 + i * 30], [900, 40 + i * 30], 4));
  for (let i = 0; i < 30; i++) await page.locator('[data-act=undo]').tap();
  await expect.poll(() => page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#color')!, k = c.width / 1000;
    const d = c.getContext('2d')!.getImageData(0, 70 * k, c.width, 930 * k).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return n;
  })).toBe(0);
  expect(await colored()).toBeGreaterThan(0); // the first stroke is still there
});

test('full journey: trace, fill and paint, celebrate, star, gallery, full-screen, share, delete', async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.goto('./');
  const face = (await lessonsOf(page)).find((l) => l.id === 'face')!;
  await page.locator('.card[data-id=face]').tap();
  await traceToColor(page, face);
  await bigTargets(page, '#lesson');
  expect(await smallText(page)).toEqual([]);

  // Fill inside the traced face circle (forehead, clear of the hair, eyes and smile), then paint with the brush.
  await page.locator('.crayon[aria-label=yellow]').tap();
  await page.locator('[data-tool=fill]').tap();
  await tapAt(page, [500, 330]);
  expect(await pixel(page, '#color', [500, 330])).toEqual([0xff, 0xd2, 0x1f, 255]);
  expect(await pixel(page, '#color', [500, 560])).toEqual([0xff, 0xd2, 0x1f, 255]); // whole face, between the eyes
  expect((await pixel(page, '#color', [60, 60]))[3]).toBe(0); // did not leak outside the face
  await page.locator('.crayon[aria-label="sky blue"]').tap();
  await tapAt(page, [60, 60]); // background
  await page.locator('.crayon[aria-label=pink]').tap();
  await page.locator('[data-size="80"]').tap(); // back to the brush
  await touchStroke(page, line([90, 930], [910, 930]));
  expect(await pixel(page, '#color', [500, 930])).toEqual([0xff, 0x7e, 0xb6, 255]);
  await shot(page, info, 'color-mode');

  // Clear asks first.
  await page.locator('[data-act=clear]').tap();
  await expect(page.locator('.ask')).toBeVisible();
  await bigTargets(page, '.ask');
  await shot(page, info, 'clear-ask');
  await page.locator('.ask .no').tap();
  expect(await pixel(page, '#color', [500, 330])).toEqual([0xff, 0xd2, 0x1f, 255]);

  await page.locator('[data-act=done]').tap();
  await expect(page.locator('.party canvas')).toHaveCount(1); // confetti
  await expect(page.locator('.party svg')).toBeVisible(); // star
  await page.waitForTimeout(800);
  await shot(page, info, 'celebration');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.card[data-id=face]')).toHaveClass(/done/);
  await expect(page.locator('.card[data-id=face] .score svg.got')).toHaveCount(3); // traced closely: three stars
  await expect(page.locator('.card.done')).toHaveCount(1);

  await page.locator('#togallery').tap();
  await expect(page.locator('.pic')).toHaveCount(1);
  expect(await nonWhite(page, '.pic img')).toBeGreaterThan(50_000);
  await bigTargets(page, '#gallery');
  await shot(page, info, 'gallery');
  await page.locator('.pic').tap();
  await expect(page.locator('#view')).toBeVisible();
  const vp = page.viewportSize()!, img = (await page.locator('#vimg').boundingBox())!;
  expect(img.width * img.height).toBeGreaterThan(vp.width * vp.height * 0.5);
  await bigTargets(page, '#view');
  await shot(page, info, 'fullscreen');

  await page.locator('#vbar .share').tap();
  const shared = await page.evaluate(async () => Promise.all((window as any).__shared.map(async (f: File) =>
    ({ name: f.name, type: f.type, magic: [...new Uint8Array(await f.slice(0, 4).arrayBuffer())] }))));
  expect(shared).toHaveLength(1);
  expect(shared[0]).toMatchObject({ type: 'image/png', name: expect.stringMatching(/_face_\d+\.png$/), magic: [0x89, 0x50, 0x4e, 0x47] });

  await page.locator('#vbar .del').tap();
  await expect(page.locator('.ask')).toBeVisible();
  await page.locator('.ask .yes').tap();
  await expect(page.locator('#view')).toBeHidden();
  await expect(page.locator('.pic')).toHaveCount(0);
  await expect(page.locator('#empty')).toBeVisible();
});

test('free draw: paint, Done, saved to the gallery', async ({ page }, info) => {
  await page.goto('./');
  await page.locator('#tofree').tap();
  await expect(page.locator('#paint')).toBeVisible();
  await bigTargets(page, '#free');
  await page.locator('.crayon[aria-label=green]').tap();
  await touchStroke(page, Array.from({ length: 50 }, (_, i): P => [500 + 300 * Math.cos(i / 7.5), 500 + 300 * Math.sin(i / 7.5)]));
  await page.locator('.crayon[aria-label=orange]').tap();
  await page.locator('[data-tool=fill]').tap();
  await tapAt(page, [500, 500]);
  expect(await pixel(page, '#paint', [500, 500])).toEqual([0xff, 0x8a, 0x1f, 255]);
  await shot(page, info, 'free-draw');
  await page.locator('[data-act=done]').tap();
  await expect(page.locator('.party')).toBeVisible();
  await expect(page.locator('#menu')).toBeVisible({ timeout: 5000 });
  await page.locator('#togallery').tap();
  await expect(page.locator('.pic')).toHaveCount(1);
  expect(await nonWhite(page, '.pic img')).toBeGreaterThan(50_000);
});

test('parent area: a 3-second finger hold on the logo opens it; every control is big', async ({ page }, info) => {
  await page.goto('./');
  await holdLogo(page, 1500);
  await expect(page.locator('#parent')).toBeHidden();
  await holdLogo(page, 3300);
  await expect(page.locator('#parent')).toBeVisible();
  await bigTargets(page, '#parent');
  await shot(page, info, 'parent');
  await page.locator('#pclose').tap();
  await expect(page.locator('#parent')).toBeHidden();
});

test('offline: after the first load, a shortened journey works with no network at all', async ({ page, context }, info) => {
  const origin = new URL(info.project.use.baseURL!).origin;
  const external: string[] = [], failed: string[] = [];
  context.on('request', (r) => { if (new URL(r.url()).origin !== origin) external.push(r.url()); });
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const face = (await lessonsOf(page)).find((l) => l.id === 'face')!;

  await context.setOffline(true);
  context.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  await page.reload();
  await page.locator('.card[data-id=face]').tap();
  await traceToColor(page, face);
  await page.locator('[data-tool=fill]').tap();
  await tapAt(page, [500, 330]);
  expect(await pixel(page, '#color', [500, 330])).toEqual([0xe8, 0x40, 0x2a, 255]);
  await page.locator('[data-act=done]').tap();
  await expect(page.locator('#menu')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.card[data-id=face]')).toHaveClass(/done/);
  await page.locator('#togallery').tap();
  await expect(page.locator('.pic')).toHaveCount(1);
  expect(await nonWhite(page, '.pic img')).toBeGreaterThan(50_000);
  expect(external).toEqual([]);
  expect(failed).toEqual([]);
});

test('rotation mid-lesson: ink survives, layout intact, new strokes land under the finger', async ({ page }, info) => {
  await page.goto('./');
  await page.locator('.card[data-id=cat]').tap();
  await page.locator('#next').tap();
  await touchStroke(page, line([200, 300], [800, 300]));
  let before = await ink(page);
  const top = await ink(page, [0, 0, 1000, 550]);
  const vp = page.viewportSize()!;
  for (const [k, size] of [{ width: vp.height, height: vp.width }, vp].entries()) {
    await page.setViewportSize(size);
    await page.waitForTimeout(150);
    expect(await ink(page)).toBe(before);
    const sheet = (await page.locator('#sheet').boundingBox())!;
    expect(Math.min(sheet.width, sheet.height)).toBeGreaterThan(Math.min(size.width, size.height) * 0.75);
    await bigTargets(page, '#lesson');
    for (const b of await page.locator('#lesson button:visible').all()) {
      const r = (await b.boundingBox())!;
      expect(r.x < sheet.x + sheet.width && sheet.x < r.x + r.width && r.y < sheet.y + sheet.height && sheet.y < r.y + r.height,
        `${await b.getAttribute('aria-label')} overlaps the canvas`).toBe(false);
    }
    expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight)).toBe(true);
    // A stroke at a known spot of the sheet's on-screen square: ink appears exactly there and nowhere else.
    const y = 600 + k * 200;
    await touchStroke(page, line([300, y], [700, y]));
    expect(await ink(page, [300, y - 10, 700, y + 10])).toBeGreaterThan(1000);
    expect(await ink(page, [0, 0, 1000, 550])).toBe(top);
    before = await ink(page);
    await shot(page, info, `rotated-${k}`);
  }
});
