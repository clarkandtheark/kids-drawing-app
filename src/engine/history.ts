import type { Surface } from './surface';

// One undo history shared by any number of surfaces (e.g. ink + colour layers).
// Each entry is the "before" pixels of the bounding box a change touched, on the surface it touched.
// Patches start as a small canvas and are swapped for a PNG blob once encoding finishes, so 50 levels
// of mostly-empty stroke patches cost a few MB instead of 11 MB per full-canvas snapshot.
// ponytail: a scribble covering the whole canvas is one full-size patch (~16 MB until its PNG is ready,
// then typically 0.5-2 MB); 50 such worst-case steps is ~100 MB. Add a byte budget if that ever bites.

export interface Patch {
  x: number; y: number; w: number; h: number; // canvas pixels
  img: HTMLCanvasElement | Blob;
}

export class History {
  static readonly LIMIT = 50;
  private stack: { target: Surface; patch: Patch }[] = [];
  private queue = Promise.resolve();
  private pending = 0;

  /** True while undos are being applied; surfaces don't start strokes then. */
  get busy() { return this.pending > 0; }
  get size() { return this.stack.length; }

  push(target: Surface, patch: Patch) {
    this.stack.push({ target, patch });
    if (this.stack.length > History.LIMIT) this.stack.shift();
    const img = patch.img;
    if (img instanceof HTMLCanvasElement) img.toBlob((b) => {
      if (!b) return;
      patch.img = b;
      img.width = img.height = 0; // release the bitmap now; iOS Safari is slow to GC canvases
    });
  }

  /** Undo the most recent change on any surface. Calls queue up; resolves when this one is applied. */
  undo(): Promise<void> {
    this.pending++;
    this.queue = this.queue.then(async () => {
      const e = this.stack.pop();
      if (!e) return;
      const img = e.patch.img instanceof Blob ? await createImageBitmap(e.patch.img) : e.patch.img;
      e.target.restore(e.patch, img);
      if (img instanceof ImageBitmap) img.close();
    }).catch((err) => console.error('undo failed', err)).finally(() => { this.pending--; });
    return this.queue;
  }

  clear() { this.stack = []; }
}
