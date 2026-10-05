// End-to-end pass over the REAL curriculum (#39): the production build under /kids-drawing-app/, simulated touch.
// Plays every stop of path.json in order at iPad portrait, then samples stops at the other sizes, offline, the parent
// switches and the Library. "A decent child": strokes follow the exercise's own geometry (tests/path.spec.ts does the
// same on a fixture); a one-star first attempt is allowed one retry, and every retry is printed so the curriculum
// can be tuned. Timers and animations run 8x faster (init script) so 190 exercises fit in a few minutes.
import { test, expect, type Page } from '@playwright/test';
import { line, touchStroke, type P } from '../tests/helpers';

type X = { type: string; strokes?: string[]; lesson?: string };
type Stop = { id: string; title: string; sticker: string; exercises: X[] };
type Unit = { id: string; title: string; stops: Stop[] };
type Lesson = { id: string; difficulty: number; steps: { strokes: string[] }[] };

let errors: string[];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak() {}, cancel() {}, getVoices: () => [] } });
    const st = window.setTimeout.bind(window);
    window.setTimeout = ((f: TimerHandler, d = 0, ...a: unknown[]) => st(f, d >= 100 ? d / 8 : d, ...a)) as typeof setTimeout; // waits of 0.4 to 3 s
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, ...a: Parameters<Element['animate']>) {
      const an = animate.apply(this, a);
      an.playbackRate = 8;
      return an;
    };
  });
});
test.afterEach(() => expect(errors).toEqual([]));

const load = async (page: Page) => ({
  units: (await (await page.request.get('path.json')).json()) as Unit[],
  lessons: (await (await page.request.get('lessons.json')).json()) as Lesson[],
});
const keys = (units: Unit[]) => units.flatMap((u) => u.stops.map((s) => ({ key: `${u.id}/${s.id}`, stop: s })));
const node = (page: Page, key: string) => page.locator(`.stop[data-key="${key}"]`);
const states = (page: Page) => page.locator('.stop').evaluateAll((ns) => ns.map((n) => (n as HTMLElement).dataset.state));
const seg = (page: Page, i: number) => page.locator('#sbar i').nth(i);

const sample = (page: Page, d: string, gap = 20) => page.evaluate(([d, gap]) => {
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d as string);
  const L = p.getTotalLength(), n = Math.max(4, Math.ceil(L / (gap as number)));
  return Array.from({ length: n + 1 }, (_, i) => { const q = p.getPointAtLength((L * i) / n); return [q.x, q.y] as P; });
}, [d, gap] as const);
const clamp = (v: number) => Math.min(960, Math.max(40, v));
const smaller: (p: P) => P = ([x, y]) => [650 + (x - 500) * 0.45, 250 + (y - 500) * 0.45]; // a shape: smaller, top right
const nudged: (p: P) => P = ([x, y]) => [clamp(x + 25), clamp(y - 20)]; // from memory: close, not exact
const draw = async (page: Page, ds: string[], f?: (p: P) => P) => { for (const d of ds) await touchStroke(page, f ? (await sample(page, d)).map(f) : await sample(page, d)); };
const ready = (page: Page) => expect(page.locator('#stop')).toHaveAttribute('data-phase', 'draw', { timeout: 10_000 });
/** A segment's look: 'good' / 'great' / 'try', plus '+on' while it is still the current exercise (a retry is coming). */
const look = (page: Page, i: number) => seg(page, i).evaluate((s) => `${s.dataset.r ?? ''}${s.classList.contains('on') ? '+on' : ''}`);

type Report = { retried: string[]; weak: string[] };

/** Walk a `lesson` exercise's lesson: trace every stroke of every step, the result card, colour Done, back in the stop. */
async function playLesson(page: Page, lessons: Lesson[], id: string) {
  await page.locator('#sok').tap();
  await expect(page.locator('#lesson')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#lesson/${id}$`));
  for (const s of lessons.find((l) => l.id === id)!.steps) {
    await draw(page, s.strokes);
    await page.locator('#next').tap();
  }
  await expect(page.locator('.result')).toBeVisible();
  const stars = await page.locator('.result .rstars svg.got').count();
  await page.locator('.result .go').tap();
  await expect(page.locator('#lesson')).toHaveAttribute('data-phase', 'color');
  await page.locator('#tools [data-act=done]').tap();
  await expect(page).toHaveURL(/#stop\//, { timeout: 15_000 });
  return stars;
}

/** Play the open stop to its result card (not leaving it). Retries and weak results go into `rep`. */
async function playStop(page: Page, lessons: Lesson[], key: string, stop: Stop, rep: Report) {
  await expect(page.locator('#stop')).toBeVisible();
  await expect(page.locator('#sbar i')).toHaveCount(stop.exercises.length);
  for (const [i, x] of stop.exercises.entries()) {
    const where = `${key}#${i + 1} (${x.type})`;
    await expect(page.locator('#stop')).toHaveAttribute('data-kind', x.type);
    await expect(seg(page, i)).toHaveClass(/on/);
    if (x.type === 'create') {
      await ready(page);
      await touchStroke(page, line([200, 700], [500, 300]));
      await page.locator('#stools [data-act=done]').tap();
      await expect(seg(page, i)).toHaveAttribute('data-r', 'great', { timeout: 15_000 });
    } else if (x.type === 'lesson') {
      const stars = await playLesson(page, lessons, x.lesson!);
      if (stars < 2) rep.weak.push(`${where} lesson ${x.lesson}: ${stars} star`);
    } else {
      for (let attempt = 0; ; attempt++) {
        await ready(page);
        await draw(page, x.strokes!, x.type === 'shape' ? smaller : x.type === 'memory' ? nudged : undefined);
        await page.locator('#sok').tap();
        // Outcome: still the current segment with a 'try' look is the retry; otherwise the exercise is done.
        await expect.poll(() => look(page, i), { timeout: 10_000 }).toMatch(/^(good|great|try)(\+on)?$/);
        const r = await look(page, i);
        if (r === 'try+on') { rep.retried.push(where); expect(attempt, `${where} retried more than once`).toBe(0); continue; }
        if (r === 'try') rep.weak.push(`${where}: one star twice`);
        break;
      }
    }
    if (i < stop.exercises.length - 1) await expect(seg(page, i + 1)).toHaveClass(/on/, { timeout: 10_000 });
  }
  await expect(page.locator('.result')).toBeVisible();
  await expect(page.locator('.result .sticker')).toHaveText(stop.sticker);
}

/** Every visible control of `scope` lies inside the viewport (`vertical` false: only sideways, for scrollers). */
async function inside(page: Page, scope: string, vertical = true) {
  const vp = page.viewportSize()!;
  for (const el of await page.locator(`${scope} :is(button, a, label):visible`).all()) {
    const r = (await el.boundingBox())!, name = `${scope} ${await el.getAttribute('aria-label') ?? await el.textContent()}`;
    expect(r.x >= -0.5 && r.x + r.width <= vp.width + 0.5, `${name} inside sideways`).toBe(true);
    if (vertical) expect(r.y >= -0.5 && r.y + r.height <= vp.height + 0.5, `${name} inside vertically`).toBe(true);
  }
}
/** No horizontal scroll. The reaction star floating up from the last progress segment is transient and pokes past the
 *  right edge on a phone while it plays; measure once it is gone. */
const noSideScroll = async (page: Page) => {
  await expect(page.locator('#sbar .pop')).toHaveCount(0);
  expect(await page.evaluate(() => [document.documentElement, ...document.querySelectorAll<HTMLElement>('main:not([hidden])')]
    .filter((e) => e.scrollWidth > e.clientWidth).map((e) => `${e.tagName}#${e.id} ${e.scrollWidth} > ${e.clientWidth}`))).toEqual([]);
};

async function openParent(page: Page) {
  await page.locator('#logo').hover();
  await page.mouse.down();
  await page.waitForTimeout(3300);
  await page.mouse.up();
  await expect(page.locator('#parent')).toBeVisible();
}
const unlockAll = async (page: Page) => { await openParent(page); await page.locator('#punlock').tap(); await page.locator('#pclose').tap(); };
const settled = (page: Page) => expect(page.locator('#path')).not.toHaveAttribute('data-payoff', { timeout: 10_000 });
const book = async (page: Page) => { await page.locator('#tostickers').tap(); await expect(page.locator('#skbook .slot').first()).toBeVisible(); };

test('the whole path, stop by stop, in order (iPad portrait)', async ({ page }, info) => {
  test.skip(info.project.name !== 'portrait', 'the full walk runs once, at iPad portrait');
  test.setTimeout(1_800_000);
  const { units, lessons } = await load(page);
  const all = keys(units), rep: Report = { retried: [], weak: [] }, t0 = Date.now();
  await page.goto('./');
  await expect(page.locator('#path')).toBeVisible();
  for (const [n, { key, stop }] of all.entries()) {
    const st = await states(page);
    expect(st.slice(0, n), `${key}: earlier stops`).toEqual(Array(n).fill('done'));
    expect(st[n], `${key} is the current stop`).toBe('current');
    expect(st.slice(n + 1), `${key}: later stops`).toEqual(Array(all.length - n - 1).fill('locked'));
    await node(page, key).tap();
    await expect(page).toHaveURL(new RegExp(`#stop/${key}$`));
    await playStop(page, lessons, key, stop, rep);
    await page.locator('.result .go').tap();
    await expect(page.locator('#path')).toBeVisible();
    await settled(page);
    await expect(node(page, key)).toHaveAttribute('data-state', 'done');
    expect(await node(page, key).locator('.stars svg.got').count(), `${key} stars on the path`).toBeGreaterThanOrEqual(2);
    await expect(node(page, key).locator('.sticker')).toHaveText(stop.sticker);
    if (n + 1 < all.length) await expect(node(page, all[n + 1].key)).toHaveAttribute('data-state', 'current');
    await book(page);
    await expect(page.locator('#skbook .slot.got')).toHaveCount(n + 1);
    expect(await page.locator('#skbook .slot.got').allTextContents(), `${key} sticker in the book`).toContain(stop.sticker);
    await page.locator('#skhome').tap();
    await expect(page.locator('#path')).toBeVisible();
  }
  console.log(`full walk: ${all.length} stops in ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(`retried (${rep.retried.length}): ${rep.retried.join(', ') || 'none'}`);
  expect(await states(page)).toEqual(Array(all.length).fill('done'));
  await expect(page.locator('.stop[data-state=current]')).toHaveCount(0);
  await expect(page.locator('.trophy')).toHaveClass(/won/);
  await book(page);
  await expect(page.locator('#skbook .slot.got')).toHaveCount(all.length);
  await expect(page.locator('#skbook .slot:not(.got)')).toHaveCount(0);
  await expect(page.locator('#skcount')).toHaveAttribute('aria-label', `${all.length} of ${all.length} stickers`);
  await page.reload(); // progress survives
  await expect(page.locator('#skbook .slot.got')).toHaveCount(all.length);
  await page.goto('./');
  expect(await states(page)).toEqual(Array(all.length).fill('done'));
  await expect(page.locator('.trophy')).toHaveClass(/won/);
  expect(rep.weak, 'decent attempts that did not reach two stars').toEqual([]);
});

for (const [name, size] of [['landscape', { width: 1366, height: 1024 }], ['phone', { width: 390, height: 844 }]] as const) {
  test(`first stop of the first and of the last unit end to end, nothing overflows (${name})`, async ({ page }, info) => {
    test.skip(name === 'landscape' ? info.project.name !== 'landscape' : info.project.name !== 'portrait', 'one run per size');
    test.setTimeout(300_000);
    await page.setViewportSize(size);
    const { units, lessons } = await load(page);
    const lastUnit = units.at(-1)!, first = keys(units)[0], last = { key: `${lastUnit.id}/${lastUnit.stops[0].id}`, stop: lastUnit.stops[0] };
    const rep: Report = { retried: [], weak: [] };
    await page.goto('./');
    await expect(page.locator('#path')).toBeVisible();
    await noSideScroll(page);
    await inside(page, '#top');
    await inside(page, '#road', false);
    for (const [i, { key, stop }] of [first, last].entries()) {
      if (i) {
        await unlockAll(page);
        await expect(node(page, key)).toHaveAttribute('data-state', 'open');
      }
      await node(page, key).tap();
      await expect(page.locator('#stop')).toBeVisible();
      await ready(page);
      await noSideScroll(page);
      await inside(page, '#stop');
      await playStop(page, lessons, key, stop, rep);
      await noSideScroll(page);
      await inside(page, '.result');
      await page.locator('.result .go').tap();
      await expect(page.locator('#path')).toBeVisible();
      await settled(page);
      await expect(node(page, key)).toHaveAttribute('data-state', 'done');
      await noSideScroll(page);
      await inside(page, '#top');
      await inside(page, '#road', false);
    }
    await book(page);
    await expect(page.locator('#skbook .slot.got')).toHaveCount(2);
    await noSideScroll(page);
    await inside(page, '#skbar');
    await inside(page, '#skbook', false);
    console.log(`${name}: retried ${rep.retried.join(', ') || 'none'}`);
    expect(rep.weak).toEqual([]);
  });
}

test('offline: after the first load, reload offline and play one full stop; no request fails or leaves the origin', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'portrait', 'once is enough');
  test.setTimeout(300_000);
  const { units, lessons } = await load(page);
  const { key, stop } = keys(units)[0], rep: Report = { retried: [], weak: [] };
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  const failed: string[] = [], foreign: string[] = [], origin = new URL(page.url()).origin;
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('request', (r) => { if (!/^(data|blob):/.test(r.url()) && new URL(r.url()).origin !== origin) foreign.push(r.url()); });
  await page.reload();
  await expect(page.locator('#path')).toBeVisible();
  await node(page, key).tap();
  await playStop(page, lessons, key, stop, rep);
  await page.locator('.result .go').tap();
  await settled(page);
  await expect(node(page, key)).toHaveAttribute('data-state', 'done');
  expect(failed).toEqual([]);
  expect(foreign).toEqual([]);
  expect(rep.weak).toEqual([]);
});

test('parent controls on the real path: unlock all opens every stop, reset empties path and sticker book', async ({ page }) => {
  const { units, lessons } = await load(page);
  const all = keys(units), rep: Report = { retried: [], weak: [] };
  await page.goto('./');
  await expect(page.locator('#path')).toBeVisible();
  await node(page, all[0].key).tap();
  await playStop(page, lessons, all[0].key, all[0].stop, rep);
  await page.locator('.result .go').tap();
  await settled(page);
  await unlockAll(page);
  expect(await states(page)).toEqual(['done', 'current', ...Array(all.length - 2).fill('open')]);
  for (const { key } of [all[1], all.at(-1)!]) { // an unlocked stop really opens
    await node(page, key).tap();
    await expect(page).toHaveURL(new RegExp(`#stop/${key}$`));
    await page.locator('#sclose').tap();
    await expect(page.locator('#path')).toBeVisible();
  }
  await openParent(page);
  await page.locator('#preset').tap();
  await page.locator('.ask .yes').tap();
  await expect(page.locator('#pstatus')).toContainText('stickers removed');
  await page.locator('#pclose').tap();
  expect(await states(page)).toEqual(['current', ...Array(all.length - 1).fill('open')]); // unlock-all is a setting: it stays on
  await expect(page.locator('.stop[data-state=done]')).toHaveCount(0);
  await book(page);
  await expect(page.locator('#skbook .slot')).toHaveCount(all.length);
  await expect(page.locator('#skbook .slot.got')).toHaveCount(0);
});

test('Library still reaches every lesson: a card per lesson, one lesson per section opens', async ({ page }) => {
  const { lessons } = await load(page);
  await page.goto('./#library');
  await expect(page.locator('.card')).toHaveCount(lessons.length);
  const sections = await page.locator('section.level').count();
  expect(sections).toBeGreaterThanOrEqual(3);
  for (let s = 0; s < sections; s++) {
    await expect(page.locator('#menu')).toBeVisible();
    const card = page.locator('section.level').nth(s).locator('.card').first();
    const id = await card.getAttribute('data-id');
    await card.tap();
    await expect(page).toHaveURL(new RegExp(`#lesson/${id}$`));
    await expect(page.locator('#lesson')).toBeVisible();
    await page.locator('#home').tap();
    await expect(page.locator('#menu')).toBeVisible();
  }
});
