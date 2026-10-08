import type { Page } from '@playwright/test';

export type P = [number, number]; // logical 0..1000 coordinates

// Logical -> client CSS px, using the ink canvas's on-screen square.
export const toClient = (page: Page, pts: P[]) => page.evaluate((pts) => {
  const r = document.querySelector('#ink, #paint, #sink')!.getBoundingClientRect();
  return pts.map(([x, y]) => [r.left + (x / 1000) * r.width, r.top + (y / 1000) * r.height] as P);
}, pts);

export const line = (a: P, b: P, n = 12): P[] =>
  Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);

export async function touchStroke(page: Page, pts: P[]) {
  const cdp = await page.context().newCDPSession(page);
  const c = await toClient(page, pts);
  const tp = ([x, y]: P) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(c[0]) });
  for (const p of c.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(p) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** Serve `units` as path.json instead of the curriculum built from path/ (call before page.goto). */
export const usePath = (page: Page, units: unknown) => page.route('**/path.json', (r) => r.fulfill({ json: units }));

/** The lessons the Library shows (scenes are reached from the path, not the Library); tests must not assume how many there are. */
export const lessons = (page: Page) => page.request.get('/lessons.json').then((r) => r.json() as Promise<{ id: string; difficulty: number; category?: string }[]>)
  .then((ls) => ls.filter((l) => l.category !== 'scenes'));

// Count inked pixels in a logical-space rectangle (default whole canvas).
export const ink = (page: Page, [x0, y0, x1, y1] = [0, 0, 1000, 1000]) => page.evaluate(([x0, y0, x1, y1]) => {
  const c = document.querySelector<HTMLCanvasElement>('#ink, #paint, #sink')!, k = c.width / 1000;
  const d = c.getContext('2d')!.getImageData(x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n;
}, [x0, y0, x1, y1]);
