// On-screen instructions (#50): where the caption sits on every drawing screen at the five reference sizes, with the
// LONGEST prompt in the real lessons/ and path/ data (found at runtime) and a short one: fully on screen, clear of the
// canvas and every control, big enough, never cut off. The lesson's caption follows its steps. Screenshots go to
// review/captions/ (gitignored) for a visual check.
import { test, expect, type Page } from '@playwright/test';
import { line, touchStroke, usePath } from './helpers';

type X = { type: string; say?: string; strokes?: string[]; given?: string[]; lesson?: string; open?: boolean; hint?: boolean };
type Unit = { id: string; stops: { id: string; exercises: X[] }[] };
type Lesson = { id: string; steps: { say: string; strokes: string[] }[] };
const OUT = 'review/captions';
// Per project: the sizes it checks (the phone project also does the small phone and phone landscape).
const SIZES: Record<string, [number, number][]> = { portrait: [[1024, 1366]], landscape: [[1366, 1024]], phone: [[390, 844], [375, 667], [844, 390]] };
// px, after any shrink step (base 28 iPad, 21 / 19 phone). Tall phones in portrait have a 4-line box, so even the longest
// prompt stays near full size there; short phones and phone landscape (3 lines) may shrink further.
const MIN_FONT = { ipad: 22, tallPhone: 19, phone: 16 };
const SHORT = 'Trace the line.';

let errors: string[];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    const w = window as any;
    w.__said = [];
    w.__played = [];
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true, value: { speak() {}, cancel() {}, getVoices: () => [] }, // speech.ts records each line in __said
    });
  });
});
test.afterEach(() => expect(errors).toEqual([]));

/** The real curriculum and lessons, the longest spoken prompt in them, and the crown / mountains exercises from the report. */
async function data(page: Page) {
  const units = await (await page.request.get('./path.json')).json() as Unit[];
  const lessons = await (await page.request.get('./lessons.json')).json() as Lesson[];
  const says = [...units.flatMap((u) => u.stops.flatMap((s) => s.exercises.map((x) => x.say ?? ''))), ...lessons.flatMap((l) => l.steps.map((s) => s.say))];
  const longest = says.reduce((a, b) => (b.length > a.length ? b : a));
  const all = units.flatMap((u) => u.stops.flatMap((s) => s.exercises));
  const crown = all.find((x) => x.type === 'finish' && /crown is missing its points/i.test(x.say!))!;
  const mountains = all.find((x) => x.type === 'create' && /pointy mountains/i.test(x.say!))!;
  return { units, lessons, longest, crown, mountains };
}

/** A fixture path: one stop per exercise (so each opens straight away), every prompt `say`. */
function stops(say: string, crown: X, mountains: X): Unit[] {
  const exs: [string, X][] = [
    ['trace', { type: 'trace', say, strokes: ['M 200 500 L 800 500'] }],
    ['shape', { type: 'shape', say, strokes: ['M 200 600 L 320 400 L 440 600 L 560 400 L 680 600 L 800 400'] }],
    ['memory', { type: 'memory', say, strokes: ['M 500 250 L 500 750', 'M 250 500 L 750 500'] }],
    ['finish', { ...crown, say }],
    ['create', { type: 'create', say }],
    ['crown', crown], ['mountains', mountains],
  ];
  return [{ id: 'cap', stops: exs.map(([id, x]) => ({ id, title: id, sticker: '⭐', exercises: [x] })) } as Unit];
}

type Box = { x: number; y: number; width: number; height: number };
/** The caption of `scope`: inside the viewport, clear of the canvas, example, progress and every visible control, its
 *  font at least the minimum, nothing cut off; no horizontal scroll; every control 64px+ and clear of the canvas. */
async function capOk(page: Page, scope: '#stop' | '#lesson', label: string) {
  const vp = page.viewportSize()!, phone = Math.min(vp.width, vp.height) < 700;
  const r = await page.evaluate((scope) => {
    const box = (e: Element) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
    const c = document.querySelector(`${scope} .caption`)!, span = c.querySelector('span')!;
    const shown = (e: Element) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
    const others = [...document.querySelectorAll(`${scope} :is(button, #ssheet, #sheet, #sref, #ref, #sbar, #dots)`)].filter(shown)
      .map((e) => ({ name: e.id || (e as HTMLElement).ariaLabel || e.className, box: box(e), crayon: e.classList.contains('crayon'), button: e.tagName === 'BUTTON' }));
    return { cap: box(c), font: parseFloat(getComputedStyle(span).fontSize), sh: c.scrollHeight, ch: c.clientHeight, text: span.textContent,
      scroll: document.documentElement.scrollWidth, others };
  }, scope);
  const overlap = (a: Box, b: Box) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
  const c = r.cap;
  console.log(`${label}: caption ${Math.round(c.width)}x${Math.round(c.height)} font ${r.font}px; canvas ${Math.round(r.others.find((o) => /sheet/.test(o.name))!.box.width)}`);
  expect(r.scroll, `${label}: horizontal scroll`).toBeLessThanOrEqual(vp.width);
  expect(c.x >= -0.5 && c.y >= -0.5 && c.x + c.width <= vp.width + 0.5 && c.y + c.height <= vp.height + 0.5, `${label}: caption inside the screen`).toBe(true);
  const tall = vp.width < vp.height && vp.height >= 700 && !r.others.some((o) => o.crayon); // colour tools: 3 lines everywhere
  expect(r.font, `${label}: caption font`).toBeGreaterThanOrEqual(!phone ? MIN_FONT.ipad : tall ? MIN_FONT.tallPhone : MIN_FONT.phone);
  expect(r.sh, `${label}: caption cut off`).toBeLessThanOrEqual(r.ch);
  for (const o of r.others) {
    expect(overlap(c, o.box), `${label}: caption over ${o.name}`).toBe(false);
    if (!o.button) continue;
    expect(o.crayon ? o.box.height : Math.min(o.box.width, o.box.height), `${label}: ${o.name} size`).toBeGreaterThanOrEqual(64);
    const sheet = r.others.find((s) => /sheet/.test(s.name))!.box;
    expect(overlap(o.box, sheet), `${label}: ${o.name} over the canvas`).toBe(false);
  }
  return r.text;
}
const shot = (page: Page, name: string) => { const v = page.viewportSize()!; return page.screenshot({ path: `${OUT}/${name}-${v.width}x${v.height}.png` }); };

test('stop player: the caption fits every size with the longest prompt and a short one (trace, shape, memory, finish, create)', async ({ page }, info) => {
  test.setTimeout(240_000);
  const { longest, crown, mountains } = await data(page);
  for (const [w, h] of SIZES[info.project.name]) {
    await page.setViewportSize({ width: w, height: h });
    for (const [tag, say] of [['long', longest], ['short', SHORT]] as const) {
      await page.unrouteAll();
      await usePath(page, stops(say, crown, mountains));
      for (const kind of ['trace', 'shape', 'memory', 'finish', 'create']) {
        await page.goto('about:blank');
        await page.goto(`./#stop/cap/${kind}`);
        await expect(page.locator('#stop')).toHaveAttribute('data-kind', kind);
        await expect(page.locator('#scap span')).toHaveText(say);
        if (kind === 'memory') await page.waitForTimeout(1500); // the picture and its countdown are up
        if (kind === 'shape') await page.waitForTimeout(2200); // the example has drawn itself
        if (kind === 'finish') await page.waitForTimeout(500); // mid-glow
        if (kind === 'create' && tag === 'long') await shot(page, `stop-create-intro-${tag}`);
        if (kind === 'create') await expect(page.locator('.sintro')).toHaveCount(0, { timeout: 5000 });
        await capOk(page, '#stop', `${w}x${h} ${kind} ${tag}`);
        if (tag === 'long' || kind === 'create') await shot(page, `stop-${kind}-${tag}`);
      }
    }
    if (w !== 390) continue;
    // The owner's report (#50), at the size of his screenshots: the crown to finish, then the mountains to make.
    await page.unrouteAll();
    await usePath(page, stops(SHORT, crown, mountains));
    await page.goto('about:blank');
    await page.goto('./#stop/cap/crown');
    await expect(page.locator('#sguide .cue')).toHaveCount(1);
    await page.waitForTimeout(500);
    await shot(page, 'owner-crown-start');
    await expect(page.locator('#stop')).toHaveAttribute('data-phase', 'draw');
    await expect(page.locator('#sguide .cue')).toHaveCount(0, { timeout: 4000 });
    await shot(page, 'owner-crown');
    await page.goto('about:blank');
    await page.goto('./#stop/cap/mountains');
    await shot(page, 'owner-mountains-intro');
    await expect(page.locator('.sintro')).toHaveCount(0, { timeout: 5000 });
    await touchStroke(page, line([150, 800], [350, 300]));
    await shot(page, 'owner-mountains');
  }
});

test('lesson: the caption fits every size with the longest prompt and a short one, in Trace, Copy and Color mode', async ({ page }, info) => {
  test.setTimeout(240_000);
  const { longest, lessons } = await data(page);
  const cat = lessons.find((l) => l.id === 'cat')!;
  for (const [w, h] of SIZES[info.project.name]) {
    await page.setViewportSize({ width: w, height: h });
    for (const [tag, say] of [['long', longest], ['short', SHORT]] as const) {
      await page.unrouteAll();
      await page.route('**/lessons.json', (r) => r.fulfill({ json: lessons.map((l) => (l.id === 'cat' ? { ...l, steps: [{ ...l.steps[0], say }, ...l.steps.slice(1)] } : l)) }));
      await page.goto('about:blank');
      await page.goto('./#lesson/cat');
      await expect(page.locator('#lcap span')).toHaveText(say);
      await expect(page.locator('#lesson')).toHaveAttribute('data-phase', 'guide', { timeout: 5000 });
      await capOk(page, '#lesson', `${w}x${h} lesson trace ${tag}`);
      if (tag === 'long') await shot(page, 'lesson-trace-long');
      await page.locator('#mode').tap();
      await expect(page.locator('#lesson')).toHaveAttribute('data-phase', 'guide', { timeout: 5000 });
      await capOk(page, '#lesson', `${w}x${h} lesson copy ${tag}`);
      if (tag === 'long') await shot(page, 'lesson-copy-long');
      await page.locator('#mode').tap();
      if (tag === 'short') continue;
      for (let i = 0; i < cat.steps.length; i++) await page.locator('#next').tap();
      await expect(page.locator('.result .cheer')).toHaveText(/./);
      expect(await page.evaluate(() => (window as any).__said.at(-1))).toBe(await page.locator('.result .cheer').textContent());
      await page.waitForTimeout(1800);
      await shot(page, 'lesson-result');
      await page.locator('.result .go').tap();
      await expect(page.locator('#lesson')).toHaveAttribute('data-phase', 'color');
      await expect(page.locator('#lcap span')).toHaveText(await page.evaluate(() => (window as any).__said.at(-1)));
      await capOk(page, '#lesson', `${w}x${h} lesson color`);
      await shot(page, 'lesson-color');
    }
  }
});

test('lesson: the caption is the step\'s say at every step, on Next, Back and Replay, in Trace and Copy; a tap replays', async ({ page }) => {
  test.skip(test.info().project.name === 'landscape', 'logic: two projects are enough');
  const { lessons } = await data(page);
  const cat = lessons.find((l) => l.id === 'cat')!;
  await page.goto('./#lesson/cat');
  const cap = page.locator('#lcap span');
  for (const mode of ['trace', 'copy']) {
    if (mode === 'copy') { await page.locator('#mode').tap(); while (await page.locator('#prev').isEnabled()) await page.locator('#prev').tap(); }
    for (let i = 0; i < cat.steps.length; i++) {
      await expect(cap).toHaveText(cat.steps[i].say);
      if (i === 2) {
        await page.locator('#prev').tap();
        await expect(cap).toHaveText(cat.steps[1].say);
        await page.locator('#next').tap();
        await expect(cap).toHaveText(cat.steps[2].say);
        await page.locator('#replay').tap();
        await expect(cap).toHaveText(cat.steps[2].say);
        const n = await page.evaluate(() => (window as any).__said.length);
        await page.locator('#lcap').tap();
        expect(await page.evaluate((n) => (window as any).__said.slice(n), n)).toEqual([cat.steps[2].say]);
        await expect(page.locator('#lesson')).toHaveAttribute('data-phase', 'anim'); // the tap replays the step's drawing too
      }
      if (i < cat.steps.length - 1) await page.locator('#next').tap();
    }
  }
  await page.locator('#next').tap();
  await page.locator('.result .go').tap();
  await expect(page.locator('#lesson')).toHaveAttribute('data-phase', 'color');
  const line = await page.evaluate(() => (window as any).__said.at(-1));
  await expect(cap).toHaveText(line);
  await page.locator('#lcap').tap();
  expect(await page.evaluate(() => (window as any).__said.at(-1))).toBe(line);
});
