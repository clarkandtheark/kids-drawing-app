// Path stop player, #stop/<unitId>/<stopId>: one stop of the learning path (path/*.json, built into path.json) is a
// short run of exercises on one square canvas. Each graded exercise is scored on the big check; a one-star first
// attempt gets one gentle retry; the end shows the stars and the stop's sticker and saves progress.
import { caption } from './caption';
import { History } from './engine/history';
import { LOGICAL, Surface } from './engine/surface';
import { react, star, tones } from './grade';
import { returnTo, type Lesson } from './lesson';
import { COPY_TOLERANCE, openAttempt, samplePath, score, TOLERANCE, type Point, type Reaction } from './score';
import { scoreShape } from './shape';
import { LESSON_SAY, STOP_CHEER } from './lines';
import { prefetch, say, stopSpeech } from './speech';
import { saveDrawing, savePathStop } from './store';
import { ask, celebrate, ICON, layerPng, mountTools, snapshot } from './tools';

export type Exercise =
  | { type: 'trace' | 'memory'; say: string; strokes: string[] }
  // also: accepted alternative templates (each a list of strokes), scored like `strokes`; the best wins. Only `strokes` is shown.
  | { type: 'shape'; say: string; strokes: string[]; also?: string[][]; rotations?: number[]; closed?: boolean }
  // open: any reasonable answer is right (openAttempt), `strokes` only marks where it goes.
  | { type: 'finish'; say: string; given: string[]; strokes: string[]; hint?: boolean; open?: boolean }
  | { type: 'create'; say: string }
  | { type: 'lesson'; lesson: string; say?: string };
export type Stop = { id: string; title: string; sticker: string; exercises: Exercise[] };
export type Unit = { id: string; title: string; emoji: string; stops: Stop[] };

/** Finish the picture: her added strokes are graded between tracing (TOLERANCE) and copying (COPY_TOLERANCE). */
export const FINISH_TOLERANCE = 48;
const DRAW_MS = 1500, PAUSE_MS = 400; // demonstration: like a lesson step
const MEMORY_MS = 3000, FADE_MS = 700; // memory: the drawing stays this long, then fades away
const REACT_MS = 1500, RETRY_MS = 1300; // the stars over the canvas; her one-star attempt before it clears
const ARM_MS = 900; // the result card ignores taps outside its button this long (like the tracing result)
const CUE_MS = 2200, CUE_PAD = 70; // finish: the glow over where the missing part goes; padding around its strokes (logical units)
const INTRO_MS = 2500, FLY_MS = 600; // make your own: the prompt on the blank canvas, then its flight up into the caption
const EXIT = ''; // the result and the close button go home: the path screen
const HOME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10" fill="#ffd34d"/><path d="M10 20v-5h4v5"/></svg>';

const SVG = 'http://www.w3.org/2000/svg';
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const root = $('#stop'), bar = $('#sbar'), sheet = $('#ssheet'), example = $<SVGSVGElement>('#sexample'), tools = $('#stools');
const ok = $<HTMLButtonElement>('#sok'), cap = $('#scap');
const guide = document.createElementNS(SVG, 'svg');
guide.id = 'sguide';
guide.setAttribute('viewBox', '0 0 1000 1000');

// One run through a stop. `results[i]` is exercise i's stars, 0 for a finished ungraded one (create). `away` while
// she is in a `lesson` exercise's lesson screen: the run survives the route change and resumes on the way back.
type Run = { key: string; stop: Stop; i: number; results: number[]; tries: number; away: boolean };
let cur: Run | null = null;
let lessons: Lesson[] = [];
let go: (hash: string) => void;
let ink: Surface | null = null;
// Her strokes for the current exercise, kept in step with undo exactly like lesson.ts: every history entry is one stroke.
let strokes: Point[][] = [];
let kept = 0;
let run = 0; // bumps to cancel an in-flight demonstration, reaction or timer
let card: HTMLElement | null = null;
let intro: HTMLElement | null = null;
let earned: string | null = null; // a stop finished for the first time, until the path screen plays its payoff

/** The `unitId/stopId` just finished for the first time (once; the path screen asks when it draws). */
export const takeEarned = () => { const k = earned; earned = null; return k; };

const ex = () => cur!.stop.exercises[cur!.i];
const seg = (i: number) => bar.children[i] as HTMLElement;
const phase = (p: 'demo' | 'draw' | 'busy' | 'result') => { root.dataset.phase = p; };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const reactionOf = (stars: number): Reaction => (stars >= 3 ? 'great' : stars === 2 ? 'good' : 'try');

/** `go` sets the hash and routes at once, so a lesson exercise opens inside the tap (iOS speech needs the gesture). */
export function openStop(u: Unit, s: Stop, all: Lesson[], goTo: (hash: string) => void) {
  const key = `${u.id}/${s.id}`;
  if (cur?.key === key && !root.hidden) return;
  lessons = all;
  go = goTo;
  const back = cur?.key === key && cur.away;
  if (!back) cur = { key, stop: s, i: 0, results: [], tries: 0, away: false };
  cur!.away = false;
  bar.replaceChildren(...s.exercises.map((_, i) => {
    const b = document.createElement('i');
    if (cur!.results[i] !== undefined) b.dataset.r = cur!.results[i] ? reactionOf(cur!.results[i]) : 'great';
    return b;
  }));
  root.hidden = false;
  const scored = back ? cur!.results[cur!.i] : undefined; // back from a lesson exercise whose result was shown
  showExercise(scored === undefined);
  if (scored !== undefined) done(scored);
}

export function closeStop() {
  if (root.hidden) return;
  run++;
  if (!cur?.away) { cur = null; stopSpeech(); } // into a lesson exercise: keep the run, and the lesson is already speaking
  root.hidden = true;
  card?.remove();
  card = null;
  tools.replaceChildren();
  release();
}

function release() {
  if (ink) ink.canvas.width = ink.canvas.height = 0; // iOS frees canvas memory late
  ink = null;
  sheet.replaceChildren();
  intro?.remove();
  intro = null;
}

const path = (d: string, cls: string) => {
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', d);
  p.setAttribute('class', cls);
  return p;
};

/** Set up the current exercise from scratch (also its retry and the memory replay): fresh canvas, prompt, demonstration. */
function showExercise(speak = true) {
  run++;
  const x = ex();
  root.dataset.kind = x.type;
  phase('draw');
  const on = seg(cur!.i);
  [...bar.children].forEach((b) => b.classList.toggle('on', b === on));
  delete on.dataset.r; // a retry's hollow 'try' look gives way to the current-exercise look
  // ponytail: a new canvas per exercise (old one released): simplest way to drop the colour tools' listeners after `create`
  release();
  const c = Object.assign(document.createElement('canvas'), { id: 'sink' });
  sheet.replaceChildren(guide, c);
  ink = new Surface(c, new History());
  strokes = [];
  kept = 0;
  ok.classList.remove('ready');
  ink.onStroke = (pts) => {
    strokes.push(pts);
    kept = Math.max(kept, strokes.length - ink!.history.size);
    ok.classList.add('ready');
  };
  example.replaceChildren(...(x.type === 'shape' ? x.strokes.map((d) => path(d, '')) : []));
  const l = x.type === 'lesson' ? lessons.find((l) => l.id === x.lesson) : undefined;
  guide.replaceChildren(...{
    trace: () => (x as { strokes: string[] }).strokes.map((d) => path(d, 'now')),
    memory: () => (x as { strokes: string[] }).strokes.map((d) => path(d, 'now')),
    finish: () => x.type === 'finish' ? [...(x.hint ? x.strokes.map((d) => path(d, 'hint')) : []), ...x.given.map((d) => path(d, 'given'))] : [],
    lesson: () => (l?.steps.flatMap((s) => s.strokes) ?? []).map((d) => path(d, 'thumb')),
    shape: () => [], create: () => [],
  }[x.type]());
  tools.replaceChildren();
  if (x.type === 'create') mountTools(tools, ink, null, createDone);
  if (speak) say(x.say ?? LESSON_SAY);
  prefetch([...cur!.stop.exercises.slice(cur!.i + 1).map((e) => e.say ?? LESSON_SAY), ...STOP_CHEER.slice(1)]); // what she hears next
  caption(cap, x.say ?? LESSON_SAY);
  if (x.type === 'create') showIntro(x.say, c);
  demo();
}

/** Make your own: the prompt big on the blank canvas, so it is never the first thing she sees without context; after a
 *  moment (or at her first touch) it flies up into the caption. Over the canvas but never in the way: no pointer events. */
function showIntro(text: string, c: HTMLCanvasElement) {
  const el = intro = document.createElement('p'), r = sheet.getBoundingClientRect();
  el.className = 'sintro';
  el.textContent = text;
  Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  root.append(el);
  const fly = () => {
    if (intro !== el) return;
    intro = null;
    const a = el.getBoundingClientRect(), b = cap.getBoundingClientRect();
    if (calm() || !b.width) return el.remove();
    const to = `translate(${b.x + b.width / 2 - a.x - a.width / 2}px, ${b.y + b.height / 2 - a.y - a.height / 2}px) scale(0.3)`;
    const rm = () => el.remove();
    el.animate([{}, { transform: to, opacity: 0 }], { duration: FLY_MS, easing: 'ease-in' }).finished.then(rm, rm);
  };
  c.addEventListener('pointerdown', fly, { once: true });
  setTimeout(fly, INTRO_MS);
}

/** Finish: a soft glow over where the missing part goes (the expected strokes' box, padded), without showing it. */
function showCue(strokes: string[]) {
  guide.querySelector('.cue')?.remove();
  const pts = strokes.flatMap((d) => samplePath(d)), xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs) - CUE_PAD, y0 = Math.min(...ys) - CUE_PAD;
  const r = document.createElementNS(SVG, 'rect');
  r.setAttribute('class', 'cue');
  for (const [k, v] of Object.entries({ x: x0, y: y0, width: Math.max(...xs) + CUE_PAD - x0, height: Math.max(...ys) + CUE_PAD - y0, rx: 60 })) r.setAttribute(k, String(v));
  guide.prepend(r);
  const rm = () => r.remove();
  if (calm()) return void setTimeout(rm, CUE_MS); // still: just there a moment
  r.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0.35, offset: 0.4 }, { opacity: 1, offset: 0.65 }, { opacity: 0 }],
    { duration: CUE_MS, easing: 'ease-in-out', fill: 'both' }).finished.then(rm, rm);
}

/** The exercise's demonstration: trace draws its guide, shape its example, memory shows the drawing then hides it. */
async function demo() {
  const me = ++run, x = ex();
  if (x.type === 'trace') {
    const paths = [...guide.querySelectorAll<SVGPathElement>('.now')];
    if (await drawOn(paths, me)) paths.forEach((p) => p.classList.add('rest'));
  } else if (x.type === 'shape') {
    await drawOn([...example.querySelectorAll('path')], me);
  } else if (x.type === 'finish') {
    showCue(x.strokes);
  } else if (x.type === 'memory') {
    phase('demo');
    ink!.enabled = false; // no drawing while she can see it
    if (!await drawOn([...guide.querySelectorAll<SVGPathElement>('.now')], me)) return;
    const dots = document.createElement('div'); // a countdown: one dot empties per second, then it hides
    dots.className = 'mcount';
    dots.innerHTML = [3, 2, 1].map((k) => `<i style="--d:${(k * MEMORY_MS) / 3 - 300}ms"></i>`).join('');
    sheet.append(dots);
    await wait(MEMORY_MS);
    dots.remove();
    if (me !== run) return;
    if (!calm()) await guide.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: 'ease-in' }).finished;
    if (me !== run) return;
    guide.replaceChildren();
    ink!.enabled = true;
    phase('draw');
  }
}

/** Draw the paths on one after another, then pause. False if a newer run cancelled it. */
async function drawOn(paths: SVGPathElement[], me: number) {
  for (const p of paths) { p.classList.remove('rest'); for (const a of p.getAnimations()) a.cancel(); }
  if (calm()) return me === run;
  const lens = paths.map((p) => p.getTotalLength()), total = lens.reduce((a, b) => a + b, 0) || 1;
  paths.forEach((p, i) => { p.style.strokeDasharray = `${lens[i]} ${lens[i] * 2}`; p.style.strokeDashoffset = `${lens[i]}`; });
  try {
    for (const [i, p] of paths.entries()) {
      await p.animate([{ strokeDashoffset: lens[i] }, { strokeDashoffset: 0 }],
        { duration: Math.max(250, (DRAW_MS * lens[i]) / total), easing: 'ease-in-out', fill: 'forwards' }).finished;
      if (me !== run) return false;
    }
  } catch { return false; }
  await wait(PAUSE_MS);
  if (me !== run) return false;
  for (const p of paths) {
    for (const a of p.getAnimations()) a.cancel();
    p.style.strokeDasharray = p.style.strokeDashoffset = '';
  }
  return true;
}

/** Stars for her `ink` on a graded exercise (trace, shape, memory, finish). Exported for the grading tests. */
export function grade(x: Exercise, ink: Point[][]): 1 | 2 | 3 {
  const sampled = (ds: string[]) => ds.map((d) => samplePath(d));
  if (x.type === 'shape') {
    const opts = { rotations: x.rotations, closed: x.closed, canvas: LOGICAL };
    return Math.max(...[x.strokes, ...(x.also ?? [])].map((t) => scoreShape(sampled(t), ink, opts).stars)) as 1 | 2 | 3;
  }
  if (x.type === 'finish' && x.open) return openAttempt(sampled(x.strokes), ink, sampled(x.given)) ? 3 : 1;
  const tolerance = x.type === 'memory' ? COPY_TOLERANCE : x.type === 'finish' ? FINISH_TOLERANCE : TOLERANCE;
  return score([sampled((x as { strokes: string[] }).strokes)], ink, { tolerance }).stars;
}

/** Exercise finished with `stars` (0: ungraded): the segment takes the result, stars pop over the canvas, then on. */
async function done(stars: number, sound = true) {
  const c = cur!, me = ++run;
  c.results[c.i] = stars;
  phase('busy');
  const s = seg(c.i);
  s.classList.remove('on');
  react(s, stars ? reactionOf(stars) : 'great', sound);
  if (stars) {
    const r = document.createElement('div');
    r.className = 'sreact';
    r.innerHTML = Array.from({ length: stars }, (_, i) => star(true).replace('<svg', `<svg style="--d:${i * 180}ms"`)).join('');
    sheet.append(r);
    await wait(REACT_MS);
    if (me !== run) return;
  }
  c.i++;
  c.tries = 0;
  if (c.i < c.stop.exercises.length) showExercise();
  else showResult();
}

/** One-star first attempt: the canvas wiggles, her attempt stays a moment, then the exercise starts over once. */
async function retry() {
  const me = ++run;
  cur!.tries++;
  phase('busy');
  react(seg(cur!.i), 'try');
  sheet.classList.remove('wiggle');
  void sheet.offsetWidth;
  sheet.classList.add('wiggle');
  await wait(RETRY_MS);
  sheet.classList.remove('wiggle');
  if (me === run) showExercise();
}

ok.addEventListener('click', () => {
  if (!cur || root.dataset.phase === 'busy') return;
  const x = ex();
  if (x.type === 'lesson') return startLesson(x.lesson);
  if (!strokes.length) { // nothing drawn: a little nudge and the prompt again, never onwards
    ok.classList.remove('nudge');
    void ok.offsetWidth;
    ok.classList.add('nudge');
    say(x.say);
    return;
  }
  const stars = grade(x, strokes);
  if (stars === 1 && cur.tries === 0) retry();
  else done(stars);
});
ok.addEventListener('animationend', () => ok.classList.remove('nudge'));

/** A `lesson` exercise: play the whole lesson; it reports its stars when its result shows and comes back here after. */
function startLesson(id: string) {
  const c = cur!;
  c.away = true;
  returnTo({ hash: `#stop/${c.key}`, scored: (stars) => { if (cur === c) c.results[c.i] = stars; } });
  go(`#lesson/${id}`);
}

/** Make your own: Done in the colour tools saves it to My Drawings (like Free draw) while celebrating; never graded. */
async function createDone() {
  const s = ink;
  if (!s || root.dataset.phase === 'busy') return;
  const me = ++run;
  phase('busy');
  await Promise.all([celebrate(), save(s).catch((e) => console.warn('save failed', e))]);
  if (me === run) done(0);
}

async function save(s: Surface) {
  s.history.dirty = false;
  const [png, color] = await Promise.all([snapshot([s]), layerPng(s)]);
  return saveDrawing(png, null, Date.now(), { color });
}

$('#sreplay').addEventListener('click', () => {
  if (!cur || root.dataset.phase === 'busy') return;
  const x = ex();
  if (x.type === 'memory') return showExercise(); // seeing it again starts the drawing over
  say(x.say ?? LESSON_SAY);
  demo();
});
cap.addEventListener('click', () => $('#sreplay').click()); // the caption's speaker: the same as "show me again"
$('#sundo').addEventListener('click', () => {
  const s = ink;
  s?.history.undo().then(() => {
    if (ink !== s) return;
    strokes.length = Math.min(strokes.length, kept + s.history.size);
    ok.classList.toggle('ready', strokes.length > 0);
  });
});

/** Close: straight home before anything is done, otherwise ask (keep going / leave; leaving drops this run). */
$('#sclose').addEventListener('click', async () => {
  const c = cur;
  if (!c) return;
  if (c.i === 0 && !strokes.length && !c.results.length) { location.hash = EXIT; return; }
  const r = await ask(`<button class="no" aria-label="Keep going">${ICON.back}</button><button class="yes" aria-label="Leave">${HOME}</button>`);
  if (r === 'yes' && cur === c) location.hash = EXIT;
});

/** End of the stop: stars (rounded average of the graded exercises, at least one), the sticker, a cheer. Saves progress. */
function showResult() {
  const c = cur!, graded = c.results.filter((r) => r > 0);
  const stars = (graded.length ? Math.max(1, Math.round(graded.reduce((a, b) => a + b, 0) / graded.length)) : 3) as 1 | 2 | 3;
  savePathStop(c.key, stars).then((fresh) => { if (fresh) earned = c.key; });
  phase('result');
  tools.replaceChildren(); // her last drawing stays under the card; closeStop releases it
  const el = card = document.createElement('div');
  el.className = 'result';
  el.innerHTML = `<div class="rcard"><div class="rstars">${[1, 2, 3].map((i) =>
    `<span style="--d:${300 + (i - 1) * 450}ms">${star(false)}${i <= stars ? star(true) : ''}</span>`).join('')}</div>
    <i class="sticker">${c.stop.sticker}</i><p class="cheer">${STOP_CHEER[stars]}</p>
    <button class="go home" aria-label="Home">${HOME}</button></div>`;
  document.body.append(el);
  say(STOP_CHEER[stars]);
  tones([523.25, 659.25, 784].slice(0, stars), { at: 0.3, gap: 0.45, len: 0.6 });
  tones([784, 1046.5, 1318.5, 1568], { at: 1.4, gap: 0.08, len: 0.5, vol: 0.1 }); // a sparkle as the sticker lands
  const t0 = performance.now();
  el.addEventListener('click', (e) => {
    if (!(e.target as Element).closest('.go') && performance.now() - t0 < ARM_MS) return;
    location.hash = EXIT;
  });
}
