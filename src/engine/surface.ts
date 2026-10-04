import { History, type Patch } from './history';

/** Logical drawing space is 0..LOGICAL on both axes (same as the lessons' 1000x1000 space). */
export const LOGICAL = 1000;
const PEN_GRACE_MS = 1000; // touches this soon after pen activity are treated as a resting palm

type Pt = { x: number; y: number; w: number };

/**
 * A square drawing surface on a canvas. The bitmap is a fixed square sized once for the largest
 * square this screen can show at its devicePixelRatio, and CSS scales it, so rotation/resize never
 * touches the pixels (lossless, no redraw). Lay the canvas out square (or use object-fit: contain);
 * pointer mapping assumes the drawing is the largest centered square inside the element box.
 */
export class Surface {
  color = '#2b2b2b';
  /** Line width in logical units (a lesson guide stroke is 14). */
  size = 14;
  eraser = false;
  /** False: pointers don't draw (e.g. the fill bucket handles taps itself). */
  enabled = true;
  readonly resolution: number;
  readonly ctx: CanvasRenderingContext2D;
  private before = document.createElement('canvas'); // last committed state, source of undo patches
  private bctx: CanvasRenderingContext2D;
  private active: number | null = null;
  private activePen = false;
  private lastPen = -Infinity;
  private rect!: DOMRect;
  private last!: Pt;
  private mid!: { x: number; y: number };
  private box = [0, 0, 0, 0];

  constructor(readonly canvas: HTMLCanvasElement, readonly history: History) {
    // ponytail: resolution fixed at creation from screen size; a window later made larger than the
    // screen (desktop, external display) upscales slightly. Fine for iPad, where screen is the ceiling.
    this.resolution = Math.min(2048, Math.ceil(Math.min(screen.width, screen.height) * devicePixelRatio));
    canvas.width = canvas.height = this.before.width = this.before.height = this.resolution;
    this.ctx = canvas.getContext('2d')!;
    this.bctx = this.before.getContext('2d')!;
    this.ctx.setTransform(this.resolution / LOGICAL, 0, 0, this.resolution / LOGICAL, 0, 0);
    this.ctx.lineCap = this.ctx.lineJoin = 'round';

    canvas.style.touchAction = 'none';
    canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false }); // no magnifier/callout
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('lostpointercapture', (e) => this.up(e));
  }

  /** Map client (CSS px) coordinates to logical 0..1000 space. */
  toLogical(clientX: number, clientY: number, r = this.canvas.getBoundingClientRect()) {
    const side = Math.min(r.width, r.height);
    return {
      x: ((clientX - r.left - (r.width - side) / 2) / side) * LOGICAL,
      y: ((clientY - r.top - (r.height - side) / 2) / side) * LOGICAL,
    };
  }

  /**
   * Record whatever changed on the canvas since the last commit as one undo step. Strokes call this
   * themselves; call it after painting on `ctx` directly (fill bucket, clear). `rect` is in canvas
   * pixels and defaults to the whole canvas.
   */
  commit(rect = { x: 0, y: 0, w: this.resolution, h: this.resolution }) {
    const x = Math.max(0, Math.floor(rect.x)), y = Math.max(0, Math.floor(rect.y));
    const w = Math.min(this.resolution, Math.ceil(rect.x + rect.w)) - x;
    const h = Math.min(this.resolution, Math.ceil(rect.y + rect.h)) - y;
    if (w <= 0 || h <= 0) return;
    const img = document.createElement('canvas');
    img.width = w; img.height = h;
    img.getContext('2d')!.drawImage(this.before, x, y, w, h, 0, 0, w, h);
    this.history.push(this, { x, y, w, h, img });
    this.bctx.clearRect(x, y, w, h);
    this.bctx.drawImage(this.canvas, x, y, w, h, x, y, w, h);
  }

  clear() {
    this.ctx.clearRect(0, 0, LOGICAL, LOGICAL);
    this.commit();
  }

  /** Called by History: put a patch back on both the visible and the committed bitmap. */
  restore(p: Patch, img: CanvasImageSource) {
    for (const c of [this.ctx, this.bctx]) {
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = 'source-over';
      c.clearRect(p.x, p.y, p.w, p.h);
      c.drawImage(img, p.x, p.y);
      c.restore();
    }
  }

  private down(e: PointerEvent) {
    if (!this.enabled) return;
    const pen = e.pointerType === 'pen';
    if (pen) this.lastPen = e.timeStamp;
    else if (e.pointerType === 'touch' && (this.activePen || e.timeStamp - this.lastPen < PEN_GRACE_MS)) return;
    if (this.active !== null) {
      // Palm rejection: a palm often lands before the pen. The pen wins and the palm's stroke is dropped.
      if (!pen || this.activePen) return;
      this.revert();
    }
    if (this.history.busy) return;
    this.active = e.pointerId;
    this.activePen = pen;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic or already-gone pointer */ }
    this.rect = this.canvas.getBoundingClientRect();
    const p = this.point(e);
    p.w = this.width(e, null);
    this.last = p;
    this.mid = p;
    this.box = [p.x, p.y, p.x, p.y];
    const c = this.ctx;
    c.globalCompositeOperation = this.eraser ? 'destination-out' : 'source-over';
    c.fillStyle = c.strokeStyle = this.color;
    c.beginPath(); // a tap with no movement leaves this dot
    c.arc(p.x, p.y, p.w / 2, 0, Math.PI * 2);
    c.fill();
  }

  private move(e: PointerEvent) {
    if (e.pointerId !== this.active) return;
    if (this.activePen) this.lastPen = e.timeStamp;
    const events = e.getCoalescedEvents?.() ?? [];
    for (const ev of events.length ? events : [e]) {
      const p = this.point(ev);
      if (Math.hypot(p.x - this.last.x, p.y - this.last.y) < 0.5) continue;
      p.w = this.width(ev, this.last.w);
      // Quadratic through midpoints: curve from the previous midpoint to the new one, controlled by the last point.
      const m = { x: (this.last.x + p.x) / 2, y: (this.last.y + p.y) / 2 };
      this.segment(this.mid, this.last, m, this.last.w);
      this.mid = m;
      this.last = p;
      this.box = [Math.min(this.box[0], p.x), Math.min(this.box[1], p.y), Math.max(this.box[2], p.x), Math.max(this.box[3], p.y)];
    }
  }

  private up(e: PointerEvent) {
    if (e.pointerId !== this.active) return;
    if (this.activePen) this.lastPen = e.timeStamp;
    this.segment(this.mid, this.last, this.last, this.last.w);
    this.active = null;
    this.activePen = false;
    // ponytail: pad by the max possible width rather than tracking per-point widths.
    const pad = (this.size * 1.6) / 2 + 2, k = this.resolution / LOGICAL;
    const [x0, y0, x1, y1] = this.box;
    this.commit({ x: (x0 - pad) * k, y: (y0 - pad) * k, w: (x1 - x0 + 2 * pad) * k, h: (y1 - y0 + 2 * pad) * k });
  }

  private revert() {
    const c = this.ctx;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'copy';
    c.drawImage(this.before, 0, 0);
    c.restore();
    this.active = null;
  }

  private segment(from: { x: number; y: number }, ctrl: { x: number; y: number }, to: { x: number; y: number }, w: number) {
    const c = this.ctx;
    c.lineWidth = w;
    c.beginPath();
    c.moveTo(from.x, from.y);
    c.quadraticCurveTo(ctrl.x, ctrl.y, to.x, to.y);
    c.stroke();
  }

  private point(e: PointerEvent): Pt {
    return { ...this.toLogical(e.clientX, e.clientY, this.rect), w: 0 };
  }

  /** Pen: pressure scales width 0.4x..1.6x of size, eased to avoid steps. Finger/mouse/eraser: constant. */
  private width(e: PointerEvent, prev: number | null) {
    if (e.pointerType !== 'pen' || this.eraser) return this.size;
    const target = this.size * (0.4 + 1.2 * (e.pressure || 0.5));
    return prev === null ? target : prev + (target - prev) * 0.4;
  }
}

/**
 * Stop iPad Safari page gestures (rubber-band scroll, pinch and double-tap zoom, text selection,
 * callouts) on the whole document. Safari ignores user-scalable=no, hence the non-passive listeners.
 * Exception: a one-finger touchmove that starts inside a `.scroll` container (home, gallery) may scroll;
 * two-finger moves and the gesture* (pinch) events stay blocked everywhere.
 */
export function suppressGestures() {
  const stop = (e: Event) => e.preventDefault();
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1 || !(e.target as Element).closest?.('.scroll')) e.preventDefault();
  }, { passive: false });
  for (const t of ['gesturestart', 'gesturechange', 'gestureend', 'contextmenu', 'selectstart']) {
    document.addEventListener(t, stop, { passive: false });
  }
  const s = document.documentElement.style;
  s.overscrollBehavior = 'none';
  s.touchAction = 'manipulation';
  s.userSelect = s.webkitUserSelect = 'none';
  s.setProperty('-webkit-touch-callout', 'none');
}
