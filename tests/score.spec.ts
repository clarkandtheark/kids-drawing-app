// Tracing score engine (src/score.ts) against synthetic ink on the real cat lesson, plus the Surface onStroke hook.
import { test, expect, type Page } from '@playwright/test';
import { line, touchStroke } from './helpers';
import cat from '../lessons/cat.json' with { type: 'json' };

type Case = 'perfect' | 'wobbly' | 'sloppy' | 'half' | 'skipOne' | 'scribble' | 'doodle' | 'empty';
type Result = { steps: number[]; precision: number; percent: number; stars: number; reactions: string[]; ms: number };

/** Build synthetic ink for `name` in the page (seeded, deterministic) and score it. */
const run = (page: Page, name: Case, tolerance?: number) => page.evaluate(async ({ name, tolerance, d }) => {
  const { samplePath, score, reaction } = await import('/src/score.ts' as string);
  type Pt = { x: number; y: number };
  let seed = 20;
  const rand = () => { // mulberry32
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const guide: Pt[][][] = d.map((step) => step.map((s) => samplePath(s)));
  // Every `every`-th guide point (plus the last), pushed sideways off the line by a smooth drift: a random
  // offset of noise/2..noise units every 3 input points, blended in between, like a hand wandering off the guide.
  const trace = (s: Pt[], noise: number, every: number) => {
    const knot = () => (rand() < 0.5 ? -1 : 1) * (0.5 + rand() / 2) * noise; // half to full noise, either side
    let k0 = knot(), k1 = knot();
    return s.flatMap((p, j) => (j % every === 0 || j === s.length - 1 ? [j] : [])).map((j, i) => {
      if (i % 3 === 0 && i) { k0 = k1; k1 = knot(); }
      const o = k0 + ((k1 - k0) * (i % 3)) / 3;
      const a = s[Math.max(0, j - 1)], b = s[Math.min(s.length - 1, j + 1)], len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: s[j].x - ((b.y - a.y) / len) * o, y: s[j].y + ((b.x - a.x) / len) * o };
    });
  };
  const traceSteps = (keep: (i: number) => boolean, noise = 0, every = 1) =>
    guide.flatMap((step, i) => (keep(i) ? step.map((s) => trace(s, noise, every)) : []));
  const all = () => true;
  const ink: Pt[][] = {
    perfect: () => traceSteps(all),
    wobbly: () => traceSteps(all, 15, 4), // input points ~30 apart (guide sampled every ~8)
    sloppy: () => traceSteps(all, 35, 4),
    half: () => traceSteps((i) => i < Math.floor(guide.length / 2)),
    skipOne: () => traceSteps((i) => i !== 2),
    scribble: () => [Array.from({ length: 51 }, (_, i) => ({ x: i % 2 ? 1000 : 0, y: i * 20 }))], // zigzag 20 apart
    doodle: () => [...traceSteps(all), [{ x: 100, y: 900 }, { x: 160, y: 860 }, { x: 200, y: 920 }, { x: 140, y: 960 }]],
    empty: () => [],
  }[name]();
  const t0 = performance.now();
  const s = score(guide, ink, tolerance ? { tolerance } : {});
  return { ...s, reactions: s.steps.map(reaction), ms: performance.now() - t0 };
}, { name, tolerance, d: cat.steps.map((s) => s.strokes) }) as Promise<Result>;

const log = (name: string, r: Result) =>
  console.log(`${name}: ${r.percent}% ${r.stars}* precision ${r.precision.toFixed(2)} steps [${r.steps.map((c) => c.toFixed(2))}] ${r.ms.toFixed(1)}ms`);

test.describe('score', () => {
  test.skip(({ viewport }) => viewport!.width > 1100, 'pure logic: one viewport is enough');
  test.beforeEach(({ page }) => page.goto('/').then(() => {}));

  test('perfect trace: 100%, 3 stars, fast', async ({ page }) => {
    const r = await run(page, 'perfect'); log('perfect', r);
    expect(r.percent).toBe(100);
    expect(r.stars).toBe(3);
    expect(r.reactions.every((x) => x === 'great')).toBe(true);
    expect(r.ms).toBeLessThan(50);
  });

  test('wobbly sparse trace: at least 80%, 2 or 3 stars', async ({ page }) => {
    const r = await run(page, 'wobbly'); log('wobbly', r);
    expect(r.percent).toBeGreaterThanOrEqual(80);
    expect(r.stars).toBeGreaterThanOrEqual(2);
  });

  test('sloppy trace: lower than wobbly, not crushing', async ({ page }) => {
    const r = await run(page, 'sloppy'); log('sloppy', r);
    expect(r.percent).toBeLessThan((await run(page, 'wobbly')).percent);
    expect(r.percent).toBeGreaterThanOrEqual(45);
    expect(r.percent).toBeLessThanOrEqual(85);
  });

  test('half the steps: roughly half, skipped steps near 0', async ({ page }) => {
    const r = await run(page, 'half'); log('half', r);
    expect(r.percent).toBeGreaterThanOrEqual(35);
    expect(r.percent).toBeLessThanOrEqual(70);
    const h = Math.floor(r.steps.length / 2);
    for (const c of r.steps.slice(h)) expect(c).toBeLessThan(0.25);
  });

  test('one step skipped: that step is try, the rest great', async ({ page }) => {
    const r = await run(page, 'skipOne'); log('skipOne', r);
    expect(r.reactions[2]).toBe('try');
    expect(r.reactions.filter((_, i) => i !== 2).every((x) => x === 'great')).toBe(true);
  });

  test('scribble over the canvas: low despite coverage, 1 star', async ({ page }) => {
    const r = await run(page, 'scribble'); log('scribble', r);
    expect(r.steps.reduce((a, b) => a + b) / r.steps.length).toBeGreaterThan(0.6);
    expect(r.percent).toBeLessThan(40);
    expect(r.stars).toBe(1);
  });

  test('perfect trace plus a small doodle: still 3 stars', async ({ page }) => {
    const r = await run(page, 'doodle'); log('doodle', r);
    expect(r.stars).toBe(3);
  });

  test('empty canvas: 0%, 1 star', async ({ page }) => {
    const r = await run(page, 'empty'); log('empty', r);
    expect(r.percent).toBe(0);
    expect(r.stars).toBe(1);
    expect(r.reactions.every((x) => x === 'try')).toBe(true);
  });

  test('wider tolerance raises the sloppy score', async ({ page }) => {
    const r = await run(page, 'sloppy', 45); log('sloppy@45', r);
    expect(r.percent).toBeGreaterThan((await run(page, 'sloppy')).percent);
  });
});

test('Surface.onStroke fires once per committed stroke with logical points, not for the eraser', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'speechSynthesis', { // silence
    configurable: true, value: { speak() {}, cancel() {}, getVoices: () => [] },
  }));
  await page.goto('/#lesson/cat');
  await expect(page.locator('#ink')).toBeVisible();
  // lesson.ts keeps its Surface private: grab the #ink instance on its next pointerdown, via the shared module.
  await page.evaluate(async () => {
    const { Surface } = await import('/src/engine/surface.ts' as string);
    const w = window as any;
    w.__strokes = [];
    const down = Surface.prototype.down;
    Surface.prototype.down = function (this: any, e: PointerEvent) {
      if (this.canvas.id === 'ink') { w.__ink = this; this.onStroke ??= (pts: unknown[]) => w.__strokes.push(pts); }
      return down.call(this, e);
    };
  });
  const strokes = () => page.evaluate(() => (window as any).__strokes as { x: number; y: number }[][]);
  await touchStroke(page, line([200, 300], [800, 700]));
  const s = await strokes();
  expect(s).toHaveLength(1);
  expect(s[0].length).toBeGreaterThan(5);
  for (const p of s[0]) for (const v of [p.x, p.y]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1000); }
  expect(s[0][0].x).toBeCloseTo(200, -1);
  await page.evaluate(() => { (window as any).__ink.eraser = true; });
  await touchStroke(page, line([200, 300], [800, 700]));
  expect(await strokes()).toHaveLength(1);
});
