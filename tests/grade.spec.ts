// Grading UI (#21): step reactions on the dots, the result overlay, best scores on the home cards, tones.
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { ink, touchStroke, type P } from './helpers';
import cloud from '../lessons/cloud.json' with { type: 'json' };

const N = cloud.steps.length; // 5 steps, so tracing 3 of them is 60% coverage
const OUT = 'review/grading'; // Playwright creates it

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
    // A silent AudioContext that records what it is asked to play.
    w.__audio = { contexts: 0, notes: [] as number[] };
    const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
    const node = () => ({ connect: (n: unknown) => n });
    w.AudioContext = class {
      currentTime = 0; state = 'running'; destination = {};
      constructor() { w.__audio.contexts++; }
      resume() { return Promise.resolve(); }
      createGain() { return { ...node(), gain: param() }; }
      createOscillator() {
        const o = { ...node(), type: 'sine', frequency: param(), start() { w.__audio.notes.push(o.frequency.value); }, stop() {} };
        return o;
      }
    };
  });
});
test.afterEach(() => expect(errors).toEqual([]));

const shot = (page: Page, info: TestInfo, name: string) => page.screenshot({ path: `${OUT}/${name}-${info.project.name}.png` });
const audio = (page: Page) => page.evaluate(() => (window as any).__audio as { contexts: number; notes: number[] });
const dot = (page: Page, i: number) => page.locator('#dots i').nth(i);
const reactions = (page: Page) => page.locator('#dots i').evaluateAll((ds) => ds.map((d) => (d as HTMLElement).dataset.r ?? ''));

/** Logical points every `gap` units along a lesson path. */
const sample = (page: Page, d: string, gap = 12) => page.evaluate(([d, gap]) => {
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d as string);
  const L = p.getTotalLength(), n = Math.max(4, Math.ceil(L / (gap as number)));
  return Array.from({ length: n + 1 }, (_, i) => { const q = p.getPointAtLength((L * i) / n); return [q.x, q.y] as P; });
}, [d, gap] as const);
const traceStep = async (page: Page, i: number) => { for (const d of cloud.steps[i].strokes) await touchStroke(page, await sample(page, d)); };

/** A fresh page load each time (a hash-only goto would be a same-page navigation). */
const load = async (page: Page, url: string) => { await page.goto('about:blank'); await page.goto(url); };
const open = async (page: Page, id = 'cloud') => {
  await load(page, `./#lesson/${id}`);
  await expect(page.locator('#ink')).toBeVisible();
};
/** Open cloud, trace the steps `keep` says, tapping Next after each, up to the result overlay. */
async function play(page: Page, keep: (i: number) => boolean) {
  await open(page);
  for (let i = 0; i < N; i++) {
    if (keep(i)) await traceStep(page, i);
    await page.locator('#next').tap();
  }
  await expect(page.locator('.result')).toBeVisible();
}
const result = async (page: Page) => ({
  stars: await page.locator('.rstars svg.got').count(),
  percent: parseInt((await page.locator('.result .pct').textContent())!),
});
const best = (page: Page) => page.evaluate(async () => (await import('/src/store.ts' as string)).getScores());
const card = (page: Page, id: string) => page.locator(`.card[data-id=${id}]`);
const cardScore = async (page: Page, id: string) => ({
  got: await card(page, id).locator('.score svg.got').count(),
  all: await card(page, id).locator('.score svg').count(),
  pct: await card(page, id).locator('.score b').count() ? await card(page, id).locator('.score b').textContent() : null,
});

test('tracing every step closely: great on every dot, three stars and 90%+, the crayon goes to Color mode', async ({ page }, info) => {
  await play(page, () => true);
  expect(await reactions(page)).toEqual(Array(N).fill('great'));
  const r = await result(page);
  expect(r.stars).toBe(3);
  expect(r.percent).toBeGreaterThanOrEqual(90);
  await expect(page.locator('.rstars svg')).toHaveCount(6); // three hollow, three gold on top
  expect((await page.evaluate(() => (window as any).__said)).at(-1)).toMatch(/three stars/i);
  const go = (await page.locator('.result .go').boundingBox())!;
  expect(Math.min(go.width, go.height)).toBeGreaterThanOrEqual(64);
  await page.waitForTimeout(1800); // stars landed
  await shot(page, info, 'result-3');
  await page.locator('.result .go').tap();
  await expect(page.locator('.result')).toHaveCount(0);
  await expect(page.locator('#lesson')).toHaveAttribute('data-phase', 'color');
  await expect.poll(async () => (await best(page)).cloud).toEqual({ percent: r.percent, stars: 3 });
});

test('tracing some steps: fewer stars, a lower percent, untraced dots stay hollow (try)', async ({ page }, info) => {
  await play(page, (i) => i < 3);
  expect(await reactions(page)).toEqual(['great', 'great', 'great', 'try', 'try']);
  const r = await result(page);
  expect(r.stars).toBe(2);
  expect(r.percent).toBeGreaterThan(40);
  expect(r.percent).toBeLessThan(85);
  await page.waitForTimeout(1800);
  await shot(page, info, 'result-2');
  await page.locator('.result').tap({ position: { x: 20, y: 20 } }); // anywhere continues too
  await expect(page.locator('#lesson')).toHaveAttribute('data-phase', 'color');

  await play(page, (i) => i === 0);
  const one = await result(page);
  expect(one.stars).toBe(1);
  expect(one.percent).toBeLessThan(r.percent);
  await page.waitForTimeout(1800);
  await shot(page, info, 'result-1');
});

test('an empty lesson: one star and 0, with encouragement', async ({ page }) => {
  await play(page, () => false);
  expect(await reactions(page)).toEqual(Array(N).fill('try'));
  expect(await result(page)).toEqual({ stars: 1, percent: 0 });
  expect((await page.evaluate(() => (window as any).__said)).at(-1)).toMatch(/nice try/i);
});

test('a stray tap right after the checkmark does not skip the result', async ({ page }) => {
  await play(page, () => false);
  await page.locator('.result').tap({ position: { x: 20, y: 20 } }); // a double-tap's second tap
  await expect(page.locator('.result')).toBeVisible();
});

test('undo removes the stroke from the score; the reaction never blocks Next', async ({ page }) => {
  await open(page);
  await traceStep(page, 0);
  await page.locator('#undo').tap();
  await expect.poll(() => ink(page)).toBe(0);
  await page.locator('#undo').tap(); // undo with an empty history is harmless
  await page.locator('#next').tap();
  await expect(dot(page, 0)).toHaveAttribute('data-r', 'try');
  // Not blocked: the next step is up at once, while the reaction is still showing.
  await expect(dot(page, 1)).toHaveClass('on');
  await traceStep(page, 1);
  await page.locator('#next').tap();
  await expect(dot(page, 1)).toHaveAttribute('data-r', 'great');
  await expect(dot(page, 1).locator('.pop')).toHaveCount(1);
  await page.locator('#next').tap(); // a quick second tap goes straight on
  await expect(dot(page, 3)).toHaveClass('on');
  expect(await page.locator('#guide path.now').count()).toBe(cloud.steps[3].strokes.length);
  // Back to step 1 and fix it: tracing step 0 now, Next re-grades it.
  for (let i = 0; i < 3; i++) await page.locator('#prev').tap();
  await traceStep(page, 0);
  await page.locator('#next').tap();
  await expect(dot(page, 0)).toHaveAttribute('data-r', 'great');
});

test('each reaction looks and sounds different; nothing reads as failure', async ({ page }, info) => {
  await open(page);
  await expect.poll(() => page.locator('#lesson').getAttribute('data-phase')).toBe('guide');
  const notes = async () => (await audio(page)).notes.length;
  // good: about 60% of the cloud outline
  const pts = await sample(page, cloud.steps[0].strokes[0]);
  await touchStroke(page, pts.slice(0, Math.round(pts.length * 0.6)));
  let n = await notes();
  await page.locator('#next').tap();
  await expect(dot(page, 0)).toHaveAttribute('data-r', 'good');
  expect((await audio(page)).notes.slice(n)).toEqual([880]); // one soft note
  await page.waitForTimeout(250);
  await shot(page, info, 'react-good');
  // great
  await traceStep(page, 1);
  n = await notes();
  await page.locator('#next').tap();
  await expect(dot(page, 1)).toHaveAttribute('data-r', 'great');
  expect((await audio(page)).notes.slice(n)).toHaveLength(3); // a three-note chime
  await page.waitForTimeout(250);
  await shot(page, info, 'react-great');
  // try
  n = await notes();
  await page.locator('#next').tap();
  await expect(dot(page, 2)).toHaveAttribute('data-r', 'try');
  const low = (await audio(page)).notes.slice(n);
  expect(low).toHaveLength(1);
  expect(low[0]).toBeLessThan(400); // a soft low note
  await expect(dot(page, 2).locator('.pop')).toHaveCount(0);
  await page.waitForTimeout(250);
  await shot(page, info, 'react-try');
  expect((await audio(page)).contexts).toBe(1); // one context, created lazily in the first tap
  // the dots after a mixed lesson
  await traceStep(page, 3);
  await page.locator('#next').tap();
  await page.waitForTimeout(1300);
  await expect(page.locator('#dots .pop')).toHaveCount(0); // pops clean themselves up
  await page.locator('#dots').screenshot({ path: `${OUT}/dots-mixed-${info.project.name}.png` });
  await shot(page, info, 'dots-mixed');
});

test('muted: no AudioContext at all; and nothing throws without Web Audio', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(async () => (await import('/src/store.ts' as string)).setSetting('muted', true));
  await play(page, (i) => i < 2);
  await page.locator('.result .go').tap();
  expect(await audio(page)).toEqual({ contexts: 0, notes: [] });

  await page.evaluate(async () => (await import('/src/store.ts' as string)).setSetting('muted', false));
  await page.addInitScript(() => { delete (window as any).AudioContext; delete (window as any).webkitAudioContext; });
  await play(page, (i) => i < 2);
  expect(await page.evaluate(() => 'AudioContext' in window)).toBe(false);
  await page.locator('.result .go').tap();
  await expect(page.locator('#lesson')).toHaveAttribute('data-phase', 'color');
});

test('best score persists, shows on the home card, only ever goes up', async ({ page }) => {
  const home = async () => { await load(page, './'); await expect(card(page, 'cloud')).toBeVisible(); };
  await play(page, (i) => i < 3);
  const mid = await result(page);
  await expect.poll(async () => (await best(page)).cloud?.percent).toBe(mid.percent);
  await home();
  await expect(card(page, 'cloud').locator('.score')).toBeVisible();
  expect(await cardScore(page, 'cloud')).toEqual({ got: 2, all: 3, pct: `${mid.percent}%` });

  await play(page, () => false); // worse: no change
  await expect.poll(async () => (await best(page)).cloud?.percent).toBe(mid.percent);
  await home();
  await expect.poll(() => cardScore(page, 'cloud')).toEqual({ got: 2, all: 3, pct: `${mid.percent}%` });

  await play(page, () => true); // better: raised
  const top = await result(page);
  await expect.poll(async () => (await best(page)).cloud?.percent).toBe(top.percent);
  await home();
  await expect.poll(() => cardScore(page, 'cloud')).toEqual({ got: 3, all: 3, pct: `${top.percent}%` });
});

/** Long-press the logo to open the parent area. */
async function openParent(page: Page) {
  await page.locator('#logo').hover();
  await page.mouse.down();
  await page.waitForTimeout(3300);
  await page.mouse.up();
  await expect(page.locator('#parent')).toBeVisible();
}

test('home: scored, legacy-completed and untouched cards; reset clears scores; no orphan card; big targets', async ({ page }, info) => {
  await page.goto('./');
  await page.evaluate(async () => {
    const s = await import('/src/store.ts' as string);
    await s.saveScore('sun', { percent: 100, stars: 3 });
    await s.saveScore('fish', { percent: 72, stars: 2 });
    await s.saveScore('cat', { percent: 38, stars: 1 });
    await s.markCompleted('house'); // completed before scores existed
    await s.markCompleted('sun');
  });
  await page.reload();
  await expect(card(page, 'sun').locator('.score')).toBeVisible();
  expect(await cardScore(page, 'sun')).toEqual({ got: 3, all: 3, pct: '100%' });
  expect(await cardScore(page, 'fish')).toEqual({ got: 2, all: 3, pct: '72%' });
  expect(await cardScore(page, 'cat')).toEqual({ got: 1, all: 3, pct: '38%' });
  expect(await cardScore(page, 'house')).toEqual({ got: 1, all: 3, pct: null }); // nothing she earned disappears
  expect(await cardScore(page, 'cloud')).toEqual({ got: 0, all: 0, pct: null });
  await shot(page, info, 'home');

  // Level markers are crayons, not stars.
  for (const n of [1, 2, 3]) await expect(page.locator(`section.level[data-level="${n}"] h2 svg`)).toHaveCount(n);
  await expect(page.locator('section.level h2 svg.got, section.level h2 path[d^="m12 2.8"]')).toHaveCount(0);

  // 10 lessons per level fill whole rows: no row shorter than the others.
  for (const n of [1, 2, 3]) {
    const tops = await page.locator(`section.level[data-level="${n}"] .card`).evaluateAll((cs) => cs.map((c) => Math.round(c.getBoundingClientRect().top)));
    expect(tops).toHaveLength(10);
    const rows = [...new Set(tops)].map((t) => tops.filter((x) => x === t).length);
    expect(rows.length).toBeGreaterThan(1);
    expect(new Set(rows).size, `level ${n} rows ${rows}`).toBe(1);
  }
  for (const el of await page.locator('#menu a:visible, #menu button:visible').all()) {
    const r = (await el.boundingBox())!;
    expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(64);
  }
  await page.locator('section.level[data-level="2"]').scrollIntoViewIfNeeded();
  await shot(page, info, 'home-level2');

  await openParent(page);
  await page.locator('#preset').tap();
  await page.locator('.ask .yes').tap();
  await expect(page.locator('.card .score')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.card').first()).toBeVisible();
  await expect(page.locator('.card .score')).toHaveCount(0);
  expect(await best(page)).toEqual({});
});

test('copy mode grades freehand leniently', async ({ page }) => {
  await open(page);
  await page.locator('#mode').tap();
  // The outline drawn 45 units off to the side: too far for Trace, fine for a copy.
  const pts = (await sample(page, cloud.steps[0].strokes[0])).map(([x, y]) => [x + 45, y] as P);
  await touchStroke(page, pts);
  await page.locator('#next').tap();
  await expect(dot(page, 0)).toHaveAttribute('data-r', 'great');
  await page.locator('#mode').tap();
  await page.locator('#prev').tap();
  await page.locator('#next').tap();
  await expect(dot(page, 0)).not.toHaveAttribute('data-r', 'great');
});
