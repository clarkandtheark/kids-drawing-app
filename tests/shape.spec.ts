// Shape practice grader (src/shape.ts) against synthetic, seeded "child" ink: the template's own points moved,
// scaled, wobbled, thinned, started elsewhere, reversed and split into strokes.
import { test, expect, type Page } from '@playwright/test';

const star = Array.from({ length: 10 }, (_, i) => {
  const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 120 : 300;
  return `${(500 + r * Math.cos(a)).toFixed(1)},${(500 + r * Math.sin(a)).toFixed(1)}`;
});
const spiral = Array.from({ length: 190 }, (_, i) => {
  const a = i * 0.1, r = (300 * a) / 18.9; // three turns out to radius 300
  return `${(500 + r * Math.cos(a)).toFixed(1)},${(500 + r * Math.sin(a)).toFixed(1)}`;
});
// All templates about 600 units on their longer side.
const SHAPES = {
  circle: 'M200,500 A300,300 0 1,1 800,500 A300,300 0 1,1 200,500 Z',
  oval: 'M200,500 A300,150 0 1,1 800,500 A300,150 0 1,1 200,500 Z',
  square: 'M200,200 H800 V800 H200 Z',
  rectangle: 'M200,350 H800 V650 H200 Z',
  triangle: 'M500,240 L800,760 L200,760 Z',
  zigzag: 'M200,650 L300,350 L400,650 L500,350 L600,650 L700,350 L800,650',
  line: 'M200,500 H800',
  wavy: 'M200,500 Q275,400 350,500 T500,500 T650,500 T800,500',
  heart: 'M500,780 C250,600 150,450 250,330 C350,210 480,280 500,380 C520,280 650,210 750,330 C850,450 750,600 500,780 Z',
  star: `M${star.join(' L')} Z`,
  spiral: `M${spiral.join(' L')}`,
};
type Shape = keyof typeof SHAPES;
const NAMES = Object.keys(SHAPES) as Shape[];
const CLOSED: Shape[] = ['circle', 'oval', 'square', 'rectangle', 'triangle', 'heart', 'star'];
const SPLIT: Partial<Record<Shape, number>> = { square: 4, rectangle: 4, triangle: 3, star: 5, zigzag: 2 }; // polygons: several strokes

type Ink = {
  shape: Shape; seed?: number; scale?: number; wobble?: number; // wobble: fraction of the shape's size
  gap?: number; split?: number; rotate?: number; stretch?: [number, number]; extra?: 'dot' | 'scribble' | 'tiny' | 'empty';
};
type Case = { name: string; ink: Ink; template: Shape; opts?: { rotations?: number[]; closed?: boolean } };
type Result = { name: string; percent: number; stars: number; precision: number; coverage: number; reaction: string; ms: number };

/** Build each case's ink in the page (seeded, deterministic) and score it against its template. */
const run = (page: Page, cases: Case[]) => page.evaluate(async ({ cases, shapes, closedShapes, splits }) => {
  const { samplePath } = await import('/src/score.ts' as string);
  const { scoreShape, reactionFor } = await import('/src/shape.ts' as string);
  type Pt = { x: number; y: number };
  const tpl = (s: string): Pt[][] => [samplePath((shapes as Record<string, string>)[s])];
  return cases.map(({ name, ink: o, template, opts }) => {
    let seed = o.seed ?? 7;
    const rand = () => { // mulberry32
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let pts = tpl(o.shape)[0];
    const size = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
    if (closedShapes.includes(o.shape)) { // closed: start somewhere else, then stop short (gap > 0) or overshoot (gap < 0)
      pts = pts.slice(0, -1);
      const n = pts.length, start = Math.floor(rand() * n);
      pts = [...pts.slice(start), ...pts.slice(0, start)];
      const gap = o.gap ?? 0;
      pts = gap > 0 ? pts.slice(0, Math.round(n * (1 - gap))) : [...pts, ...pts.slice(0, Math.round(-gap * n) + 1)];
    }
    if (rand() < 0.5) pts = pts.reverse();
    const every = 4; // sparse input: a point every ~32 units of the template
    const sparse = pts.filter((_, j) => j % every === 0 || j === pts.length - 1);
    const noise = (o.wobble ?? 0.025) * size;
    const knot = () => (rand() < 0.5 ? -1 : 1) * (0.5 + rand() / 2) * noise;
    let k0 = knot(), k1 = knot();
    let line: Pt[] = sparse.map((p, i) => { // smooth drift sideways off the outline
      if (i % 3 === 0 && i) { k0 = k1; k1 = knot(); }
      const off = k0 + ((k1 - k0) * (i % 3)) / 3;
      const a = sparse[Math.max(0, i - 1)], b = sparse[Math.min(sparse.length - 1, i + 1)], len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: p.x - ((b.y - a.y) / len) * off, y: p.y + ((b.x - a.x) / len) * off };
    });
    const [sx, sy] = o.stretch ?? [1, 1], rad = ((o.rotate ?? 0) * Math.PI) / 180, scale = o.scale ?? 0.8;
    line = line.map(({ x, y }) => {
      const dx = (x - 500) * sx, dy = (y - 500) * sy;
      return { x: (dx * Math.cos(rad) - dy * Math.sin(rad)) * scale, y: (dx * Math.sin(rad) + dy * Math.cos(rad)) * scale };
    });
    const split = o.split ?? (splits as Record<string, number>)[o.shape] ?? 1, per = Math.ceil(line.length / split);
    let ink: Pt[][] = Array.from({ length: split }, (_, i) => line.slice(i * per, (i + 1) * per + 1)).filter((s) => s.length);
    // Move it to a random place on the 1000x1000 canvas where it fits.
    const all = ink.flat(), x0 = Math.min(...all.map((p) => p.x)), x1 = Math.max(...all.map((p) => p.x));
    const y0 = Math.min(...all.map((p) => p.y)), y1 = Math.max(...all.map((p) => p.y));
    const dx = 20 - x0 + rand() * Math.max(0, 960 - (x1 - x0)), dy = 20 - y0 + rand() * Math.max(0, 960 - (y1 - y0));
    ink = ink.map((s) => s.map((p) => ({ x: p.x + dx, y: p.y + dy })));
    if (o.extra === 'dot') ink.push([{ x: 980, y: 975 }, { x: 984, y: 978 }]);
    if (o.extra === 'scribble') ink.push(Array.from({ length: 40 }, (_, i) => ({ x: 50 + rand() * 900, y: 50 + rand() * 900 })));
    if (o.extra === 'tiny') ink = [Array.from({ length: 12 }, () => ({ x: 400 + rand() * 50, y: 400 + rand() * 50 }))];
    if (o.extra === 'empty') ink = [];
    const target = tpl(template), t0 = performance.now();
    const r = scoreShape(target, ink, opts);
    const ms = performance.now() - t0;
    return { name, percent: r.percent, stars: r.stars, precision: r.precision, coverage: r.steps[0], reaction: reactionFor(r), ms };
  });
}, { cases, shapes: SHAPES, closedShapes: CLOSED, splits: SPLIT }) as Promise<Result[]>;

const table = (title: string, rs: Result[]) => console.log(`\n${title}\n${rs.map((r) =>
  `  ${r.name.padEnd(34)} ${String(r.percent).padStart(3)}% ${r.stars}* cov ${r.coverage.toFixed(2)} prec ${r.precision.toFixed(2)} ${r.ms.toFixed(1)}ms`).join('\n')}`);

const self = (shape: Shape, scale: number, seed: number): Case =>
  ({ name: `${shape} @${scale} #${seed}`, ink: { shape, scale, seed }, template: shape, opts: { closed: CLOSED.includes(shape) } });

// Ink of one shape scored against another's template that may reasonably score 2 stars, with the reason.
// (Circle vs 2:1 oval and square vs 2:1 rectangle are NOT here: MAX_STRETCH keeps them apart.)
const CONFUSABLE: [Shape, Shape, string][] = [
  ['oval', 'rectangle', 'same 2:1 box; the long, flat sides of a 2:1 oval hug the long sides of the rectangle, so only the four corners differ'],
  ['rectangle', 'oval', 'same reason, the other way round'],
];

test.describe('shape grader', () => {
  test.skip(({ viewport }) => viewport!.width > 1100 || viewport!.width < 600, 'pure logic: one viewport is enough');
  test.beforeEach(({ page }) => page.goto('/').then(() => {}));

  test('each shape drawn as itself scores high and the same at any size and place', async ({ page }) => {
    const rs = await run(page, NAMES.flatMap((s) => [self(s, 0.3, 2), self(s, 0.8, 2), self(s, 1.5, 2)]));
    table('self, small / medium / large', rs);
    const sloppy = await run(page, NAMES.map((s) => ({ ...self(s, 0.8, 5), name: `${s} sloppy`, ink: { shape: s, seed: 5, wobble: 0.05 } })));
    table('self, sloppy (wobble 5% of size)', sloppy);
    for (const r of sloppy) expect(r.stars, r.name).toBeGreaterThanOrEqual(2);
    for (const s of NAMES) {
      const mine = rs.filter((r) => r.name.startsWith(`${s} `));
      const hard = ['star', 'heart', 'spiral'].includes(s);
      for (const r of mine) {
        expect(r.stars, r.name).toBeGreaterThanOrEqual(hard ? 2 : 3);
        expect(r.percent, r.name).toBeGreaterThanOrEqual(hard ? 75 : 85);
        expect(r.reaction, r.name).toBe(r.stars === 3 ? 'great' : 'good');
      }
      const ps = mine.map((r) => r.percent);
      expect(Math.max(...ps) - Math.min(...ps), `${s} across sizes`).toBeLessThanOrEqual(6);
    }
    for (const r of rs) expect(r.ms, r.name).toBeLessThan(20);
  });

  test('confusion matrix: each shape scores clearly lower and 1 star against every other template', async ({ page }) => {
    const cases = NAMES.flatMap((ink) => NAMES.map((t) => ({ name: `${ink} vs ${t}`, ink: { shape: ink, seed: 4 }, template: t, opts: { closed: CLOSED.includes(t) } })));
    const rs = await run(page, cases);
    const at = (i: Shape, t: Shape) => rs[NAMES.indexOf(i) * NAMES.length + NAMES.indexOf(t)];
    console.log(`\nconfusion matrix: percent/stars, rows = ink, columns = template\n${''.padEnd(10)}${NAMES.map((n) => n.slice(0, 7).padStart(8)).join('')}\n${
      NAMES.map((i) => i.padEnd(10) + NAMES.map((t) => `${at(i, t).percent}/${at(i, t).stars}`.padStart(8)).join('')).join('\n')}`);
    for (const i of NAMES) for (const t of NAMES) {
      if (i === t) continue;
      if (CONFUSABLE.some(([a, b]) => a === i && b === t)) { expect(at(i, t).stars, `${i} ink vs ${t}`).toBeLessThanOrEqual(2); continue; }
      expect(at(i, t).stars, `${i} ink vs ${t}`).toBe(1);
      expect(at(i, t).percent, `${i} ink vs ${t}`).toBeLessThanOrEqual(at(i, i).percent - 25);
    }
    for (const r of rs) expect(r.ms, r.name).toBeLessThan(20);
  });

  test('closed: a C fails as a circle; overshoot, stopping a little short and a four-stroke square pass', async ({ page }) => {
    const c = { closed: true };
    const rs = await run(page, [
      { name: 'C (25% gap) closed', ink: { shape: 'circle', gap: 0.25 }, template: 'circle', opts: c },
      { name: 'C (25% gap) not closed', ink: { shape: 'circle', gap: 0.25 }, template: 'circle' },
      { name: 'circle 5% short', ink: { shape: 'circle', gap: 0.05 }, template: 'circle', opts: c },
      { name: 'circle overshoot 10%', ink: { shape: 'circle', gap: -0.1 }, template: 'circle', opts: c },
      { name: 'square 4 strokes', ink: { shape: 'square', split: 4 }, template: 'square', opts: c },
      { name: 'square missing a side', ink: { shape: 'square', gap: 0.25, split: 3 }, template: 'square', opts: c },
    ]);
    table('closed', rs);
    expect(rs[0].stars).toBe(1);
    expect(rs[0].percent).toBeLessThan(rs[1].percent);
    for (const r of [rs[2], rs[3], rs[4]]) expect(r.stars, r.name).toBe(3);
    expect(rs[5].stars).toBe(1);
  });

  test('rotation: a triangle pointing down fails by default and passes with rotations [180]', async ({ page }) => {
    const down: Ink = { shape: 'triangle', rotate: 180 };
    const rs = await run(page, [
      { name: 'triangle down', ink: down, template: 'triangle', opts: { closed: true } },
      { name: 'triangle down, rotations [180]', ink: down, template: 'triangle', opts: { closed: true, rotations: [180] } },
      { name: 'zigzag at 90, rotations [90,-90]', ink: { shape: 'zigzag', rotate: 90 }, template: 'zigzag', opts: { rotations: [90, -90] } },
    ]);
    table('rotation', rs);
    expect(rs[0].stars).toBe(1);
    expect(rs[1].stars).toBe(3);
    expect(rs[2].stars).toBe(3);
  });

  test('too small, empty, a stray dot, a big scribble', async ({ page }) => {
    const rs = await run(page, [
      { name: 'tiny scribble', ink: { shape: 'circle', extra: 'tiny' }, template: 'circle' },
      { name: 'empty', ink: { shape: 'circle', extra: 'empty' }, template: 'circle' },
      { name: 'circle + stray dot', ink: { shape: 'circle', extra: 'dot' }, template: 'circle', opts: { closed: true } },
      { name: 'square + stray dot', ink: { shape: 'square', extra: 'dot', scale: 0.4 }, template: 'square', opts: { closed: true } },
      { name: 'circle in a big scribble', ink: { shape: 'circle', extra: 'scribble' }, template: 'circle', opts: { closed: true } },
    ]);
    table('edge cases', rs);
    for (const r of rs.slice(0, 2)) { expect(r.percent, r.name).toBe(0); expect(r.stars, r.name).toBe(1); expect(r.reaction).toBe('try'); }
    for (const r of rs.slice(2, 4)) expect(r.stars, r.name).toBe(3);
    expect(rs[4].stars).toBe(1);
  });

  test('lines: a tilted wobbly horizontal line passes, a vertical one does not; squashed circle ok, 2:1 not', async ({ page }) => {
    const rs = await run(page, [
      { name: 'line tilted 6deg, wobbly', ink: { shape: 'line', rotate: 6, wobble: 0.03 }, template: 'line' },
      { name: 'line tilted 3deg, wobbly', ink: { shape: 'line', rotate: 3, wobble: 0.03 }, template: 'line' },
      { name: 'line vertical', ink: { shape: 'line', rotate: 90 }, template: 'line' },
      { name: 'line vertical, rotations [90]', ink: { shape: 'line', rotate: 90 }, template: 'line', opts: { rotations: [90] } },
      { name: 'circle squashed 1.25:1', ink: { shape: 'circle', stretch: [1.25, 1] }, template: 'circle', opts: { closed: true } },
      { name: 'circle stretched 2:1 (oval)', ink: { shape: 'circle', stretch: [1.4, 0.7] }, template: 'circle', opts: { closed: true } },
      { name: 'square stretched 2:1', ink: { shape: 'square', stretch: [1, 2] }, template: 'square', opts: { closed: true } },
    ]);
    table('lines and stretch', rs);
    expect(rs[0].stars).toBeGreaterThanOrEqual(2); // 6 degrees puts the ends ~5% of the length off the line
    expect(rs[1].stars).toBe(3);
    expect(rs[2].stars).toBe(1);
    expect(rs[3].stars).toBe(3);
    expect(rs[4].stars).toBe(3);
    expect(rs[5].stars).toBe(1);
    expect(rs[6].stars).toBe(1);
  });
});
