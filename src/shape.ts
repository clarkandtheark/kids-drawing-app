// Shape practice score: she draws the asked-for shape anywhere, at any size, with no guide to trace.
// Her ink is fitted onto the template's bounding box (and, as a second candidate, refitted by centre and spread,
// which shrugs off a wobbly bulge; the better candidate wins), then measured both ways with the tracing score (score.ts):
// how much of the template her ink covers, and how much of her ink the template covers. The two percents are
// multiplied: the tracing score is lenient on purpose (half coverage already earns two stars), so either one alone
// lets a square pass as a circle, while a real attempt scores high both ways and loses little.
// Pure functions, no DOM.
import { INK_SPACING, resample, score, THREE_STARS, TWO_STARS, type Point, type Reaction, type Score } from './score';

// Calibration (GENEROUS, for a 6-year-old's finger). Tune these on a real device.
export const SHAPE_SIZE = 1000; // the template is scaled so its longer side is this many units before measuring
export const SHAPE_TOLERANCE = 0.06; // coverage tolerance as a fraction of SHAPE_SIZE, so small and large drawings score alike
export const MAX_STRETCH = 1.3; // her box may be stretched up to this much more on one axis than the other (squashed circle ok, 2:1 oval not)
export const FLAT = 0.2; // a box side under this fraction of its long side is flat (a line): fit on the long axis only
export const STRAY = 0.1; // strokes shorter than this fraction of her total ink are left out of her box (still count against precision)
export const MIN_SIZE = 0.08; // her drawing's longer side must be at least this fraction of the canvas, or it is too small to grade
export const REFINE = 1.25; // the centre-and-spread refit may rescale the box fit by at most this factor either way
export const CLOSE_GAP = 0.12; // closed shapes: longest stretch of the outline she left uncovered, as a fraction of the outline
export const OPEN_PENALTY = 0.6; // an open closed-shape keeps this fraction of its percent, and one star

export type ShapeOptions = { rotations?: number[]; closed?: boolean; canvas?: number };
type Box = { x0: number; y0: number; w: number; h: number };

function box(pts: Point[]): Box {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return { x0, y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}

const length = (s: Point[]) => s.reduce((a, p, i) => (i ? a + Math.hypot(p.x - s[i - 1].x, p.y - s[i - 1].y) : 0), 0);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Her strokes without the tiny stray marks (all of them if that would leave nothing). */
function mainStrokes(ink: Point[][]): Point[][] {
  const total = ink.reduce((a, s) => a + length(s), 0);
  const main = ink.filter((s) => s.length && length(s) >= STRAY * total);
  return main.length ? main : ink.filter((s) => s.length);
}

/** Map her ink so the box of her main strokes lands on box `t`: per-axis scale, but at most MAX_STRETCH apart. */
function fit(ink: Point[][], t: Box): Point[][] {
  const b = box(mainStrokes(ink).flat());
  const long = Math.max(b.w, b.h), tLong = Math.max(t.w, t.h);
  const solid = (her: number, its: number) => her >= FLAT * long && its >= FLAT * tLong; // neither box is flat on this axis
  let sx = solid(b.w, t.w) ? t.w / b.w : NaN, sy = solid(b.h, t.h) ? t.h / b.h : NaN;
  if (Number.isNaN(sx) && Number.isNaN(sy)) sx = sy = tLong / long; // a line (in either): match long sides
  else if (Number.isNaN(sx)) sx = sy;
  else if (Number.isNaN(sy)) sy = sx;
  else {
    const g = Math.sqrt(sx * sy), k = Math.sqrt(MAX_STRETCH);
    sx = clamp(sx, g / k, g * k);
    sy = clamp(sy, g / k, g * k);
  }
  const cx = b.x0 + b.w / 2, cy = b.y0 + b.h / 2, tx = t.x0 + t.w / 2, ty = t.y0 + t.h / 2;
  return ink.map((s) => s.map((p) => ({ x: tx + (p.x - cx) * sx, y: ty + (p.y - cy) * sy })));
}

/** A box-fitted drawing moved and uniformly scaled so the centre and spread of its (evenly resampled) main strokes
 *  match the outline's: one wobbly bulge sets the box but barely moves these averages. */
function refine(ink: Point[][], outline: Point[]): Point[][] {
  const her = mainStrokes(ink).flatMap((s) => resample(s, INK_SPACING));
  const c = centroid(her), oc = centroid(outline), k = clamp(spread(outline, oc) / (spread(her, c) || 1), 1 / REFINE, REFINE);
  return ink.map((s) => s.map((p) => ({ x: oc.x + (p.x - c.x) * k, y: oc.y + (p.y - c.y) * k })));
}
const centroid = (ps: Point[]) => ({ x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length });
const spread = (ps: Point[], c: Point) => Math.sqrt(ps.reduce((a, p) => a + (p.x - c.x) ** 2 + (p.y - c.y) ** 2, 0) / ps.length);

function rotate(ink: Point[][], deg: number): Point[][] {
  if (!deg) return ink;
  const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
  return ink.map((st) => st.map((p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c })));
}

/** Longest cyclic run of uncovered outline points, as a fraction of the outline (template points are evenly spaced). */
function longestGap(credit: number[]): number {
  if (credit.every((c) => c === 0)) return 1;
  let best = 0, run = 0;
  for (let i = 0; i < credit.length * 2; i++) { // twice round, so a gap across the start point is counted whole
    run = credit[i % credit.length] === 0 ? run + 1 : 0;
    best = Math.max(best, Math.min(run, credit.length));
  }
  return best / credit.length;
}

/**
 * Score a freehand shape. `template` is the target as sampled strokes (samplePath) in any coordinates;
 * `ink` is her strokes anywhere on a `canvas`-sized canvas. Position, size, direction and start point do not
 * matter; rotation does unless listed in `rotations` (degrees, best wins). `closed` shapes must go all the way round.
 * `steps` holds the single coverage value.
 */
export function scoreShape(template: Point[][], ink: Point[][], { rotations = [], closed = false, canvas = 1000 }: ShapeOptions = {}): Score {
  const zero: Score = { steps: [0], precision: 0, percent: 0, stars: 1 };
  const tPts = template.flat(), main = mainStrokes(ink).flat();
  if (!main.length || !tPts.length) return zero;
  const b = box(main);
  if (Math.max(b.w, b.h) < MIN_SIZE * canvas) return zero;
  const tb = box(tPts), k = SHAPE_SIZE / (Math.max(tb.w, tb.h) || 1);
  const guide = tPts.map((p) => [[{ x: (p.x - tb.x0) * k, y: (p.y - tb.y0) * k }]]); // one point per step: per-point coverage
  const t: Box = { x0: 0, y0: 0, w: tb.w * k, h: tb.h * k };
  const tolerance = SHAPE_TOLERANCE * SHAPE_SIZE, outline = guide.map(([[p]]) => p);
  let best = zero;
  for (const deg of [0, ...rotations]) {
    const boxed = fit(rotate(ink, deg), t);
    for (const fitted of [boxed, refine(boxed, outline)]) {
      const s = score(guide, fitted, { tolerance }); // the template, covered by her ink
      const back = score([fitted.map((st) => resample(st, INK_SPACING))], [outline], { tolerance }); // her ink, covered by the template
      let percent = Math.round((s.percent * back.percent) / 100);
      const open = closed && longestGap(s.steps) > CLOSE_GAP;
      if (open) percent = Math.min(Math.round(percent * OPEN_PENALTY), TWO_STARS - 1);
      const stars = percent >= THREE_STARS ? 3 : percent >= TWO_STARS ? 2 : 1;
      const r: Score = { steps: [s.steps.reduce((a, c) => a + c, 0) / s.steps.length], precision: s.precision, percent, stars };
      if (r.percent > best.percent || best === zero) best = r;
    }
  }
  return best;
}

/** The reaction level for a shape result: 3 stars great, 2 good, 1 try. */
export const reactionFor = (s: Score): Reaction => (s.stars === 3 ? 'great' : s.stars === 2 ? 'good' : 'try');
