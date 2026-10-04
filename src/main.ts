// Temporary harness for the drawing engine; replaced by the real screens later.
import { History } from './engine/history';
import { Surface, suppressGestures } from './engine/surface';

suppressGestures();
const ink = new Surface(document.querySelector<HTMLCanvasElement>('#ink')!, new History());

const $ = (id: string) => document.getElementById(id)!;
const eraser = $('eraser');
const swatches = [...document.querySelectorAll<HTMLButtonElement>('.swatch')];

$('undo').addEventListener('click', () => ink.history.undo());
eraser.addEventListener('click', () => {
  ink.eraser = !ink.eraser;
  ink.size = ink.eraser ? 40 : 14;
  eraser.ariaPressed = String(ink.eraser);
});
for (const b of swatches) b.addEventListener('click', () => {
  ink.color = b.dataset.color!;
  ink.eraser = false;
  ink.size = 14;
  eraser.ariaPressed = 'false';
  for (const s of swatches) s.ariaPressed = String(s === b);
});
