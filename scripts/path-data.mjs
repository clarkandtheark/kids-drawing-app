// Learning-path data: read path/NN-<unitId>.json in file-name order and check everything that needs no browser.
// Shared by build-lessons.mjs (writes public/path.json) and render-path.mjs (adds the geometry bounds check).
// Paths are relative to the working directory, like the lessons.
import { readdir, readFile } from 'node:fs/promises';
import { loadLessons } from './scenes.mjs';

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/; // ids end up in the #stop/<unit>/<stop> route and the progress key
// Allowed fields per exercise type; a field not listed here is an error (catches typos like "rotation").
const FIELDS = {
  trace: { say: 1, strokes: 1 },
  shape: { say: 1, strokes: 1, also: 0, rotations: 0, closed: 0 },
  memory: { say: 1, strokes: 1 },
  finish: { say: 1, given: 1, strokes: 1, hint: 0, open: 0 },
  create: { say: 1 },
  lesson: { lesson: 1, say: 0 },
}; // 1 required, 0 optional
const MIN_EX = 3, MAX_EX = 7;

const text = (v) => typeof v === 'string' && v.trim() !== '';

function checkStrokes(v, e) {
  if (!Array.isArray(v) || !v.length) return e('must be a non-empty array of SVG path strings');
  v.forEach((d, i) => {
    if (typeof d !== 'string') return e(`[${i}] must be a string`);
    if (!d.trim().startsWith('M')) e(`[${i}] must start with M`);
    const bad = d.match(/[^MLHVCSQTAZ0-9\s,.+\-eE]/);
    if (bad) e(`[${i}] illegal character "${bad[0]}" (only absolute commands M L H V C S Q T A Z)`);
  });
}

function checkExercise(x, where, lessons, errs) {
  const e = (m) => errs.push(`${where}: ${m}`);
  if (!x || typeof x !== 'object') return e('must be an object');
  const spec = FIELDS[x.type];
  if (!spec) return e(`unknown type "${x.type}" (one of ${Object.keys(FIELDS).join(', ')})`);
  for (const k of Object.keys(x)) if (k !== 'type' && !(k in spec)) e(`unknown field "${k}" for type ${x.type}`);
  for (const [k, req] of Object.entries(spec)) if (req && !(k in x)) e(`missing field "${k}"`);
  if ('say' in x && !text(x.say)) e('say must be a non-empty string');
  for (const k of ['strokes', 'given']) if (k in x) checkStrokes(x[k], (m) => e(`${k}${m.startsWith('[') ? '' : ' '}${m}`));
  if ('also' in x) { // accepted alternatives: a non-empty array of stroke lists, each checked like `strokes`
    if (!Array.isArray(x.also) || !x.also.length) e('also must be a non-empty array of alternatives, each an array of SVG path strings');
    else x.also.forEach((alt, i) => checkStrokes(alt, (m) => e(`also[${i}]${m.startsWith('[') ? '' : ' '}${m}`)));
  }
  if ('rotations' in x && !(Array.isArray(x.rotations) && x.rotations.every((r) => Number.isFinite(r)))) e('rotations must be an array of numbers (degrees)');
  for (const k of ['closed', 'hint', 'open']) if (k in x && typeof x[k] !== 'boolean') e(`${k} must be true or false`);
  if ('lesson' in x && !lessons.has(x.lesson)) e(`lesson "${x.lesson}" does not exist in lessons/`);
}

/** Every lesson's id and strokes (from lessons/, scenes expanded), so `lesson` exercises can be checked and thumbnailed. */
export async function readLessons(dir = 'lessons') {
  const { lessons } = await loadLessons(dir);
  return new Map(lessons.map((l) => [l.id, l]));
}

/** All units in file-name order, and every problem found (empty when valid). Strokes are checked statically only. */
export async function loadPath(dir = 'path', lessons) {
  lessons ??= await readLessons();
  const errs = [], units = [], unitIds = new Set();
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.json')).sort();
  for (const f of files) {
    const e = (m) => errs.push(`${f}: ${m}`);
    const m = f.match(/^\d+-(.+)\.json$/);
    if (!m) { e('file name must be <number>-<unitId>.json, e.g. 01-lines.json'); continue; }
    let u;
    try { u = JSON.parse(await readFile(`${dir}/${f}`, 'utf8')); } catch (err) { e(`invalid JSON (${err.message})`); continue; }
    if (!u || typeof u !== 'object') { e('must be a JSON object'); continue; }
    if (u.id !== m[1]) e(`id "${u.id}" does not match the file name ("${m[1]}")`);
    if (!ID.test(u.id ?? '')) e('id must be lowercase letters, digits and dashes');
    else if (unitIds.has(u.id)) e(`duplicate unit id "${u.id}"`);
    unitIds.add(u.id);
    if (!text(u.title)) e('title must be a non-empty string');
    if (!text(u.emoji)) e('emoji must be a non-empty string');
    for (const k of Object.keys(u)) if (!['id', 'title', 'emoji', 'stops'].includes(k)) e(`unknown field "${k}"`);
    if (!Array.isArray(u.stops) || !u.stops.length) { e('stops must be a non-empty array'); continue; }
    const stopIds = new Set();
    u.stops.forEach((s, i) => {
      const where = `stop ${i + 1}${text(s?.id) ? ` "${s.id}"` : ''}`, se = (msg) => e(`${where}: ${msg}`);
      if (!s || typeof s !== 'object') return se('must be an object');
      if (!ID.test(s.id ?? '')) se('id must be lowercase letters, digits and dashes');
      else if (stopIds.has(s.id)) se(`duplicate stop id "${s.id}"`);
      stopIds.add(s.id);
      if (!text(s.title)) se('title must be a non-empty string');
      if (!text(s.sticker)) se('sticker must be a non-empty string (an emoji)');
      for (const k of Object.keys(s)) if (!['id', 'title', 'sticker', 'exercises'].includes(k)) se(`unknown field "${k}"`);
      if (!Array.isArray(s.exercises) || s.exercises.length < MIN_EX || s.exercises.length > MAX_EX)
        return se(`must have ${MIN_EX} to ${MAX_EX} exercises (has ${Array.isArray(s.exercises) ? s.exercises.length : 'none'})`);
      s.exercises.forEach((x, j) => checkExercise(x, `${f}: ${where} exercise ${j + 1}${x?.type ? ` (${x.type})` : ''}`, lessons, errs));
    });
    units.push(u);
  }
  return { units, errs, lessons };
}
