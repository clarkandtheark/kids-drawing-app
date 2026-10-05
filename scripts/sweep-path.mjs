// Dev tool: grading sanity sweep over the curriculum. For every graded exercise in path/*.json, simulate a decent child
// attempt (the expected strokes, sparse points, a moderate smooth wobble; a `shape` also moved and resized) with a few
// seeds and score it with the player's own grade() (src/stop.ts). Every exercise should give at least two stars.
// Usage: node scripts/sweep-path.mjs [severity]  (severity scales wobble and shift, default 1; exit 1 if any exercise's
// worst attempt gets one star)
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { loadPath } from './path-data.mjs';

const SEEDS = 8;
// A decent attempt, per type: smooth sideways wobble (logical units; shape: a fraction of its size) and, where she draws
// freehand without a guide, the whole attempt shifted a little. About half the type's grading tolerance (score.ts, stop.ts).
const K = Number(process.argv[2] ?? 1);
const WOBBLE = { trace: 14 * K, finish: 22 * K, memory: 30 * K, shape: 0.04 * K }, SHIFT = { trace: 0, finish: 15 * K, memory: 25 * K, shape: 0 };
const { units, errs } = await loadPath();
if (errs.length) { errs.forEach((m) => console.error(m)); process.exit(1); }
const cases = units.flatMap((u) => u.stops.flatMap((s) => s.exercises.map((x, j) => ({ where: `${u.id}/${s.id}#${j + 1}`, x }))))
  .filter(({ x }) => ['trace', 'shape', 'memory', 'finish'].includes(x.type));

const server = await createServer({ server: { port: 5193, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:5193/');
  const rows = await page.evaluate(async ({ cases, SEEDS, WOBBLE, SHIFT }) => {
    const { samplePath } = await import('/src/score.ts');
    const { grade } = await import('/src/stop.ts');
    return cases.map(({ where, x }) => {
      const stars = [];
      for (let seed = 1; seed <= SEEDS; seed++) {
        let st = seed * 7919;
        const rand = () => { // mulberry32
          st = (st + 0x6d2b79f5) | 0;
          let t = Math.imul(st ^ (st >>> 15), 1 | st);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const all = x.strokes.map((d) => samplePath(d)).flat();
        const size = Math.max(Math.max(...all.map((p) => p.x)) - Math.min(...all.map((p) => p.x)), Math.max(...all.map((p) => p.y)) - Math.min(...all.map((p) => p.y)));
        const noise = x.type === 'shape' ? WOBBLE.shape * size : WOBBLE[x.type];
        const a0 = rand() * 2 * Math.PI, sx = SHIFT[x.type] * Math.cos(a0), sy = SHIFT[x.type] * Math.sin(a0);
        let ink = x.strokes.map((d) => {
          let pts = samplePath(d);
          if (rand() < 0.5) pts = pts.reverse();
          const sparse = pts.filter((_, j) => j % 4 === 0 || j === pts.length - 1); // a point every ~32 units
          const knot = () => (rand() < 0.5 ? -1 : 1) * (0.5 + rand() / 2) * noise;
          let k0 = knot(), k1 = knot();
          return sparse.map((p, i) => { // smooth drift sideways off the line
            if (i % 3 === 0 && i) { k0 = k1; k1 = knot(); }
            const off = k0 + ((k1 - k0) * (i % 3)) / 3;
            const a = sparse[Math.max(0, i - 1)], b = sparse[Math.min(sparse.length - 1, i + 1)], len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            return { x: sx + p.x - ((b.y - a.y) / len) * off, y: sy + p.y + ((b.x - a.x) / len) * off };
          });
        });
        if (x.type === 'shape') { // her own size and place: 50..90% of the example's size, anywhere it fits
          const k = 0.5 + rand() * 0.4, f = ink.flat(), x0 = Math.min(...f.map((p) => p.x)), y0 = Math.min(...f.map((p) => p.y));
          const w = (Math.max(...f.map((p) => p.x)) - x0) * k, h = (Math.max(...f.map((p) => p.y)) - y0) * k;
          const dx = 30 + rand() * Math.max(0, 940 - w), dy = 30 + rand() * Math.max(0, 940 - h);
          ink = ink.map((s) => s.map((p) => ({ x: dx + (p.x - x0) * k, y: dy + (p.y - y0) * k })));
        }
        stars.push(grade(x, ink));
      }
      return { where, type: x.type, open: !!x.open, min: Math.min(...stars), mean: stars.reduce((a, b) => a + b, 0) / stars.length };
    });
  }, { cases, SEEDS, WOBBLE, SHIFT });
  for (const r of rows) console.log(`${r.min < 2 ? '!!' : '  '} ${r.where.padEnd(42)} ${(r.type + (r.open ? ' open' : '')).padEnd(12)} min ${r.min}  mean ${r.mean.toFixed(2)}`);
  const bad = rows.filter((r) => r.min < 2);
  console.log(`\n${rows.length} graded exercises, ${bad.length} with a one-star decent attempt`);
  if (bad.length) process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
