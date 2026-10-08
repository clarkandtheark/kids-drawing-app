// Lesson screen: colour canvas, SVG guide and ink canvas stacked in one square, plus icon controls.
import { caption } from './caption';
import { History } from './engine/history';
import { Surface } from './engine/surface';
import { react, showResult } from './grade';
import { COPY_TOLERANCE, reaction, samplePath, score, TOLERANCE, type Point } from './score';
import { COLOR_TIME, RESULT_CHEER } from './lines';
import { muted, prefetch, say, setMuted, stopSpeech } from './speech';
import { markCompleted, saveDrawing } from './store';
import { celebrate, layerPng, leave, mountTools, snapshot } from './tools';

export type Lesson = {
  id: string; title: string; difficulty: number; emoji: string; category?: 'characters' | 'settings';
  steps: { say: string; strokes: string[] }[];
};

const SVG = 'http://www.w3.org/2000/svg';
const DRAW_MS = 1500, PAUSE_MS = 400;
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const root = $('#lesson'), sheet = $('#sheet'), ref = $('#ref'), dots = $('#dots'), tools = $('#tools');
const guide = $<SVGSVGElement>('#guide');
const next = $<HTMLButtonElement>('#next'), prev = $<HTMLButtonElement>('#prev'), mute = $('#mute'), cap = $('#lcap');

let lesson: Lesson | null = null;
let step = 0;
let ink: Surface;
let color: Surface; // Color mode paints here, under the ink
let run = 0; // bumps to cancel an in-flight animation
// Grading: the lesson's guide sampled once (steps -> strokes -> points) and her tracing strokes, oldest first.
// In the tracing phase every undo-history entry is exactly one ink stroke (Surface.up commits, then calls
// onStroke; nothing else commits before Color mode), so the strokes still undoable are the last
// history.size ones and `kept` counts older strokes that fell off the history's limit and stay for good.
let guidePts: Point[][][];
let strokes: Point[][];
let kept = 0;
const tolerance = () => (root.dataset.mode === 'copy' ? COPY_TOLERANCE : TOLERANCE);
// A path stop playing this lesson as one of its exercises (src/stop.ts): told the stars when the result shows,
// and Done / Home go back to its route instead of the Library. Set just before routing to the lesson; cleared on close.
let back: { hash: string; scored: (stars: 1 | 2 | 3) => void } | null = null;
export const returnTo = (b: typeof back) => { back = b; };

export function openLesson(l: Lesson) {
  if (lesson === l) return;
  lesson = l;
  step = 0;
  const history = new History();
  const [c, i] = ['color', 'ink'].map((id) => Object.assign(document.createElement('canvas'), { id }));
  sheet.replaceChildren(c, i);
  color = new Surface(c, history);
  ink = new Surface(i, history);
  guidePts = l.steps.map((s) => s.strokes.map((d) => samplePath(d)));
  strokes = [];
  kept = 0;
  ink.onStroke = (pts) => { strokes.push(pts); kept = Math.max(kept, strokes.length - history.size); };
  placeGuide();
  dots.replaceChildren(...l.steps.map(() => document.createElement('i')));
  mute.ariaPressed = String(muted());
  root.hidden = false;
  showStep();
}

export function closeLesson() {
  if (!lesson) return;
  lesson = null;
  back = null;
  run++;
  stopSpeech();
  root.hidden = true;
  tools.replaceChildren();
  for (const c of sheet.querySelectorAll('canvas')) c.width = c.height = 0; // iOS frees canvas memory late
  sheet.replaceChildren();
}

/** The last step's checkmark: switch to Color mode. CSS hides the guide and step controls on phase=color. */
function finishLesson() {
  run++; // stop any guide animation; it would reset the phase
  root.dataset.phase = 'color';
  ink.history.clear(); // ponytail: undo in Color mode stops at the start of colouring, so it can't eat her lines
  mountTools(tools, color, ink, finishColoring);
  say(COLOR_TIME);
  caption(cap, COLOR_TIME);
}

/** Done in Color mode: save to the gallery and mark the lesson done while celebrating, then back to the Library. */
async function finishColoring() {
  const l = lesson!;
  const saved = Promise.all([save(), markCompleted(l.id)]);
  await Promise.all([celebrate(), saved.catch((e) => console.warn('save failed', e))]);
  if (lesson === l) location.hash = back?.hash ?? '#library';
}

/** Save her picture and both layers as a new drawing (the guide is SVG, never on these canvases). The
 * three PNG encodes run in parallel. Resolves with the new id, undefined if nothing persisted. */
async function save() {
  const l = lesson!;
  ink.history.dirty = false;
  const [png, i, c] = await Promise.all([snapshot([color, ink]), layerPng(ink), layerPng(color)]);
  return saveDrawing(png, l.id, Date.now(), { ink: i, color: c });
}

function placeGuide() {
  if (root.dataset.mode === 'copy') ref.append(guide);
  else sheet.querySelector('#color')!.after(guide);
}

function showStep() {
  const steps = lesson!.steps;
  const path = (d: string, cls: string) => {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    p.setAttribute('class', cls);
    return p;
  };
  guide.replaceChildren(
    ...steps.slice(0, step).flatMap((s) => s.strokes.map((d) => path(d, 'gray'))),
    ...steps[step].strokes.map((d) => path(d, 'now')),
  );
  [...dots.children].forEach((d, i) => d.className = i < step ? 'past' : i === step ? 'on' : '');
  prev.disabled = step === 0;
  const last = step === steps.length - 1;
  next.classList.toggle('done', last);
  next.ariaLabel = last ? 'Done' : 'Next';
  say(steps[step].say);
  prefetch([...steps.slice(step + 1).map((s) => s.say), ...RESULT_CHEER.slice(1), COLOR_TIME]); // what she hears next
  caption(cap, steps[step].say);
  animate();
}

/** Draw the current step's strokes one after another, pause, then leave them as the resting guide. */
async function animate() {
  const me = ++run;
  root.dataset.phase = 'anim';
  next.classList.remove('ready');
  const paths = [...guide.querySelectorAll<SVGPathElement>('.now')];
  for (const p of paths) for (const a of p.getAnimations()) a.cancel();
  const lens = paths.map((p) => p.getTotalLength());
  const total = lens.reduce((a, b) => a + b, 0) || 1;
  paths.forEach((p, i) => {
    p.classList.remove('rest');
    // gap of 2x length so the hidden dash's round cap can't peek out at the far end
    p.style.strokeDasharray = `${lens[i]} ${lens[i] * 2}`;
    p.style.strokeDashoffset = `${lens[i]}`;
  });
  try {
    for (const [i, p] of paths.entries()) {
      const a = p.animate([{ strokeDashoffset: lens[i] }, { strokeDashoffset: 0 }],
        { duration: Math.max(250, (DRAW_MS * lens[i]) / total), easing: 'ease-in-out', fill: 'forwards' });
      await a.finished;
      if (me !== run) return;
    }
  } catch { return; } // cancelled by a newer run
  await new Promise((r) => setTimeout(r, PAUSE_MS));
  if (me !== run) return;
  for (const p of paths) {
    for (const a of p.getAnimations()) a.cancel();
    p.style.strokeDasharray = p.style.strokeDashoffset = '';
    p.classList.add('rest');
  }
  root.dataset.phase = 'guide';
  next.classList.add('ready');
}

const on = (id: string, f: () => void) => $(id).addEventListener('click', f);
on('#next', () => {
  const last = step === lesson!.steps.length - 1, t = { tolerance: tolerance() };
  react(dots.children[step] as HTMLElement, reaction(score([guidePts[step]], strokes, t).steps[0]), !last); // the result chimes for the last
  if (last) {
    const s = score(guidePts, strokes, t);
    back?.scored(s.stars);
    return showResult(lesson!.id, s, finishLesson);
  }
  step++;
  showStep();
});
on('#prev', () => {
  if (step === 0) return;
  step--;
  showStep();
});
on('#replay', () => {
  say(lesson!.steps[step].say);
  animate();
});
// The caption's speaker: "show me again" while tracing; in Color mode just its line again.
cap.addEventListener('click', () => (root.dataset.phase === 'color' ? say(COLOR_TIME) : $('#replay').click()));
on('#undo', () => ink.history.undo().then(() => { strokes.length = Math.min(strokes.length, kept + ink.history.size); }));
on('#mode', () => {
  root.dataset.mode = root.dataset.mode === 'copy' ? 'trace' : 'copy';
  placeGuide();
  animate(); // show the reference drawing itself in its new place
});
on('#home', () => { const l = lesson; if (l) leave(ink.history, save, () => lesson === l, back?.hash ?? '#library'); });
on('#mute', () => {
  setMuted(!muted());
  mute.ariaPressed = String(muted());
  if (!muted() && root.dataset.phase !== 'color') say(lesson!.steps[step].say);
});
