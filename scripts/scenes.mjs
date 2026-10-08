// Scenes: a whole picture in one lesson, its steps grouped into parts, where a part may reuse an ordinary lesson scaled
// and placed. Shared by build-lessons.mjs (expands scenes into ordinary lessons for the app), render-lessons.mjs and
// path-data.mjs. The format is documented in README.md ("Scenes"). No browser here: geometry is measured by flattening.
import { readdir, readFile } from 'node:fs/promises';

export const LO = 40, HIGH = 960; // every stroke's bounding box stays inside this, like every lesson
export const MIN_PARTS = 2, MAX_PARTS = 6, MAX_PART_STEPS = 12, MIN_STEPS = 8, MAX_STEPS = 40;
export const TINY = 24; // a referenced stroke whose whole box is smaller than TINY x TINY after scaling gets a warning
const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
// ponytail: arc flags must be separated ("0 1 1", not "011"); every lesson writes them that way
const TOKEN = /[MLHVCSQTAZ]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

/** A path's commands, each with its parameters (number strings as written). Implicit repeats ("L 1 2 3 4") become
 *  separate commands; extra pairs after M are L, as SVG says. Only the absolute commands this project allows. */
export function parsePath(d) {
  const toks = d.match(TOKEN) ?? [], out = [];
  for (let i = 0, cmd = ''; i < toks.length;) {
    if (/[A-Z]/.test(toks[i])) cmd = toks[i++];
    else if (!cmd) throw new Error(`numbers without a command: ${d.slice(0, 40)}`);
    const n = ARITY[cmd], args = toks.slice(i, i + n);
    if (args.length < n || args.some((a) => /[A-Z]/.test(a))) throw new Error(`${cmd} needs ${n} numbers`);
    out.push([cmd, args]);
    i += n;
    if (cmd === 'M') cmd = 'L';
    if (cmd === 'Z') cmd = '';
  }
  return out;
}

const num = (v) => String(Math.round(v * 100) / 100);

/** Scale `d` uniformly by k about the origin, then move it by (dx, dy). Arcs scale their radii and keep their rotation
 *  and flags; H and V stay H and V. Numbers are written to at most 2 decimals. */
export function transformPath(d, k, dx, dy) {
  const X = (v) => num(k * +v + dx), Y = (v) => num(k * +v + dy), R = (v) => num(k * +v);
  return parsePath(d).map(([c, a]) => {
    const p = c === 'H' ? [X(a[0])] : c === 'V' ? [Y(a[0])]
      : c === 'A' ? [R(a[0]), R(a[1]), num(+a[2]), a[3], a[4], X(a[5]), Y(a[6])]
      : a.map((v, i) => (i % 2 ? Y(v) : X(v)));
    return [c, ...p].join(' ');
  }).join(' ');
}

const quad = (x0, y0, x1, y1, x2, y2, t) => { const u = 1 - t; return [u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2]; };
const cubic = (x0, y0, x1, y1, x2, y2, x3, y3, t) => {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
  return [a * x0 + b * x1 + c * x2 + e * x3, a * y0 + b * y1 + c * y2 + e * y3];
};

/** An SVG arc's points after its start (endpoint to centre parameterisation, SVG 1.1 appendix F.6). */
function arc(x1, y1, rx, ry, rot, large, sweep, x2, y2, n) {
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry || (x1 === x2 && y1 === y2)) return [[x2, y2]];
  const phi = (rot * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const hx = (x1 - x2) / 2, hy = (y1 - y2) / 2, xp = cos * hx + sin * hy, yp = -sin * hx + cos * hy;
  const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const top = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp, bot = rx * rx * yp * yp + ry * ry * xp * xp;
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, top / bot));
  const cxp = (co * rx * yp) / ry, cyp = (-co * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
  return Array.from({ length: n }, (_, i) => {
    const t = t1 + (dt * (i + 1)) / n;
    return [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  });
}

/** Points along `d`, each curve cut into n pieces: a bounding box from them is within a fraction of a unit. */
export function pathPoints(d, n = 32) {
  const pts = [];
  let x = 0, y = 0, sx = 0, sy = 0, cx = 0, cy = 0, prev = ''; // pen, subpath start, last control point
  const seg = (f) => { for (let i = 1; i <= n; i++) pts.push(f(i / n)); };
  for (const [c, s] of parsePath(d)) {
    const a = s.map(Number), x0 = x, y0 = y;
    if (c === 'M') { [x, y] = a; sx = x; sy = y; pts.push([x, y]); }
    else if (c === 'L') { [x, y] = a; pts.push([x, y]); }
    else if (c === 'H') { x = a[0]; pts.push([x, y]); }
    else if (c === 'V') { y = a[0]; pts.push([x, y]); }
    else if (c === 'Z') { x = sx; y = sy; pts.push([x, y]); }
    else if (c === 'Q' || c === 'T') {
      const [qx, qy] = c === 'Q' ? a : prev === 'Q' || prev === 'T' ? [2 * x0 - cx, 2 * y0 - cy] : [x0, y0];
      [x, y] = a.slice(-2);
      cx = qx; cy = qy;
      seg((t) => quad(x0, y0, qx, qy, x, y, t));
    } else if (c === 'C' || c === 'S') {
      const [x1, y1] = c === 'C' ? a : prev === 'C' || prev === 'S' ? [2 * x0 - cx, 2 * y0 - cy] : [x0, y0];
      [cx, cy, x, y] = a.slice(-4);
      seg((t) => cubic(x0, y0, x1, y1, cx, cy, x, y, t));
    } else if (c === 'A') {
      [x, y] = a.slice(5);
      pts.push(...arc(x0, y0, a[0], a[1], a[2], a[3] !== 0, a[4] !== 0, x, y, n));
    }
    prev = c;
  }
  return pts;
}

/** [x0, y0, x1, y1] of the path's centre line (no stroke width), like the browser's getBBox. */
export function pathBox(d) {
  const p = pathPoints(d);
  return [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))];
}

const text = (v) => typeof v === 'string' && v.trim() !== '';
const PART_FIELDS = ['title', 'say', 'steps', 'ref', 'scale', 'x', 'y', 'omit'];
const SCENE_FIELDS = ['id', 'title', 'difficulty', 'category', 'emoji', 'parts'];

/** A step's problems (`n` names it in messages): the same rules as a lesson step. */
function checkStep(s, n, e) {
  if (!s || typeof s !== 'object') return e(`${n}: must be an object with say and strokes`);
  if (!text(s.say)) e(`${n}: say must be a non-empty string`);
  if (!Array.isArray(s.strokes) || s.strokes.length < 1 || s.strokes.length > 3) return e(`${n}: must have 1 to 3 strokes`);
  s.strokes.forEach((d, j) => {
    const m = `${n} stroke ${j + 1}`;
    if (typeof d !== 'string') return e(`${m}: must be a string`);
    if (!d.trim().startsWith('M')) return e(`${m}: must start with M`);
    const bad = d.match(/[^MLHVCSQTAZ0-9\s,.+\-eE]/);
    if (bad) return e(`${m}: illegal character "${bad[0]}" (only absolute commands M L H V C S Q T A Z)`);
    try { parsePath(d); } catch (err) { e(`${m}: ${err.message}`); }
  });
}

/**
 * Expand scene `s` (from file `file`.json) into an ordinary lesson: `steps` is every part's steps in order, each with
 * `part` (its part's index), and `parts` is [{ title, say, from, to }] (the part's steps are steps[from..to-1]).
 * `lessons` maps id to every raw lesson file, for `ref`. Returns { lesson, errs, warns }; lesson is null on any error.
 */
export function expandScene(s, file, lessons) {
  const errs = [], warns = [], e = (m) => errs.push(`${file}: ${m}`), fail = () => ({ lesson: null, errs, warns });
  if (s.id !== file) e(`id "${s.id}" does not match filename "${file}"`);
  if (!text(s.title)) e('title must be a non-empty string');
  if (![1, 2, 3].includes(s.difficulty)) e('difficulty must be 1, 2 or 3');
  if (s.category !== 'scenes') e('category must be "scenes" (a lesson with parts is a scene)');
  if (!text(s.emoji)) e('emoji must be a non-empty string');
  for (const k of Object.keys(s)) if (!SCENE_FIELDS.includes(k)) e(`unknown field "${k}"${k === 'steps' ? ' (a scene has parts, each with its own steps)' : ''}`);
  if (!Array.isArray(s.parts) || s.parts.length < MIN_PARTS || s.parts.length > MAX_PARTS) {
    e(`must have ${MIN_PARTS} to ${MAX_PARTS} parts (has ${Array.isArray(s.parts) ? s.parts.length : 'none'})`);
    return fail();
  }
  const steps = [], parts = [];
  s.parts.forEach((p, i) => {
    const where = `part ${i + 1}${text(p?.title) ? ` "${p.title}"` : ''}`, pe = (m) => e(`${where}: ${m}`), before = errs.length;
    if (!p || typeof p !== 'object') return pe('must be an object');
    for (const k of Object.keys(p)) if (!PART_FIELDS.includes(k)) pe(`unknown field "${k}"`);
    if (!text(p.title)) pe('title must be a non-empty string');
    if (!text(p.say)) pe('say must be a non-empty string');
    if ('steps' in p && (!Array.isArray(p.steps) || p.steps.length < 1 || p.steps.length > MAX_PART_STEPS)) return pe(`steps must be an array of 1 to ${MAX_PART_STEPS} steps`);
    const own = p.steps ?? [];
    own.forEach((st, j) => checkStep(st, `${where} step ${j + 1}`, e));
    const from = steps.length;
    if ('ref' in p) {
      const r = lessons.get(p.ref);
      if (!r) return pe(`ref "${p.ref}" is not a lesson in lessons/`);
      if (r.parts) return pe(`ref "${p.ref}" is a scene; a part can only reference an ordinary lesson`);
      if (!(typeof p.scale === 'number' && p.scale > 0 && p.scale <= 1)) pe('scale must be a number above 0, at most 1');
      for (const k of ['x', 'y']) if (!Number.isFinite(p[k])) pe(`${k} must be a number (where "${p.ref}"'s point 0,0 lands)`);
      const omit = p.omit ?? [];
      if (!Array.isArray(omit) || omit.some((n) => !Number.isInteger(n) || n < 0 || n >= r.steps.length))
        pe(`omit must be an array of "${p.ref}" step indexes, zero-based, 0 to ${r.steps.length - 1}`);
      if (errs.length > before) return;
      if (omit.length === r.steps.length && !own.length) return pe(`omits every step of "${p.ref}" and has no steps of its own`);
      r.steps.forEach((st, j) => {
        if (omit.includes(j)) return;
        const strokes = st.strokes.map((d) => transformPath(d, p.scale, p.x, p.y));
        strokes.forEach((d, m) => {
          const [x0, y0, x1, y1] = pathBox(d);
          if (x1 - x0 < TINY && y1 - y0 < TINY) warns.push(`${file}: WARNING ${where}: "${p.ref}" step index ${j} ("${st.say}") stroke ${m + 1} `
            + `is only ${Math.round(x1 - x0)}x${Math.round(y1 - y0)} after scaling, too small to trace; consider "omit": [${j}]`);
        });
        steps.push({ say: st.say, strokes, part: i });
      });
    } else {
      for (const k of ['scale', 'x', 'y', 'omit']) if (k in p) pe(`${k} only goes with ref`);
      if (!('steps' in p)) return pe(`needs steps (1 to ${MAX_PART_STEPS}) or a ref to a lesson`);
    }
    if (errs.length > before) return;
    for (const st of own) steps.push({ say: st.say, strokes: st.strokes, part: i });
    parts.push({ title: p.title, say: p.say, from, to: steps.length });
  });
  if (errs.length) return fail();
  if (steps.length < MIN_STEPS || steps.length > MAX_STEPS) e(`has ${steps.length} steps in all; a scene needs ${MIN_STEPS} to ${MAX_STEPS}`);
  steps.forEach((st, i) => st.strokes.forEach((d, j) => {
    const [x0, y0, x1, y1] = pathBox(d).map((v) => Math.round(v * 10) / 10), p = s.parts[st.part];
    if (x0 < LO || y0 < LO || x1 > HIGH || y1 > HIGH)
      e(`part ${st.part + 1} "${p.title}" step ${i - parts[st.part].from + 1} stroke ${j + 1}: bbox x ${x0}..${x1}, y ${y0}..${y1} is outside ${LO}..${HIGH}${p.ref ? ' after scaling' : ''}`);
  }));
  if (errs.length) return fail();
  const { id, title, difficulty, category, emoji } = s;
  return { lesson: { id, title, difficulty, category, emoji, steps, parts }, errs, warns };
}

/** Every lesson file in `dir` (ids starting with _ are review fixtures: left out unless `fixtures`), scenes expanded.
 *  Returns { lessons, errs, warns }; a scene with errors is left out of lessons. */
export async function loadLessons(dir = 'lessons', fixtures = false) {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json') && (fixtures || !f.startsWith('_'))).sort();
  const errs = [], warns = [], lessons = [], raw = new Map();
  for (const f of files) {
    try { raw.set(f.slice(0, -5), JSON.parse(await readFile(`${dir}/${f}`, 'utf8'))); }
    catch (err) { errs.push(`${f.slice(0, -5)}: invalid JSON (${err.message})`); }
  }
  const byId = new Map([...raw.values()].map((l) => [l.id, l]));
  for (const [file, l] of raw) {
    if (!l.parts) { lessons.push(l); continue; }
    const r = expandScene(l, file, byId);
    errs.push(...r.errs);
    warns.push(...r.warns);
    if (r.lesson) lessons.push(r.lesson);
  }
  return { lessons, errs, warns };
}
