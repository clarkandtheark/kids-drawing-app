// Generous grading of "your own way" answers, scored in the page with the player's own grade() (src/stop.ts):
// - shape exercises accept alternatives (`also`): for the curriculum's zigzag, wavy line, row of scales and star, every
//   accepted variant drawn by a synthetic child scores at least two stars, a clearly different shape still one;
// - open finishes (`open`) accept any real attempt in the right place, not a dot or ink somewhere else.
// The shape cases read the built path.json and find their exercise by its prompt, so they check the data as configured.
import { test, expect, type Page } from '@playwright/test';

type Ex = { type: string; say: string; strokes: string[]; also?: string[][]; rotations?: number[]; closed?: boolean; given?: string[]; open?: boolean };

const r1 = (v: number) => Math.round(v * 10) / 10;
const poly = (ps: [number, number][]) => 'M ' + ps.map(([x, y]) => `${r1(x)} ${r1(y)}`).join(' L ');
/** A zigzag of `n` corners across 200..800, starting high or low. */
const zigzag = (n: number, high = false) => poly(Array.from({ length: n }, (_, i) => [200 + (600 * i) / (n - 1), (i % 2 === 0) === high ? 380 : 620]));
/** `n` waves across 200..800, starting up (or down). */
const wave = (n: number, sign = 1) => poly(Array.from({ length: 61 }, (_, i) => [200 + 10 * i, 500 - sign * 100 * Math.sin((2 * Math.PI * n * i * 10) / 600)]));
/** A row of `n` round scales hanging under y 450 across 150..850. */
const scales = (n: number) => { const r = 700 / (2 * n); return `M 150 450 ${Array.from({ length: n }, (_, i) => `A ${r1(r)} ${r1(r)} 0 0 0 ${r1(150 + 2 * r * (i + 1))} 450`).join(' ')}`; };
/** A star: the one-line pentagram, or a five-point outline (inner radius ratio k). */
const star = (k?: number) => k === undefined
  ? poly([0, 2, 4, 1, 3, 0].map((i) => { const a = (-90 + 72 * i) * Math.PI / 180; return [500 + 380 * Math.cos(a), 530 + 380 * Math.sin(a)]; }))
  : poly(Array.from({ length: 11 }, (_, i) => { const a = (-90 + 36 * i) * Math.PI / 180, r = i % 2 ? 380 * k : 380; return [500 + r * Math.cos(a), 530 + r * Math.sin(a)]; })) + ' Z';
const CIRCLE = 'M 300 500 A 200 200 0 1 1 700 500 A 200 200 0 1 1 300 500 Z';
const SQUARE = 'M 250 250 L 750 250 L 750 750 L 250 750 Z';
const SEEDS = [1, 2, 3, 4, 5];

/** Stars per seed for each drawing of `x`: the drawing's strokes as a child draws them (sparse, a smooth wobble of
 *  `wobble` x its size, reversed at random), at her own size and place for a shape; or exactly as given (`exact`). */
const stars = (page: Page, x: Ex, drawings: string[][], { wobble = 0.03, exact = false } = {}) => page.evaluate(async ({ x, drawings, wobble, exact, seeds }) => {
  const { samplePath } = await import('/src/score.ts' as string);
  const { grade } = await import('/src/stop.ts' as string);
  type Pt = { x: number; y: number };
  const child = (ds: string[], seed: number): Pt[][] => {
    let st = seed * 7919;
    const rand = () => { // mulberry32
      st = (st + 0x6d2b79f5) | 0;
      let t = Math.imul(st ^ (st >>> 15), 1 | st);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const all: Pt[] = ds.flatMap((d) => samplePath(d));
    const span = (k: 'x' | 'y') => Math.max(...all.map((p) => p[k])) - Math.min(...all.map((p) => p[k]));
    const noise = wobble * Math.max(span('x'), span('y'));
    let ink = ds.map((d) => {
      let pts: Pt[] = samplePath(d);
      if (rand() < 0.5) pts = pts.reverse();
      const sp = pts.filter((_, j) => j % 4 === 0 || j === pts.length - 1);
      const knot = () => (rand() < 0.5 ? -1 : 1) * (0.5 + rand() / 2) * noise;
      let k0 = knot(), k1 = knot();
      return sp.map((p, i) => {
        if (i % 3 === 0 && i) { k0 = k1; k1 = knot(); }
        const off = k0 + ((k1 - k0) * (i % 3)) / 3;
        const a = sp[Math.max(0, i - 1)], b = sp[Math.min(sp.length - 1, i + 1)], len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return { x: p.x - ((b.y - a.y) / len) * off, y: p.y + ((b.x - a.x) / len) * off };
      });
    });
    if (x.type === 'shape') { // her own size (50..90%) and place
      const k = 0.5 + rand() * 0.4, f = ink.flat(), x0 = Math.min(...f.map((p) => p.x)), y0 = Math.min(...f.map((p) => p.y));
      const w = (Math.max(...f.map((p) => p.x)) - x0) * k, h = (Math.max(...f.map((p) => p.y)) - y0) * k;
      const dx = 30 + rand() * Math.max(0, 940 - w), dy = 30 + rand() * Math.max(0, 940 - h);
      ink = ink.map((s) => s.map((p) => ({ x: dx + (p.x - x0) * k, y: dy + (p.y - y0) * k })));
    }
    return ink;
  };
  return drawings.map((ds) => exact ? [grade(x, ds.map((d) => samplePath(d)))] : seeds.map((s) => grade(x, child(ds, s))));
}, { x, drawings, wobble, exact, seeds: SEEDS });

test.describe('generous answers', () => {
  test.skip(({ viewport }) => viewport!.width > 1100 || viewport!.width < 600, 'pure logic: one viewport is enough');
  let units: { id: string; stops: { id: string; exercises: Ex[] }[] }[];
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    units = await (await page.request.get('/path.json')).json();
  });
  /** The curriculum's shape exercise whose prompt matches `re`. */
  const shapeEx = (re: RegExp) => {
    const x = units.flatMap((u) => u.stops.flatMap((s) => s.exercises)).find((x) => x.type === 'shape' && re.test(x.say));
    expect(x, `a shape exercise matching ${re} in path.json`).toBeTruthy();
    return x!;
  };

  const CASES: [string, RegExp, [string, string[]][], [string, string[]]][] = [
    ['zigzag', /zigzag/i, [
      ['2 tops', [zigzag(5)]], ['3 tops', [zigzag(7)]], ['4 tops', [zigzag(9)]],
      ['3 tops, ending on a top', [zigzag(6)]], ['3 tops, starting on a top', [zigzag(6, true)]], ['4 tops, ending on a top', [zigzag(8)]],
      ['2 tops, ending on a top', [zigzag(4)]], ['upside down (3 dips)', [zigzag(7, true)]],
    ], ['a circle', [CIRCLE]]],
    ['wavy line', /wavy line/i, [
      ['1.5 waves', [wave(1.5)]], ['2 waves', [wave(2)]], ['2.5 waves', [wave(2.5)]], ['3 waves', [wave(3)]],
      ['2 waves starting down', [wave(2, -1)]], ['3 waves starting down', [wave(3, -1)]],
    ], ['a circle', [CIRCLE]]],
    ['row of scales', /row of scales/i, [['3 bumps', [scales(3)]], ['4 bumps', [scales(4)]], ['5 bumps', [scales(5)]]], ['a circle', [CIRCLE]]],
    ['star', /draw a star/i, [['one-line star', [star()]], ['outline star', [star(0.382)]], ['chubby outline star', [star(0.5)]]], ['a square', [SQUARE]]],
  ];
  for (const [name, re, good, bad] of CASES) {
    test(`${name}: every accepted variant scores at least two stars, ${bad[0]} one`, async ({ page }) => {
      const x = shapeEx(re);
      expect(x.also?.length, `${name} has alternatives`).toBeGreaterThan(0);
      const got = await stars(page, x, [...good.map(([, ds]) => ds), bad[1]]);
      console.log(`\n${name}\n${[...good, bad].map(([n], i) => `  ${n.padEnd(28)} ${got[i].join(' ')}`).join('\n')}`);
      good.forEach(([n], i) => { for (const s of got[i]) expect(s, `${name}: ${n}`).toBeGreaterThanOrEqual(2); });
      for (const s of got.at(-1)!) expect(s, `${name}: ${bad[0]}`).toBe(1);
    });
  }

  test('open finish: tracing over the given part is not an attempt (the crown from #50); the missing part, with or without tracing, is', async ({ page }) => {
    const crown = units.flatMap((u) => u.stops.flatMap((s) => s.exercises)).find((x) => x.type === 'finish' && /crown is missing its points/i.test(x.say))!;
    expect(crown?.open, 'the crown finish in path.json is open').toBe(true);
    const given = crown.given!, zig = crown.strokes, other = ['M 250 450 L 375 260 L 500 450 L 625 260 L 750 450']; // hers: two points, not three
    const drawings = [given, zig, other, [...given, ...zig], [...given, ...other]];
    const exact = (await stars(page, crown, drawings, { exact: true })).map(([s]) => s);
    const wobbly = await stars(page, crown, drawings, { wobble: 0.03 });
    console.log(`\ncrown (exact / wobbly x5): ${['traces the box', 'zigzag', 'her own zigzag', 'box + zigzag', 'box + her own'].map((n, i) => `${n} ${exact[i]} / ${wobbly[i].join(' ')}`).join(', ')}`);
    expect(exact).toEqual([1, 3, 3, 3, 3]);
    expect(wobbly[0], 'tracing the box with a wobble').toEqual(SEEDS.map(() => 1));
    for (const w of wobbly.slice(1)) for (const s of w) expect(s).toBe(3);
  });

  test('open finish: any real attempt in the place passes; a dot or ink far away does not; a non-open finish is unchanged', async ({ page }) => {
    const head = 'M 250 500 A 250 250 0 1 0 750 500 A 250 250 0 1 0 250 500';
    const face = ['M 360 450 A 40 40 0 1 0 440 450 A 40 40 0 1 0 360 450', 'M 560 450 A 40 40 0 1 0 640 450 A 40 40 0 1 0 560 450', 'M 400 620 Q 500 700 600 620'];
    const open: Ex = { type: 'finish', say: 'Give it a face, any way you like.', given: [head], strokes: face, open: true };
    const strict: Ex = { ...open, open: undefined };
    const drawings: [string, string[]][] = [
      ['the expected face', face],
      ['square eyes and a big O mouth', ['M 330 380 L 450 380 L 450 470 L 330 470 Z', 'M 560 400 L 660 400 L 660 480 L 560 480 Z', 'M 440 640 A 60 60 0 1 0 560 640 A 60 60 0 1 0 440 640']],
      ['eyes wide apart up high, a wide grin', ['M 250 360 A 50 50 0 1 0 350 360 A 50 50 0 1 0 250 360', 'M 650 360 A 50 50 0 1 0 750 360 A 50 50 0 1 0 650 360', 'M 300 560 Q 500 800 700 560']],
      ['a cross face: slanted lines', ['M 330 380 L 450 440', 'M 670 380 L 550 440', 'M 380 680 L 620 640']],
      ['a tiny dot', ['M 500 500 L 506 503']],
      ['a squiggle in the far corner', ['M 40 40 L 140 60 L 60 120 L 150 150 L 50 200']],
      ['mostly in the corner, a dash in the face', ['M 40 40 L 200 60 L 60 160 L 220 200', 'M 480 500 L 520 500']],
    ];
    const ds = drawings.map(([, d]) => d);
    const o = (await stars(page, open, ds, { exact: true })).map(([s]) => s);
    const w = (await stars(page, open, ds, { wobble: 0.03 }));
    const s = (await stars(page, strict, ds, { exact: true })).map(([s]) => s);
    console.log(`\nopen finish (exact, wobbly x5) / the same exercise not open\n${drawings.map(([n], i) => `  ${n.padEnd(42)} ${o[i]}  ${w[i].join(' ')}  /  ${s[i]}`).join('\n')}`);
    expect(o).toEqual([3, 3, 3, 3, 1, 1, 1]);
    for (const [i, ss] of w.entries()) for (const v of ss) expect(v, drawings[i][0]).toBe(o[i]);
    // Not open: graded against the expected strokes, as before; a different face is not the expected one.
    const score = await page.evaluate(async ({ face, ds }) => {
      const { samplePath, score } = await import('/src/score.ts' as string);
      const { FINISH_TOLERANCE } = await import('/src/stop.ts' as string);
      return ds.map((d: string[]) => score([face.map((f: string) => samplePath(f))], d.map((x) => samplePath(x)), { tolerance: FINISH_TOLERANCE }).stars);
    }, { face, ds });
    expect(s).toEqual(score);
    expect(s[0]).toBe(3);
    expect(s[2], 'a differently placed face, not open').toBe(1);
  });
});
