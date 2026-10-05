// Colour a saved drawing again. Reuses Free draw's screen (#free: sheet, tools, home button) and layout.
// Lesson drawings reopen as colour canvas under ink canvas (fill bounded by her lines); Free draw as one
// canvas; legacy flat-PNG drawings as one canvas she paints over (ponytail: no line protection for those).
import { History } from './engine/history';
import { LOGICAL, Surface } from './engine/surface';
import { getDrawing, saveDrawing, updateDrawing, type Drawing, type Layers } from './store';
import { askReplace, celebrate, layerPng, mountTools, snapshot } from './tools';

const root = document.querySelector<HTMLElement>('#free')!;
const sheet = document.querySelector<HTMLElement>('#fsheet')!;
const tools = document.querySelector<HTMLElement>('#ftools')!;
let open: { d: Drawing; color: Surface; ink: Surface | null } | null = null;
let wanted = 0; // the id being loaded or shown; a changed route cancels a slow load
let busy = false; // a dialog or save is in flight: ignore more Done / Home taps

/** Draw a saved PNG onto the surface, making it the committed baseline (not an undo step). */
async function load(s: Surface, blob: Blob) {
  const bm = await createImageBitmap(blob); // ponytail: no <img> fallback, every Safari that can install this has it
  s.ctx.drawImage(bm, 0, 0, LOGICAL, LOGICAL);
  bm.close();
  s.commit();
}

export async function openRecolor(id: number) {
  if (wanted === id) return;
  wanted = id;
  const d = await getDrawing(id);
  if (wanted !== id) return;
  if (!d) { wanted = 0; location.hash = '#gallery'; return; }
  const history = new History();
  const make = (name: string) => Object.assign(document.createElement('canvas'), { id: name });
  const layered = !!d.ink;
  const c = make(layered ? 'color' : 'paint'), i = layered ? make('ink') : null;
  sheet.replaceChildren(...(i ? [c, i] : [c]));
  const color = new Surface(c, history), ink = i && new Surface(i, history);
  if (i) i.style.pointerEvents = 'none'; // paint lands on the colour canvas below
  try {
    if (d.color) await load(color, d.color);
    else if (!layered) await load(color, d.png); // legacy: the flat picture is the canvas
    if (ink) await load(ink, d.ink!);
  } catch (e) {
    console.warn('could not open drawing', e);
    closeRecolor();
    location.hash = '#gallery';
    return;
  }
  if (wanted !== id) { for (const s of [c, i]) if (s) s.width = s.height = 0; return; }
  history.clear(); // the opened picture is the baseline: undo stops here
  history.dirty = false;
  open = { d, color, ink };
  mountTools(tools, color, ink, done);
  root.hidden = false;
}

export function closeRecolor() {
  wanted = 0;
  if (!open) return;
  open = null;
  root.hidden = true;
  tools.replaceChildren();
  for (const c of sheet.querySelectorAll('canvas')) c.width = c.height = 0; // iOS frees canvas memory late
  sheet.replaceChildren();
}

/** Store the result: over the original ('replace') or next to it ('both'). True once stored. */
async function save(choice: 'replace' | 'both') {
  const { d, color, ink } = open!;
  color.history.dirty = false;
  try {
    const [png, c] = await Promise.all([snapshot(ink ? [color, ink] : [color]), layerPng(color)]);
    const layers: Layers = ink ? { ink: d.ink, color: c } : { color: c }; // her lines never change: keep the saved bytes
    const ok = choice === 'replace' ? await updateDrawing(d.id, { png, ...layers }) : await saveDrawing(png, d.lessonId, Date.now(), layers);
    if (ok) return true;
  } catch (e) { console.warn('save failed', e); }
  color.history.dirty = true; // stay on screen with her work
  return false;
}

/** Ask what to do with her work, save it, go back to My Drawings. `trash` is offered when leaving via Home. */
async function finish(leaving: boolean) {
  const o = open;
  if (!o || busy) return;
  if (!o.color.history.dirty) { location.hash = leaving ? '' : '#gallery'; return; }
  busy = true;
  try {
    const choice = await askReplace(leaving);
    if (!choice || open !== o) return;
    if (choice === 'trash') { location.hash = ''; return; }
    if (!await save(choice) || open !== o) return;
    if (!leaving) await celebrate(); // Home leaves quietly
    if (open === o) location.hash = '#gallery';
  } finally { busy = false; }
}

const done = () => finish(false);
document.querySelector('#fhome')!.addEventListener('click', () => finish(true));
