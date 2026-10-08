// Scenes (#53): the sample scene plays by touch with its part progress and part intros, the Library hides scenes (and
// shows them with its flag), a path `lesson` exercise plays a scene, and a 40-step scene fits every reference size.
// The build-side checks are in tests-offline/scenes.spec.ts. Screenshots go to review/scenes/ (gitignored).
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { line, touchStroke, usePath, type P } from './helpers';
import cat from '../lessons/cat.json' with { type: 'json' };

type Step = { say: string; strokes: string[]; part?: number };
type Scene = { id: string; steps: Step[]; parts: { title: string; say: string; from: number; to: number }[] };
const OUT = 'review/scenes';

let errors: string[];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    (window as any).__said = [];
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak() {}, cancel() {}, getVoices: () => [] } });
  });
});
test.afterEach(() => expect(errors).toEqual([]));

const said = (page: Page) => page.evaluate(() => (window as any).__said as string[]);
const capText = (page: Page) => page.locator('#lcap span').textContent();
const phase = (page: Page) => page.locator('#lesson').getAttribute('data-phase');
const shot = (page: Page, info: TestInfo, name: string) => page.screenshot({ path: `${OUT}/${name}-${info.project.name}.png` });
const surf = async (page: Page) => ((await (await page.request.get('./lessons.json')).json()) as Scene[]).find((l) => l.id === 'stitch-surf')!;
/** Each part group's class ('' upcoming, now, done) and how many of its dots show. */
const groups = (page: Page) => page.locator('#dots > span').evaluateAll((gs) => gs.map((g) => [g.className, [...g.querySelectorAll('i')].filter((i) => i.getBoundingClientRect().width > 0).length]));
const sample = (page: Page, d: string, gap = 10) => page.evaluate(([d, gap]) => {
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d as string);
  const L = p.getTotalLength(), n = Math.max(4, Math.ceil(L / (gap as number)));
  return Array.from({ length: n + 1 }, (_, i) => { const q = p.getPointAtLength((L * i) / n); return [q.x, q.y] as P; });
}, [d, gap] as const);
const open = async (page: Page, id: string) => {
  await page.goto('about:blank');
  await page.goto(`./#lesson/${id}`);
  await expect(page.locator('#ink')).toBeVisible();
};

test('the sample scene: built with its parts, opened by its route; intros at part starts going forward only; progress per part', async ({ page }) => {
  test.setTimeout(90_000);
  const l = await surf(page);
  expect(l.parts.length).toBeGreaterThanOrEqual(2);
  expect(l.steps.length).toBe(l.parts.at(-1)!.to);
  const p1 = l.parts[1];
  await open(page, 'stitch-surf');
  // Opening: part 1's intro is said and shown first, then the first step's own line.
  await expect.poll(() => said(page)).toEqual([l.parts[0].say]);
  expect(await capText(page)).toBe(l.parts[0].say);
  await expect.poll(() => said(page), { timeout: 15_000 }).toEqual([l.parts[0].say, l.steps[0].say]);
  await expect.poll(() => capText(page)).toBe(l.steps[0].say);
  expect(await groups(page)).toEqual(l.parts.map((p, i) => [i ? '' : 'now', i ? 0 : p.to - p.from]));
  await expect(page.locator('#dots > span').first()).toHaveAttribute('aria-label', l.parts[0].title);
  await expect(page.locator('#dots > span.now i.on')).toHaveCount(1);
  await expect(page.locator('#dots .pill:visible')).toHaveCount(l.parts.length - 1);

  // Within a part: just the step's line.
  await page.evaluate(() => { (window as any).__said = []; });
  for (let i = 1; i < p1.from; i++) await page.locator('#next').tap();
  expect(await said(page)).toEqual(l.steps.slice(1, p1.from).map((s) => s.say));
  // Into part 2 going forward: its intro, then its first line; part 1 folds into a ticked pill.
  await page.evaluate(() => { (window as any).__said = []; });
  await page.locator('#next').tap();
  await expect.poll(() => capText(page)).toBe(p1.say);
  await expect.poll(() => said(page), { timeout: 15_000 }).toEqual([p1.say, l.steps[p1.from].say]);
  await expect.poll(() => capText(page)).toBe(l.steps[p1.from].say);
  expect(await groups(page)).toEqual(l.parts.map((p, i) => [i === 0 ? 'done' : i === 1 ? 'now' : '', i === 1 ? p.to - p.from : 0]));
  expect(await page.locator('#dots > span.now i').first().getAttribute('class')).toBe('on');
  // Back into part 1: no intro, part 1 opens again at its last dot.
  await page.evaluate(() => { (window as any).__said = []; });
  await page.locator('#prev').tap();
  expect(await said(page)).toEqual([l.steps[p1.from - 1].say]);
  expect(await capText(page)).toBe(l.steps[p1.from - 1].say);
  expect(await groups(page)).toEqual(l.parts.map((p, i) => [i ? '' : 'now', i ? 0 : p.to - p.from]));
  await page.waitForTimeout(500);
  expect(await said(page)).toEqual([l.steps[p1.from - 1].say]);
  // Replay mid-intro: the step's line (and caption), and the intro's follow-up never comes.
  await page.locator('#next').tap();
  await page.evaluate(() => { (window as any).__said = []; });
  await page.locator('#replay').tap();
  expect(await capText(page)).toBe(l.steps[p1.from].say);
  await page.waitForTimeout(6000);
  expect(await said(page)).toEqual([l.steps[p1.from].say]);
});

test('muted: no speech, the intro shows briefly and then the step line', async ({ page }) => {
  const l = await surf(page);
  await page.goto('./#library');
  await page.evaluate(async () => (await import('/src/store.ts' as string)).setSetting('muted', true));
  await open(page, 'stitch-surf');
  expect(await capText(page)).toBe(l.parts[0].say);
  await expect.poll(() => capText(page), { timeout: 15_000 }).toBe(l.steps[0].say);
  expect(await said(page)).toEqual([]);
});

test('the sample scene traced by touch, every step: three stars, Color mode, Done saves it to the gallery', async ({ page }, info) => {
  test.setTimeout(240_000);
  const l = await surf(page);
  await open(page, 'stitch-surf');
  const shots = new Map(l.parts.map((p, i) => [Math.min(p.to - 1, p.from + 1), i + 1])); // the 2nd step of each part
  for (let i = 0; i < l.steps.length; i++) {
    await expect(page.locator('#guide path.now')).toHaveCount(l.steps[i].strokes.length);
    await expect(page.locator('#guide path.gray')).toHaveCount(l.steps.slice(0, i).flatMap((s) => s.strokes).length);
    for (const d of l.steps[i].strokes) await touchStroke(page, await sample(page, d));
    if (shots.has(i)) {
      await expect.poll(() => phase(page)).toBe('guide');
      await shot(page, info, `part-${shots.get(i)}`);
    }
    await page.locator('#next').tap();
  }
  await expect(page.locator('.result .rstars svg.got')).toHaveCount(3);
  await page.waitForTimeout(1800);
  await shot(page, info, 'result');
  await page.locator('.result .go').tap();
  await expect(page.locator('#lesson')).toHaveAttribute('data-phase', 'color');
  await page.locator('[data-color="#4cc3ff"]').tap();
  await touchStroke(page, line([150, 900], [850, 900]));
  await shot(page, info, 'color');
  await page.locator('#tools [data-act=done]').tap();
  await expect(page.locator('#menu')).toBeVisible({ timeout: 5000 });
  const saved = await page.evaluate(async () => (await (await import('/src/store.ts' as string)).listDrawings()).map((d: { lessonId: string }) => d.lessonId));
  expect(saved).toEqual(['stitch-surf']);
  const best = await page.evaluate(async () => (await (await import('/src/store.ts' as string)).getScores())['stitch-surf']);
  expect(best.stars).toBe(3);
});

/** Serve the Library module with SHOW_SCENES set to `show`. */
const sceneFlag = (page: Page, show: boolean) => page.route('**/src/library.ts*', async (r) => {
  const body = (await (await r.fetch()).text()).replace('const SHOW_SCENES = false', `const SHOW_SCENES = ${show}`);
  expect(body).toContain(`const SHOW_SCENES = ${show}`);
  await r.fulfill({ body, contentType: 'text/javascript' });
});

test('Library: scenes are hidden; the route still opens one', async ({ page }) => {
  await sceneFlag(page, false);
  await page.goto('./#library');
  await expect(page.locator('section[data-level="3"] .card').first()).toBeVisible();
  await expect(page.locator('#menu > section')).toHaveCount(4);
  await expect(page.locator('.card[data-id=stitch-surf], section[data-category=scenes]')).toHaveCount(0);
  await page.goto('./#lesson/stitch-surf');
  await expect(page.locator('#lesson')).toBeVisible();
  await expect(page.locator('#dots > span')).not.toHaveCount(0);
});

test('Library: with SHOW_SCENES the scenes are a fifth section, after the characters, and open from there', async ({ page }) => {
  await sceneFlag(page, true);
  await page.goto('./#library');
  const sections = page.locator('#menu > section');
  await expect(sections).toHaveCount(5);
  await expect(sections.nth(4)).toHaveAttribute('data-category', 'scenes');
  await expect(sections.nth(3)).toHaveAttribute('data-category', 'characters');
  await expect(page.locator('section[data-category=scenes] .card[data-id=stitch-surf]')).toHaveCount(1);
  await expect(page.locator('section:not([data-category=scenes]) .card[data-id=stitch-surf]')).toHaveCount(0);
  await page.locator('.card[data-id=stitch-surf]').scrollIntoViewIfNeeded();
  await page.locator('.card[data-id=stitch-surf]').tap();
  await expect(page).toHaveURL(/#lesson\/stitch-surf$/);
  await expect(page.locator('#dots > span.now')).toHaveCount(1);
});

test('a path lesson exercise plays a scene and comes back to the stop', async ({ page }) => {
  const trace = { type: 'trace', say: 'Trace the line, all the way across.', strokes: ['M 200 500 L 800 500'] };
  await usePath(page, [{ id: 'beach', title: 'Beach', emoji: '🏖️', stops: [{ id: 'surf', title: 'Surf', sticker: '🏄', exercises: [{ type: 'lesson', lesson: 'stitch-surf' }, trace, trace] }] }]);
  await page.goto('./#stop/beach/surf');
  await expect(page.locator('#stop')).toHaveAttribute('data-kind', 'lesson');
  await expect(page.locator('#sguide .thumb')).not.toHaveCount(0);
  await page.locator('#sok').tap();
  await expect(page).toHaveURL(/#lesson\/stitch-surf$/);
  await expect(page.locator('#dots > span.now')).toHaveCount(1);
  await page.locator('#home').tap(); // nothing drawn: straight back
  await expect(page).toHaveURL(/#stop\/beach\/surf$/);
  await expect(page.locator('#stop')).toHaveAttribute('data-kind', 'lesson');
});

// The 40-step maximum: six parts, the first with the most steps a part may have (12), so its dots and five pills share a row.
const SIZES: Record<string, [number, number][]> = { portrait: [[1024, 1366]], landscape: [[1366, 1024]], phone: [[390, 844], [375, 667], [844, 390]] };
const BIG = (() => {
  const sizes = [12, 6, 6, 6, 5, 5], parts: Scene['parts'] = [], steps: Step[] = [];
  sizes.forEach((n, i) => {
    parts.push({ title: `Part ${i + 1}`, say: `Part ${i + 1} begins.`, from: steps.length, to: steps.length + n });
    for (let j = 0; j < n; j++) steps.push({ ...cat.steps[(steps.length) % cat.steps.length], part: i });
  });
  return { id: 'fx-big', title: 'Big scene', difficulty: 3, category: 'scenes', emoji: '🏖️', steps, parts };
})();

type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
/** Every lesson button's box, and the canvas, progress and its parts. */
const layout = (page: Page) => page.evaluate(() => {
  const box = (e: Element) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
  return {
    buttons: [...document.querySelectorAll('#lesson button')].map((b) => ({ id: b.id, ...box(b) })),
    sheet: box(document.querySelector('#sheet')!),
    dots: box(document.querySelector('#dots')!),
    shown: [...document.querySelectorAll('#dots i, #dots .pill')].filter((e) => e.getBoundingClientRect().width > 0).map(box),
    scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
  };
});

test('layout: the 40-step maximum fits every size; the controls are where an ordinary lesson has them', async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.route('**/lessons.json', async (r) => r.fulfill({ json: [...(await (await r.fetch()).json()), BIG] }));
  for (const [w, h] of SIZES[info.project.name]) {
    const where = `${w}x${h}`;
    await page.setViewportSize({ width: w, height: h });
    await open(page, 'cat');
    await expect.poll(() => phase(page)).toBe('guide');
    const plain = await layout(page);
    for (const at of [0, 12, 39]) { // the 12-dot part, then a later part, then the end
      await open(page, 'fx-big');
      for (let i = 0; i < at; i++) await page.locator('#next').tap();
      await expect.poll(() => phase(page)).toBe('guide');
      const s = await layout(page), label = `${where} step ${at + 1}`;
      if (at === 0) await page.screenshot({ path: `${OUT}/layout-40-${where}.png` });
      expect(s.shown.length, label).toBe(at === 0 ? 12 + 5 : at === 12 ? 6 + 5 : 5 + 5);
      expect(s.scroll, label).toEqual([w, h]); // nothing overflows the screen
      for (const b of s.shown) { // 4px: the current dot is drawn 1.35x, so it may poke past the row's edge
        expect(b.x >= s.dots.x - 4 && b.x + b.width <= s.dots.x + s.dots.width + 4, `${label}: a dot or pill outside the progress row ${JSON.stringify([b, s.dots])}`).toBe(true);
        expect(b.x >= 0 && b.x + b.width <= w && b.y >= 0 && b.y + b.height <= h, `${label}: progress on screen`).toBe(true);
      }
      expect(overlap(s.dots, s.sheet), `${label}: progress clear of the canvas`).toBe(false);
      expect(s.buttons.map((b) => b.id)).toEqual(plain.buttons.map((b) => b.id));
      for (const [i, b] of s.buttons.entries()) {
        expect([b.width, b.height], `${label}: ${b.id} size`).toEqual([plain.buttons[i].width, plain.buttons[i].height]);
        expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(64);
        expect(overlap(b, s.sheet) || overlap(b, s.dots), `${label}: ${b.id} clear of canvas and progress`).toBe(false);
        expect(b.x >= 0 && b.y >= 0 && b.x + b.width <= w && b.y + b.height <= h, `${label}: ${b.id} on screen`).toBe(true);
      }
    }
  }
});
