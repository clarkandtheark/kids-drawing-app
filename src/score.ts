// Tracing score: how much of each step's guide she covered, and how much of her ink sits on the guide.
// Pure functions in logical 0..1000 space; only samplePath touches the DOM.

export type Point = { x: number; y: number };
export type Reaction = 'great' | 'good' | 'try';
export type Score = { steps: number[]; precision: number; percent: number; stars: 1 | 2 | 3 };

// Calibration (GENEROUS, for a 6-year-old's finger). Tune these on a real iPad.
export const TOLERANCE = 28; // a guide point gets coverage credit if her nearest ink is within this many logical units
export const COPY_TOLERANCE = 70; // Copy mode: freehand copying from the reference panel is graded leniently
export const FULL_CREDIT = 0.6; // nearest ink within TOLERANCE times this earns full credit, fading linearly to none at TOLERANCE
export const PRECISION_TOLERANCE_FACTOR = 1.25; // ink counts as "on the guide" within TOLERANCE times this
export const INK_SPACING = 8; // ink strokes are resampled to this spacing so fast, sparse strokes still cover
export const PRECISION_OK = 0.6; // precision at or above this costs nothing
export const PRECISION_POWER = 3; // how hard precision below PRECISION_OK bites: (precision / PRECISION_OK) ^ this
export const CURVE = 0.7; // percent = raw ^ CURVE, so near-complete traces round up (0.9 -> 93, 0.8 -> 86)
export const SNAP_FULL = 0.95; // raw at or above this shows as 100%
export const THREE_STARS = 85; // percent for three stars
export const TWO_STARS = 60; // percent for two stars; anything below is one star (never zero)
export const REACT_GREAT = 0.8; // step coverage for a 'great' reaction
export const REACT_GOOD = 0.4; // step coverage for a 'good' reaction; below is 'try'

/** Sample an SVG path `d` string every `spacing` units (both ends included). */
export function samplePath(d: string, spacing = 8): Point[] {
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  const len = p.getTotalLength(), n = Math.max(1, Math.ceil(len / spacing));
  return Array.from({ length: n + 1 }, (_, i) => {
    const { x, y } = p.getPointAtLength((len * i) / n);
    return { x, y };
  });
}

/** Points of a polyline with consecutive points at most `spacing` apart. */
function resample(stroke: Point[], spacing: number): Point[] {
  const out = stroke.slice(0, 1);
  for (let i = 1; i < stroke.length; i++) {
    const a = stroke[i - 1], b = stroke[i];
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / spacing);
    for (let j = 1; j <= n; j++) out.push({ x: a.x + ((b.x - a.x) * j) / n, y: a.y + ((b.y - a.y) * j) / n });
  }
  return out;
}

/** Distance from q to the nearest of `points`, or Infinity beyond `r`. Points are bucketed in an
 *  r-sized grid so a query only looks at the 3x3 cells around q. */
function nearest(points: Point[], r: number) {
  const grid = new Map<string, Point[]>();
  for (const p of points) {
    const k = `${Math.floor(p.x / r)},${Math.floor(p.y / r)}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(p);
  }
  return (q: Point) => {
    const cx = Math.floor(q.x / r), cy = Math.floor(q.y / r);
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const p of grid.get(`${cx + dx},${cy + dy}`) ?? []) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
    }
    return best <= r ? best : Infinity;
  };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Score a lesson. `guide` is steps -> strokes -> sampled points; `ink` is all her strokes in any order
 * (every step is measured against all of it, so going back to fix an earlier line counts).
 */
export function score(guide: Point[][][], ink: Point[][], { tolerance = TOLERANCE }: { tolerance?: number } = {}): Score {
  const inkPts = ink.flatMap((s) => resample(s, INK_SPACING));
  const toInk = nearest(inkPts, tolerance), full = tolerance * FULL_CREDIT;
  const credit = (p: Point) => Math.min(1, Math.max(0, (tolerance - toInk(p)) / (tolerance - full)));
  const steps = guide.map((step) => mean(step.flat().map(credit)));
  const toGuide = nearest(guide.flat(2), tolerance * PRECISION_TOLERANCE_FACTOR);
  const precision = mean(inkPts.map((p) => (toGuide(p) < Infinity ? 1 : 0)));
  const coverage = mean(steps);
  const raw = coverage * Math.min(1, precision / PRECISION_OK) ** PRECISION_POWER;
  const percent = raw >= SNAP_FULL ? 100 : Math.round(100 * raw ** CURVE);
  return { steps, precision, percent, stars: percent >= THREE_STARS ? 3 : percent >= TWO_STARS ? 2 : 1 };
}

/** The quick reaction after a step, from that step's coverage. */
export const reaction = (coverage: number): Reaction =>
  coverage >= REACT_GREAT ? 'great' : coverage >= REACT_GOOD ? 'good' : 'try';
