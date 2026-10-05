// Path home screen, unlocking, the payoff, the sticker book, the Library (#37). Every test that needs path data serves
// its own path.json (page.route), so nothing here depends on the curriculum in path/. Screenshots for review go to
// review/pathhome/ (gitignored).
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { lessons, line, touchStroke, usePath, type P } from './helpers';

type Ex = { type: string; say?: string; strokes?: string[]; lesson?: string };
type Unit = { id: string; title: string; emoji: string; stops: { id: string; title: string; sticker: string; exercises: Ex[] }[] };
const LINES: [P, P][] = [[[200, 500], [800, 500]], [[500, 200], [500, 800]], [[250, 250], [750, 750]]];
const TRACES: Ex[] = LINES.map(([a, b]) => ({ type: 'trace', say: 'Trace it.', strokes: [`M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}`] }));
const unit = (id: string, emoji: string, stickers: string[]): Unit => ({
  id, title: `Unit ${id}`, emoji,
  stops: stickers.map((sticker, i) => ({ id: `s${i + 1}`, title: `Stop ${id}${i + 1}`, sticker, exercises: TRACES })),
});
// Small: 3 units of 2 / 3 / 1 stops. Big (screenshots, long-path layout): 8 units of 4 stops.
const FIX = [unit('a', '🐣', ['🍎', '🍌']), unit('b', '🐟', ['🚗', '🚀', '🌈']), unit('c', '🦄', ['🎈'])];
const BIG = [
  unit('lines', '〰️', ['🌟', '⚡', '🌊', '🪜']), unit('circles', '⭕', ['🍩', '🌕', '🎯', '🫧']), unit('shapes', '🔺', ['🧀', '🍕', '💎', '⭐']),
  unit('faces', '😊', ['😺', '🐻', '🐸', '🤖']), unit('animals', '🐶', ['🐱', '🐰', '🦉', '🐢']), unit('nature', '🌳', ['🌸', '🍄', '🌈', '☀️']),
  unit('things', '🚀', ['🚗', '🏠', '🎈', '🧁']), unit('magic', '🦄', ['🐉', '🧜', '🏰', '👑']),
];
const keysOf = (units: Unit[]) => units.flatMap((u) => u.stops.map((s) => `${u.id}/${s.id}`));
const OUT = 'review/pathhome';

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

/** Mark stops done straight in the store (`stars` cycles over the keys), then reload so the path draws them. */
async function seed(page: Page, keys: string[], stars = [3]) {
  await page.evaluate(async ([keys, stars]) => {
    const s = await import('/src/store.ts' as string);
    for (const [i, k] of (keys as string[]).entries()) await s.savePathStop(k, (stars as number[])[i % (stars as number[]).length]);
  }, [keys, stars] as const);
  await page.reload();
}
const node = (page: Page, key: string) => page.locator(`.stop[data-key="${key}"]`);
const states = (page: Page) => page.locator('.stop').evaluateAll((ns) => ns.map((n) => (n as HTMLElement).dataset.state));
const progress = (page: Page) => page.evaluate(async () => (await import('/src/store.ts' as string)).getPathProgress());
async function openPath(page: Page, units: unknown = FIX) {
  await usePath(page, units);
  await page.goto('./');
  await expect(page.locator('#path')).toBeVisible();
}
const openParent = async (page: Page) => {
  await page.locator('#logo').hover();
  await page.mouse.down();
  await page.waitForTimeout(3300);
  await page.mouse.up();
  await expect(page.locator('#parent')).toBeVisible();
};
/** `el` lies fully inside the trail's visible box. */
const inView = async (page: Page, sel: string) => {
  const t = (await page.locator('#trail').boundingBox())!, b = (await page.locator(sel).boundingBox())!;
  return b.y >= t.y - 0.5 && b.y + b.height <= t.y + t.height + 0.5;
};

/** Play the open stop's trace exercises by touch: `good` traces each line, otherwise a stray scribble (twice: one retry). */
async function play(page: Page, good = true) {
  await expect(page.locator('#stop')).toBeVisible();
  for (let i = 0; i < LINES.length; i++) {
    const seg = page.locator('#sbar i').nth(i);
    for (let k = 0; k < (good ? 1 : 2); k++) {
      await expect(seg).toHaveClass(/on/);
      await expect(page.locator('#stop')).toHaveAttribute('data-phase', 'draw', { timeout: 10_000 });
      await touchStroke(page, good ? line(...LINES[i], 30) : line([100, 900], [130, 880]));
      await page.locator('#sok').tap();
    }
    await expect(seg).toHaveAttribute('data-r', good ? 'great' : 'try');
  }
  await expect(page.locator('.result')).toBeVisible({ timeout: 10_000 });
  await page.locator('.result .go').tap();
  await expect(page.locator('#path')).toBeVisible();
}

test('fresh profile: every stop, banners in order, only the first is current, locked ones shake and stay', async ({ page }) => {
  await openPath(page);
  await expect(page.locator('.unit')).toHaveText(FIX.map((u) => u.emoji));
  expect(await page.locator('.unit').evaluateAll((us) => us.map((u) => u.ariaLabel))).toEqual(FIX.map((u) => u.title));
  expect(await page.locator('.stop').evaluateAll((ns) => ns.map((n) => (n as HTMLElement).dataset.key))).toEqual(keysOf(FIX));
  expect(await states(page)).toEqual(['current', 'locked', 'locked', 'locked', 'locked', 'locked']);
  await expect(page.locator('.stop .sticker:not(:empty)')).toHaveCount(0); // nothing earned, nothing revealed
  await expect(page.locator('.trophy')).not.toHaveClass(/won/);
  expect(await inView(page, '.stop[data-state=current]')).toBe(true);
  for (const k of keysOf(FIX).slice(1)) {
    await node(page, k).scrollIntoViewIfNeeded();
    await node(page, k).tap();
    await expect(node(page, k)).toHaveClass(/shake/);
    expect(new URL(page.url()).hash).toBe('');
    await expect(page.locator('#stop')).toBeHidden();
  }
  await node(page, 'a/s1').scrollIntoViewIfNeeded();
  await node(page, 'a/s1').tap();
  await expect(page).toHaveURL(/#stop\/a\/s1$/);
  await expect(page.locator('#sbar i')).toHaveCount(3);
});

test('finishing the first stop: back to the path with the payoff, done with sticker and stars, next current, kept on reload; a worse replay changes nothing', async ({ page }) => {
  test.setTimeout(90_000);
  await openPath(page);
  await node(page, 'a/s1').tap();
  await play(page);
  await expect(page.locator('#path')).toHaveAttribute('data-payoff', '');
  await expect(page.locator('.flying')).toHaveText('🍎'); // the sticker flies to the sticker book
  await expect(page.locator('#path')).not.toHaveAttribute('data-payoff', { timeout: 3000 });
  await expect(page.locator('.flying')).toHaveCount(0);
  expect(await states(page)).toEqual(['done', 'current', 'locked', 'locked', 'locked', 'locked']);
  await expect(node(page, 'a/s1').locator('.sticker')).toHaveText('🍎');
  await expect(node(page, 'a/s1').locator('.stars svg.got')).toHaveCount(3);
  expect(await inView(page, '.stop[data-state=current]')).toBe(true);
  expect(await progress(page)).toEqual({ 'a/s1': { stars: 3 } });

  await page.reload();
  await expect(node(page, 'a/s1')).toHaveAttribute('data-state', 'done');
  await expect(node(page, 'a/s2')).toHaveAttribute('data-state', 'current');
  await page.waitForTimeout(300);
  await expect(page.locator('#path')).not.toHaveAttribute('data-payoff');

  // Replay the done stop badly: no payoff, the stars stay.
  await node(page, 'a/s1').tap();
  await play(page, false);
  await expect(node(page, 'a/s1')).toHaveAttribute('data-state', 'done');
  await page.waitForTimeout(300);
  await expect(page.locator('#path')).not.toHaveAttribute('data-payoff');
  await expect(page.locator('.flying')).toHaveCount(0);
  await expect(node(page, 'a/s1').locator('.stars svg.got')).toHaveCount(3);
  expect(await progress(page)).toEqual({ 'a/s1': { stars: 3 } });
});

test('the payoff is skipped by a tap, and is a plain state change with reduced motion', async ({ page }) => {
  test.setTimeout(60_000);
  await openPath(page);
  await node(page, 'a/s1').tap();
  await play(page);
  await expect(page.locator('#path')).toHaveAttribute('data-payoff', '');
  await page.locator('#trail').tap({ position: { x: 20, y: 20 } });
  await expect(page.locator('#path')).not.toHaveAttribute('data-payoff');
  expect(await states(page)).toEqual(['done', 'current', 'locked', 'locked', 'locked', 'locked']);
  await expect(page).toHaveURL(/\/(#)?$/); // the skipping tap went nowhere

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await node(page, 'a/s2').tap();
  await play(page);
  await expect(node(page, 'b/s1')).toHaveAttribute('data-state', 'current'); // last stop of a unit opens the next unit
  await expect(page.locator('#path')).not.toHaveAttribute('data-payoff');
  await expect(page.locator('.flying')).toHaveCount(0);
});

test('finishing the last stop of a unit unlocks the next unit; finishing every stop leaves no current stop and wins the trophy', async ({ page }) => {
  test.setTimeout(60_000);
  await openPath(page);
  await seed(page, ['a/s1']);
  await node(page, 'a/s2').tap();
  await play(page);
  await expect(page.locator('#path')).not.toHaveAttribute('data-payoff', { timeout: 3000 });
  expect(await states(page)).toEqual(['done', 'done', 'current', 'locked', 'locked', 'locked']);

  await seed(page, ['b/s1', 'b/s2', 'b/s3']);
  await expect(node(page, 'c/s1')).toHaveAttribute('data-state', 'current');
  await expect(page.locator('.trophy')).not.toHaveClass(/won/);
  await node(page, 'c/s1').tap();
  await play(page);
  await expect(page.locator('.trophy')).toHaveClass(/won/);
  await expect(page.locator('#path')).not.toHaveAttribute('data-payoff', { timeout: 3000 });
  expect(await states(page)).toEqual(Array(6).fill('done'));
  await expect(page.locator('.stop[data-state=current]')).toHaveCount(0);
  expect(await inView(page, '.trophy')).toBe(true);
});

test('parent area: unlock all opens every stop, off restores locking; reset clears done stops and stickers', async ({ page }) => {
  await openPath(page);
  await seed(page, ['a/s1']);
  await openParent(page);
  await expect(page.locator('#punlock')).toHaveAttribute('aria-checked', 'false');
  await page.locator('#punlock').tap();
  await expect(page.locator('#punlock')).toHaveAttribute('aria-checked', 'true');
  await page.locator('#pclose').tap();
  expect(await states(page)).toEqual(['done', 'current', 'open', 'open', 'open', 'open']);
  await page.reload(); // persisted
  await expect.poll(() => states(page)).toEqual(['done', 'current', 'open', 'open', 'open', 'open']); // the path draws after startup's loads
  await node(page, 'c/s1').scrollIntoViewIfNeeded();
  await node(page, 'c/s1').tap();
  await expect(page).toHaveURL(/#stop\/c\/s1$/);
  await page.locator('#sclose').tap();
  await expect(page.locator('#path')).toBeVisible();

  await openParent(page);
  await page.locator('#punlock').tap();
  await page.locator('#pclose').tap();
  expect(await states(page)).toEqual(['done', 'current', 'locked', 'locked', 'locked', 'locked']);

  await openParent(page);
  await page.locator('#preset').tap();
  await page.locator('.ask .yes').tap();
  await expect(page.locator('#pstatus')).toContainText('stickers removed');
  await page.locator('#pclose').tap();
  expect(await states(page)).toEqual(['current', 'locked', 'locked', 'locked', 'locked', 'locked']);
  await page.locator('#tostickers').tap();
  await expect(page.locator('.slot')).toHaveCount(6);
  await expect(page.locator('.slot.got')).toHaveCount(0);
});

test('sticker book: a slot per stop, earned ones show their sticker, the rest do not give it away', async ({ page }) => {
  await openPath(page);
  await seed(page, ['a/s1', 'b/s2']);
  await page.locator('#tostickers').tap();
  await expect(page).toHaveURL(/#stickers$/);
  await expect(page.locator('.slot')).toHaveCount(keysOf(FIX).length);
  await expect(page.locator('.skunit h2')).toHaveText(FIX.map((u) => u.emoji));
  await expect(page.locator('.slot.got')).toHaveText(['🍎', '🚀']);
  const unearned = FIX.flatMap((u) => u.stops.map((s) => s.sticker)).filter((s) => !['🍎', '🚀'].includes(s));
  const text = await page.locator('#skbook').textContent();
  for (const s of unearned) expect(text).not.toContain(s);
  await expect(page.locator('#skcount')).toHaveText('2/6');
  await page.locator('.slot.got').first().tap();
  await expect(page.locator('.slot.got').first()).toHaveClass(/wobble/);
  await page.locator('#skhome').tap();
  await expect(page.locator('#path')).toBeVisible();
});

test('Library: reached from the path, every lesson grouped as before; a lesson started there returns there, one inside a stop returns to the stop', async ({ page }) => {
  const withLesson = [{ ...FIX[0], stops: [{ ...FIX[0].stops[0], exercises: [{ type: 'lesson', lesson: 'sun' }, ...TRACES] }] }];
  await openPath(page, withLesson);
  await page.locator('#tolibrary').tap();
  await expect(page).toHaveURL(/#library$/);
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#path')).toBeHidden();
  const all = await lessons(page);
  await expect(page.locator('#menu .card')).toHaveCount(all.length);
  for (const n of [1, 2, 3]) await expect(page.locator(`section.level[data-level="${n}"] .card`)).toHaveCount(all.filter((l) => l.difficulty === n && !l.category).length);
  await page.locator('.card[data-id=cat]').tap();
  await expect(page.locator('#lesson')).toBeVisible();
  await page.locator('#home').tap(); // nothing drawn: straight back
  await expect(page).toHaveURL(/#library$/);
  await expect(page.locator('#menu')).toBeVisible();
  await page.locator('#lhome').tap();
  await expect(page.locator('#path')).toBeVisible();

  await node(page, 'a/s1').tap();
  await expect(page.locator('#stop')).toHaveAttribute('data-kind', 'lesson');
  await page.locator('#sok').tap();
  await expect(page).toHaveURL(/#lesson\/sun$/);
  await page.locator('#home').tap();
  await expect(page).toHaveURL(/#stop\/a\/s1$/);
  await expect(page.locator('#stop')).toBeVisible();
});

for (const [name, serve] of [['empty', (p: Page) => usePath(p, [])], ['missing', (p: Page) => p.route('**/path.json', (r) => r.fulfill({ status: 404, body: 'nope' }))]] as const) {
  test(`${name} path.json: the Library is home, with the home header`, async ({ page }) => {
    await serve(page);
    await page.goto('./');
    await expect(page.locator('#menu')).toBeVisible();
    await expect(page.locator('#path')).toBeHidden();
    await expect(page.locator('#menu #top #logo')).toBeVisible();
    await expect(page.locator('#tofree')).toBeVisible();
    await expect(page.locator('#togallery')).toBeVisible();
    await expect(page.locator('#tolibrary, #tostickers, #lhome')).toHaveCount(2); // the two path buttons stay, hidden
    await expect(page.locator('#tolibrary')).toBeHidden();
    await expect(page.locator('#tostickers')).toBeHidden();
    await page.goto('./#stickers');
    await expect(page.locator('#menu')).toBeVisible();
    await expect(page.locator('#stickers')).toBeHidden();
    errors = errors.filter((e) => !/Failed to load resource/.test(e)); // the 404 itself
  });
}

/** No horizontal scroll; every visible control on screen sideways and 64px+; outside the scroller also on screen vertically. */
async function fits(page: Page, scope: string) {
  const r = await page.evaluate((scope) => {
    const W = innerWidth, H = innerHeight, bad: string[] = [];
    for (const e of document.querySelectorAll<HTMLElement>(`${scope} :is(button, a[href], .slot)`)) {
      const b = e.getBoundingClientRect();
      if (!b.width || !e.checkVisibility()) continue;
      const name = `${e.id || e.className} ${e.ariaLabel ?? ''}`;
      if (Math.min(b.width, b.height) < 64) bad.push(`${name}: ${b.width}x${b.height}`);
      if (b.left < -0.5 || b.right > W + 0.5) bad.push(`${name}: x ${b.left}..${b.right} of ${W}`);
      if (!e.closest('.scroll') && (b.top < -0.5 || b.bottom > H + 0.5)) bad.push(`${name}: y ${b.top}..${b.bottom} of ${H}`);
    }
    const over = [document.documentElement, ...document.querySelectorAll<HTMLElement>('main:not([hidden]), .scroll')].filter((e) => e.scrollWidth > e.clientWidth + 0.5);
    return { bad, over: over.map((e) => e.id || e.tagName) };
  }, scope);
  expect(r.over, 'horizontal scroll').toEqual([]);
  expect(r.bad).toEqual([]);
}

async function layout(page: Page) {
  await openPath(page, BIG);
  const all = keysOf(BIG);
  await fits(page, '#path');
  for (const b of await page.locator('#top > *').all()) expect((await b.boundingBox())!.y + (await b.boundingBox())!.height).toBeLessThan(150); // one header row
  // Mid-way: the current stop (deep in the path) is in view on open.
  await seed(page, all.slice(0, 17), [3, 2, 3, 1]);
  expect(await inView(page, '.stop[data-state=current]')).toBe(true);
  await expect(page.locator('.stop[data-state=current]')).toHaveAttribute('data-key', all[17]);
  await fits(page, '#path');
  const header = (await page.locator('#top').boundingBox())!;
  expect(header.y).toBeGreaterThanOrEqual(0);
  // The trail scrolls by touch, the header stays put.
  const t = (await page.locator('#trail').boundingBox())!, before = await page.locator('#trail').evaluate((e) => e.scrollTop);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', y: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: t.x + 12, y, id: 1 }] });
  await touch('touchStart', t.y + t.height * 0.2);
  for (let y = t.y + t.height * 0.2; y <= t.y + t.height * 0.8; y += 20) await touch('touchMove', y);
  await touch('touchEnd', 0);
  await expect.poll(() => page.locator('#trail').evaluate((e) => e.scrollTop)).toBeLessThan(before - 50);
  expect((await page.locator('#top').boundingBox())!.y).toBe(header.y);
  await page.locator('#tostickers').tap();
  await expect(page.locator('.slot.got')).toHaveCount(17);
  await fits(page, '#stickers');
  await page.locator('#skhome').tap();
  await page.locator('#tolibrary').tap();
  await fits(page, '#menu');
}

test('layout: the path, sticker book and Library fit, 64px+ targets, the trail scrolls by touch, current stop in view', async ({ page }) => {
  await layout(page);
});

test('layout, phone landscape (844 x 390)', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone only');
  await page.setViewportSize({ width: 844, height: 390 });
  await layout(page);
});

// ---- Review screenshots (review/pathhome/), with the real path/ data and the big fixture. ----
const shot = async (page: Page, info: TestInfo, name: string, size?: { width: number; height: number }) => {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${OUT}/${name}-${size ? `${size.width}x${size.height}` : info.project.name}.png` });
};

test('review screenshots', async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.goto('./'); // the real path/ data at the start
  await expect(page.locator('.stop[data-state=current]')).toBeVisible();
  await shot(page, info, '01-path-real-start');
  await page.unrouteAll();
  await openPath(page, BIG);
  await shot(page, info, '02-path-start');
  const all = keysOf(BIG);
  await seed(page, all.slice(0, 13), [3, 2, 3, 1, 3]);
  await expect(page.locator('.stop[data-state=current]')).toBeVisible();
  await page.waitForTimeout(300);
  await shot(page, info, '03-path-midway');
  if (info.project.name === 'phone') {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.reload();
    await page.waitForTimeout(300);
    await shot(page, info, '03-path-midway', { width: 844, height: 390 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
  }
  await page.locator('.stop[data-state=current]').tap();
  await play(page);
  await expect(page.locator('.flying')).toHaveCount(1);
  await page.locator('.flying').evaluate((f) => f.getAnimations().forEach((a) => a.pause())); // hold it mid-flight for the shot
  await page.locator('.flying').evaluate((f) => f.getAnimations().forEach((a) => { a.currentTime = 300; }));
  await shot(page, info, '04-payoff-fly');
  await page.locator('.flying').evaluate((f) => f.getAnimations().forEach((a) => a.play()));
  await expect(page.locator('.stop.pop')).not.toHaveCount(0);
  await page.waitForTimeout(150);
  await shot(page, info, '05-payoff-unlock');
  await expect(page.locator('#path')).not.toHaveAttribute('data-payoff');
  await page.locator('#tostickers').tap();
  await expect(page.locator('.slot.got')).toHaveCount(14);
  await shot(page, info, '06-stickers');
  await page.goto('./#library');
  await expect(page.locator('#menu .card').first()).toBeVisible();
  await shot(page, info, '07-library');
  await seed(page, all.slice(13), [3, 2]);
  await page.goto('./');
  await expect(page.locator('.trophy')).toHaveClass(/won/);
  await page.waitForTimeout(300);
  await shot(page, info, '08-path-end');
  await openParent(page);
  await page.locator('#punlock').tap();
  await shot(page, info, '09-parent');
});
