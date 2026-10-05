// Colour tools (crayons, brush sizes, eraser, fill bucket, undo, clear, Done) plus the Done flow helpers
// (snapshot, celebrate). The lesson's Color mode mounts them; Free draw mounts the same on a blank canvas.
import type { History } from './engine/history';
import { LOGICAL, type Surface } from './engine/surface';
import { say } from './speech';

export const COLORS: [string, string][] = [
  ['#e8402a', 'red'], ['#ff8a1f', 'orange'], ['#ffd21f', 'yellow'], ['#43c04f', 'green'],
  ['#4cc3ff', 'sky blue'], ['#2f5bea', 'blue'], ['#8e44d9', 'purple'], ['#ff7eb6', 'pink'],
  ['#ffd3b0', 'peach'], ['#d0925c', 'tan'], ['#7a4422', 'brown'], ['#262626', 'black'],
];
const SIZES = [20, 40, 80]; // logical units; the dots on the buttons are drawn at 14/26/44 px
const INK_WALL = 128; // line-art alpha above this stops the fill
const GROW = 2; // px the fill creeps under the line art, so anti-aliased edges show no white halo

const svg = (body: string, sw = 2.6) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
export const ICON = {
  eraser: svg('<path d="m3.5 15 9-9.5a2 2 0 0 1 2.8 0l4.2 4.2a2 2 0 0 1 0 2.8L13 19H7.5Z" fill="#ff9ec4"/><path d="m8 10.5 7 7" /><path d="M13 19h7.5"/>'),
  fill: svg('<path d="m4 11 7-7 8 8-7 7a2 2 0 0 1-2.8 0L4 13.8a2 2 0 0 1 0-2.8Z" fill="#fff4e0"/><path d="M4.2 12h14.6l-6.8 7a2 2 0 0 1-2.8 0Z" fill="var(--cur)" stroke="none"/><path d="m4 11 7-7 8 8-7 7a2 2 0 0 1-2.8 0L4 13.8a2 2 0 0 1 0-2.8Z"/><path d="M8 2.5 11 5.5"/><path d="M20.5 15.5s-2 2.4-2 3.7a2 2 0 0 0 4 0c0-1.3-2-3.7-2-3.7Z" fill="var(--cur)" stroke-width="1.6"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>', 2.8),
  trash: svg('<path d="M3.5 6.5h17"/><path d="M9 6.5V4h6v2.5"/><path d="M5.5 6.5 6.8 20a1.5 1.5 0 0 0 1.5 1.3h7.4a1.5 1.5 0 0 0 1.5-1.3l1.3-13.5" fill="#cfe8ff"/><path d="M10 10.5v7m4-7v7"/>'),
  back: svg('<path d="M19 12H5"/><path d="m11 5-7 7 7 7"/>', 3),
  star: svg('<path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.4 6.3-.9Z" fill="#ffd21f"/>', 1.6),
  // a picture, like the My Drawings button: "put it in my drawings"
  save: svg('<rect x="3" y="4" width="18" height="16" rx="3.5" fill="#fff"/><circle cx="9" cy="9.5" r="2" fill="#ffd21f" stroke="none"/><path d="m4.5 18 4.5-4.5 3.5 3 3-4 4.5 5.5Z" fill="#43c04f" stroke="none"/>', 2.2),
  // two pictures, one on top of the other: "keep both"
  both: svg('<rect x="2.5" y="3" width="14" height="12" rx="3" fill="#fff"/><rect x="7.5" y="8.5" width="14" height="12" rx="3" fill="#fff"/><circle cx="12.5" cy="13" r="1.5" fill="#ffd21f" stroke="none"/><path d="m10 19 3-3 2.5 2 2.5-3 2 4Z" fill="#43c04f" stroke="none"/>', 2.2),
};

/**
 * Mount the colour tools into `box`, driving `paint`. `lines` (optional) is line art stacked above
 * `paint`: it bounds the fill bucket and is never changed. `done` runs inside the Done tap (so it may
 * speak). The box gets the groups .crayons .sizes .modes .edits .finish; the screen's CSS places them
 * (e.g. `display: contents` on the box so they become cells of the screen's grid). To unmount, empty
 * the box; the canvases are expected to be thrown away with the screen.
 */
export function mountTools(box: HTMLElement, paint: Surface, lines: Surface | null, done: () => void) {
  let tool: 'brush' | 'eraser' | 'fill' = 'brush';
  box.innerHTML = `
    <div class="crayons">${COLORS.map(([c, n]) => `<button class="crayon" style="--c:${c}" data-color="${c}" aria-label="${n}"></button>`).join('')}</div>
    <div class="sizes group">${SIZES.map((s, i) => `<button data-size="${s}" aria-label="${['Thin', 'Medium', 'Fat'][i]} brush"><i style="--d:${[14, 26, 44][i]}px"></i></button>`).join('')}</div>
    <div class="modes group"><button data-tool="eraser" aria-label="Eraser">${ICON.eraser}</button><button data-tool="fill" aria-label="Fill">${ICON.fill}</button></div>
    <div class="edits group"><button data-act="undo" aria-label="Undo">${ICON.undo}</button><button data-act="clear" aria-label="Clear">${ICON.trash}</button></div>
    <div class="finish group"><button data-act="done" aria-label="Done">${ICON.star}</button></div>`;
  const all = (sel: string) => box.querySelectorAll<HTMLButtonElement>(sel);

  const sync = () => {
    paint.eraser = tool === 'eraser';
    paint.enabled = tool !== 'fill';
    box.style.setProperty('--cur', paint.color);
    for (const b of all('[data-color]')) b.ariaPressed = String(b.dataset.color === paint.color && tool !== 'eraser');
    for (const b of all('[data-size]')) b.ariaPressed = String(+b.dataset.size! === paint.size && tool !== 'fill');
    for (const b of all('[data-tool]')) b.ariaPressed = String(b.dataset.tool === tool);
  };
  paint.color = COLORS[0][0];
  paint.size = SIZES[1];
  sync();

  box.onclick = async (e) => { // onclick, not addEventListener: the box outlives a mount, a second listener would run Done twice
    const b = (e.target as Element).closest<HTMLButtonElement>('button');
    if (!b) return;
    const { color, size, tool: t, act } = b.dataset;
    if (color) { paint.color = color; if (tool === 'eraser') tool = 'brush'; }
    if (size) { paint.size = +size; if (tool === 'fill') tool = 'brush'; }
    if (t) tool = tool === t ? 'brush' : t as typeof tool; // tapping the active tool again goes back to the brush
    if (act === 'undo') paint.history.undo();
    if (act === 'clear' && await confirmTrash('Clear it')) paint.clear();
    if (act === 'done') done();
    sync();
  };

  paint.canvas.addEventListener('pointerdown', (e) => {
    if (tool !== 'fill' || paint.history.busy) return;
    const p = paint.toLogical(e.clientX, e.clientY), k = paint.resolution / LOGICAL;
    floodFill(paint, lines, Math.floor(p.x * k), Math.floor(p.y * k), paint.color);
  });
}

/**
 * Flood-fill the region of `paint` around canvas pixel (sx, sy) with `hex`, as one undo step. The region
 * is the connected pixels with the tapped pixel's exact colour that aren't under `lines` ink. Scanline
 * fill over typed arrays, then the fill grows GROW px into the walls around it (the `lines` ink, or other
 * paint on `paint` itself) and is composited underneath them, so their anti-aliased edges show no white halo.
 * Returns false (and records nothing) for a tap on ink, outside the canvas, or on a region already `hex`.
 */
export function floodFill(paint: Surface, lines: Surface | null, sx: number, sy: number, hex: string) {
  const R = paint.resolution;
  if (sx < 0 || sy < 0 || sx >= R || sy >= R) return false;
  const img = paint.ctx.getImageData(0, 0, R, R);
  const px = new Uint32Array(img.data.buffer);
  const seed = sy * R + sx, target = px[seed];
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const fill = new Uint32Array(new Uint8ClampedArray(rgb.concat(255)).buffer)[0];
  if (target === fill) return false;
  // mask: 0 open, 1 ink wall, 2 filled, 3.. grown into a wall (ink, or paint of another colour)
  const mask = new Uint8Array(R * R);
  if (lines) {
    const a = lines.ctx.getImageData(0, 0, R, R).data;
    for (let i = 0, j = 3; i < mask.length; i++, j += 4) if (a[j] > INK_WALL) mask[i] = 1;
    if (mask[seed]) return false;
  }

  let x0 = sx, x1 = sx, y0 = sy, y1 = sy;
  const stack = [seed];
  while (stack.length) {
    const i = stack.pop()!;
    if (mask[i] || px[i] !== target) continue;
    const y = (i / R) | 0, row = y * R;
    let l = i, r = i;
    while (l > row && !mask[l - 1] && px[l - 1] === target) l--;
    while (r < row + R - 1 && !mask[r + 1] && px[r + 1] === target) r++;
    mask.fill(2, l, r + 1);
    if (l - row < x0) x0 = l - row;
    if (r - row > x1) x1 = r - row;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    // Seed each open run in the rows above and below.
    for (let d = -R; d <= R; d += 2 * R) {
      if ((d < 0 && y === 0) || (d > 0 && y === R - 1)) continue;
      let run = false;
      for (let j = l + d; j <= r + d; j++) {
        const open = !mask[j] && px[j] === target;
        if (open && !run) stack.push(j);
        run = open;
      }
    }
  }

  for (let g = 0; g < GROW; g++) {
    const was = 2 + g;
    x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(R - 1, x1 + 1); y1 = Math.min(R - 1, y1 + 1);
    for (let y = y0; y <= y1; y++) for (let x = x0, i = y * R + x0; x <= x1; x++, i++) {
      if (mask[i] > 1 || (mask[i] === 0 && px[i] === target)) continue; // only walls grow
      // grow from pixels filled or grown in an earlier pass (values 2..was), not ones grown this pass
      const a = x > 0 ? mask[i - 1] : 0, b = x < R - 1 ? mask[i + 1] : 0;
      const c = y > 0 ? mask[i - R] : 0, d = y < R - 1 ? mask[i + R] : 0;
      if ((a >= 2 && a <= was) || (b >= 2 && b <= was) || (c >= 2 && c <= was) || (d >= 2 && d <= was)) mask[i] = was + 1;
    }
  }

  const d = img.data;
  for (let y = y0; y <= y1; y++) for (let i = y * R + x0, e = y * R + x1; i <= e; i++) {
    if (mask[i] < 2) continue;
    if (px[i] === target) { px[i] = fill; continue; }
    // other paint: put the fill underneath it (opaque paint stays as it is, a soft edge blends onto the fill)
    const j = i * 4, a = d[j + 3] / 255;
    for (let c = 0; c < 3; c++) d[j + c] = d[j + c] * a + rgb[c] * (1 - a);
    d[j + 3] = 255;
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  paint.ctx.putImageData(img, 0, 0, x0, y0, w, h);
  paint.commit({ x: x0, y: y0, w, h });
  return true;
}

/** Icon-only dialog with the given buttons; resolves with the tapped button's class, or null for a tap outside. */
export function ask(buttons: string) {
  const d = document.createElement('div');
  d.className = 'ask';
  d.innerHTML = `<div class="group">${buttons}</div>`;
  document.body.append(d);
  return new Promise<string | null>((resolve) => d.addEventListener('click', (e) => {
    const b = (e.target as Element).closest('button');
    if (!b && e.target !== d) return; // a tap on the box itself, between the buttons
    d.remove();
    resolve(b?.className ?? null);
  }));
}

/** Icon-only "really?" dialog (clear, delete, reset). Resolves true for the trash button, false for back or a tap outside. */
export const confirmTrash = async (yesLabel: string) =>
  await ask(`<button class="no" aria-label="Keep it">${ICON.back}</button><button class="yes" aria-label="${yesLabel}">${ICON.trash}</button>`) === 'yes';

/** Leaving with unsaved work: 'save' (the big picture button), 'trash', or null to keep drawing (back or a tap outside). */
export const askSave = async () => {
  const r = await ask(`<button class="no" aria-label="Keep drawing">${ICON.back}</button><button class="save" aria-label="Save it">${ICON.save}</button><button class="yes" aria-label="Throw it away">${ICON.trash}</button>`);
  return r === 'save' ? 'save' : r === 'yes' ? 'trash' : null;
};

/** Re-coloured drawing: 'replace' the saved one, 'both' (keep it and add a new one), or null to keep drawing.
 * `withTrash` (leaving via Home) adds a small trash button: 'trash'. */
export const askReplace = async (withTrash = false) => {
  const r = await ask(`<button class="no" aria-label="Keep drawing">${ICON.back}</button><button class="replace" aria-label="Replace the picture">${ICON.save}</button><button class="both" aria-label="Keep both pictures">${ICON.both}</button>${withTrash ? `<button class="yes" aria-label="Throw it away">${ICON.trash}</button>` : ''}`);
  return r === 'replace' || r === 'both' ? r : r === 'yes' ? 'trash' : null;
};

/** White background + colour + line art, as a square PNG (for the gallery). */
export function snapshot(layers: Surface[], size = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d')!;
  x.fillStyle = '#fff';
  x.fillRect(0, 0, size, size);
  for (const l of layers) x.drawImage(l.canvas, 0, 0, size, size);
  return new Promise<Blob>((resolve, reject) => c.toBlob((b) => {
    c.width = c.height = 0;
    if (b) resolve(b); else reject(new Error('toBlob failed'));
  }, 'image/png'));
}

/**
 * Home tap on a drawing screen. Without unsaved work (`history.dirty`) it just goes home. Otherwise it asks:
 * save runs `save` and goes home only once that stored something (a failed save stays, so nothing is lost),
 * trash goes home, back stays. `open()` is false once the screen has closed meanwhile (e.g. browser back).
 * `to` is the route to leave to instead of home.
 */
// ponytail: only the Home button asks. Browser back or an edited hash still discards unsaved work (the screen's
// close releases its canvases cleanly); the home-screen app on iPad has no back button. Route hashchange here if it gets one.
let leaving = false;
export async function leave(history: History, save: () => Promise<unknown>, open: () => boolean, to = '') {
  if (leaving) return;
  if (!history.dirty) { location.hash = to; return; }
  leaving = true;
  try {
    const choice = await askSave();
    if (!choice || !open()) return;
    if (choice === 'save' && !await save().catch((e) => console.warn('save failed', e))) {
      history.dirty = true;
      return;
    }
    if (open()) location.hash = to;
  } finally { leaving = false; }
}

/** One layer as a transparent PNG at the surface's full resolution (lossless for reopening). No temporary
 * canvas: it encodes the surface's own. Await it before the screen releases its canvases (width = 0). */
export const layerPng = (l: Surface) => new Promise<Blob>((resolve, reject) =>
  l.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));

const CHEERS = ['Hooray! You did it!', 'Wow, what a beautiful picture!', 'Amazing! Great job!'];
const CONFETTI = ['#e8402a', '#ff8a1f', '#ffd21f', '#43c04f', '#4cc3ff', '#8e44d9', '#ff7eb6'];

/** Full-screen confetti and a big star with a spoken cheer; resolves when it's over (~2.6s). Call from a tap. */
export function celebrate() {
  say(CHEERS[Math.floor(Math.random() * CHEERS.length)]);
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = document.createElement('div');
  el.className = calm ? 'party calm' : 'party';
  el.innerHTML = `<canvas></canvas>${ICON.star}`;
  document.body.append(el);
  const ms = calm ? 1800 : 2600;
  if (!calm) confetti(el.querySelector('canvas')!, ms);
  return new Promise<void>((r) => setTimeout(() => { el.remove(); r(); }, ms));
}

function confetti(c: HTMLCanvasElement, ms: number) {
  const k = devicePixelRatio, W = innerWidth, H = innerHeight;
  c.width = W * k; c.height = H * k;
  const x = c.getContext('2d')!;
  x.scale(k, k);
  const bits = Array.from({ length: 160 }, (_, i) => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = 9 + Math.random() * 14; // a fan bursting upward
    return {
      x: W / 2, y: H * 0.55, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
      w: 10 + Math.random() * 10, h: 6 + Math.random() * 8, c: CONFETTI[i % CONFETTI.length],
    };
  });
  const t0 = performance.now();
  const frame = (t: number) => {
    if (t - t0 > ms || !c.isConnected) return;
    x.clearRect(0, 0, W, H);
    x.globalAlpha = Math.min(1, (ms - (t - t0)) / 400); // fade out at the end
    for (const b of bits) {
      b.vy += 0.35; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
      x.save();
      x.translate(b.x, b.y);
      x.rotate(b.r);
      x.scale(1, Math.cos(b.r * 2)); // tumbling
      x.fillStyle = b.c;
      x.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      x.restore();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
