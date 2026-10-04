// Free draw: a blank canvas with the same colour tools as Color mode. Done saves it to the gallery.
import { History } from './engine/history';
import { Surface } from './engine/surface';
import { saveDrawing } from './store';
import { celebrate, layerPng, leave, mountTools, snapshot } from './tools';

const root = document.querySelector<HTMLElement>('#free')!;
const sheet = document.querySelector<HTMLElement>('#fsheet')!;
const tools = document.querySelector<HTMLElement>('#ftools')!;
let paint: Surface | null = null;

export function openDraw() {
  if (paint) return;
  const c = document.createElement('canvas');
  c.id = 'paint';
  sheet.replaceChildren(c);
  paint = new Surface(c, new History());
  mountTools(tools, paint, null, finish);
  root.hidden = false;
}

export function closeDraw() {
  if (!paint) return;
  const c = paint.canvas;
  paint = null;
  root.hidden = true;
  tools.replaceChildren();
  c.width = c.height = 0; // iOS frees canvas memory late
  sheet.replaceChildren();
}

/** Done: save to the gallery while celebrating, then go home. */
async function finish() {
  const p = paint!;
  await Promise.all([celebrate(), save(p).catch((e) => console.warn('save failed', e))]);
  if (paint === p) location.hash = '';
}

/** Save the picture and its one (colour) layer as a new drawing; resolves with its id, undefined if nothing persisted. */
async function save(p: Surface) {
  p.history.dirty = false;
  const [png, color] = await Promise.all([snapshot([p]), layerPng(p)]);
  return saveDrawing(png, null, Date.now(), { color });
}

document.querySelector('#fhome')!.addEventListener('click', () => {
  const p = paint;
  if (p) leave(p.history, () => save(p), () => paint === p);
});
