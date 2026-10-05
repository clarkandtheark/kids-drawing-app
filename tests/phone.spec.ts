// Every screen fits the viewport (#29). Written for the phone project (390 x 844); runs on the iPad projects too,
// where the same rules must already hold.
import { test, expect, type Page } from '@playwright/test';
import { line, toClient, touchStroke, type P } from './helpers';
import cloud from '../lessons/cloud.json' with { type: 'json' };

let errors: string[];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak() {}, cancel() {}, getVoices: () => [] } });
    (navigator as any).canShare = () => false;
  });
});
test.afterEach(() => expect(errors).toEqual([]));

type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const boxes = async (page: Page, sel: string) => Promise.all((await page.locator(sel).all()).map((b) => b.boundingBox() as Promise<Box>));

/**
 * No horizontal scroll, and every visible button / link / parent-area row lies inside the viewport. Inside a scroll
 * container (home, the gallery grid, the parent panel) only the width is checked: those may scroll vertically.
 * Returns the offenders so a failure names them.
 */
async function fits(page: Page) {
  const r = await page.evaluate(() => {
    const W = innerWidth, H = innerHeight, bad: string[] = [];
    for (const e of document.querySelectorAll<HTMLElement>('button, a[href], .pbtn')) {
      const b = e.getBoundingClientRect();
      if (!b.width || !b.height || getComputedStyle(e).visibility === 'hidden') continue;
      const name = `${e.id || e.className || e.tagName} ${e.ariaLabel ?? ''}`.trim();
      if (b.left < -0.5 || b.right > W + 0.5) bad.push(`${name}: x ${b.left.toFixed(1)}..${b.right.toFixed(1)} of ${W}`);
      if (!e.closest('.scroll') && (b.top < -0.5 || b.bottom > H + 0.5)) bad.push(`${name}: y ${b.top.toFixed(1)}..${b.bottom.toFixed(1)} of ${H}`);
    }
    return { scroll: document.documentElement.scrollWidth, W, bad };
  });
  expect(r.scroll, 'horizontal scroll').toBeLessThanOrEqual(r.W);
  expect(r.bad).toEqual([]);
}

/** A dialog's buttons: all inside the viewport, none overlapping another, every one 64px+. */
async function dialogOk(page: Page, n: number) {
  await expect(page.locator('.ask button')).toHaveCount(n);
  const vp = page.viewportSize()!, bs = await boxes(page, '.ask button');
  for (const [i, b] of bs.entries()) {
    expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(64);
    expect(b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width && b.y + b.height <= vp.height).toBe(true);
    for (const c of bs.slice(i + 1)) expect(overlap(b, c)).toBe(false);
  }
  await fits(page);
}

const sample = (page: Page, d: string, gap = 12) => page.evaluate(([d, gap]) => {
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d as string);
  const L = p.getTotalLength(), n = Math.max(4, Math.ceil(L / (gap as number)));
  return Array.from({ length: n + 1 }, (_, i) => { const q = p.getPointAtLength((L * i) / n); return [q.x, q.y] as P; });
}, [d, gap] as const);
const pixel = (page: Page, sel: string, [x, y]: P) => page.evaluate(([sel, x, y]) => {
  const c = document.querySelector<HTMLCanvasElement>(sel as string)!, k = c.width / 1000;
  return [...c.getContext('2d')!.getImageData(Math.floor((x as number) * k), Math.floor((y as number) * k), 1, 1).data];
}, [sel, x, y]);

test('Library: every lesson card and its title sit fully inside the screen; the path header is one row', async ({ page }) => {
  await page.goto('./#library');
  await expect(page.locator('.card')).not.toHaveCount(0);
  await fits(page);
  const vw = page.viewportSize()!.width;
  const cards = await page.locator('.card').evaluateAll((cs) => cs.map((c) => {
    const r = (e: Element) => e.getBoundingClientRect(), b = r(c), t = c.querySelector('span')!, s = r(t), g = r(c.querySelector('svg')!);
    return {
      id: (c as HTMLElement).dataset.id, card: [b.left, b.right], w: b.width,
      title: s.left >= b.left - 0.5 && s.right <= b.right + 0.5 && s.bottom <= b.bottom + 0.5 && t.scrollWidth <= t.clientWidth,
      thumb: g.left >= b.left - 0.5 && g.right <= b.right + 0.5 && g.bottom <= s.top + 0.5,
    };
  }));
  for (const c of cards) {
    expect(c.card[0], c.id).toBeGreaterThanOrEqual(0);
    expect(c.card[1], c.id).toBeLessThanOrEqual(vw);
    expect(c.w, c.id).toBeGreaterThanOrEqual(120); // a real card, not a sliver
    expect(c.title, `${c.id} title`).toBe(true);
    expect(c.thumb, `${c.id} thumbnail`).toBe(true);
  }
  await page.goto('./');
  await expect(page.locator('#path')).toBeVisible();
  await fits(page);
  for (const b of await boxes(page, '#top > *')) expect(b.y + b.height).toBeLessThan(150); // the header is one row
});

test('a lesson end to end by touch: trace, copy mode, result, Color mode tools, fill, brush, Done, gallery, viewer, re-colour', async ({ page }) => {
  test.setTimeout(90_000);
  const vp = page.viewportSize()!;
  await page.goto('./#library');
  await page.locator('.card[data-id=cloud]').tap();
  await expect(page.locator('#ink')).toBeVisible();
  const sheet = (await page.locator('#sheet').boundingBox())!;
  expect(sheet.width).toBeGreaterThan(Math.min(vp.width, vp.height) * 0.9); // the canvas fills the screen's short side
  await fits(page);
  for (const b of await boxes(page, '#lesson button:visible')) {
    expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(64);
    expect(overlap(b, sheet)).toBe(false);
  }

  await page.locator('#mode').tap(); // copy mode: the reference appears, clear of the canvas and the buttons
  const ref = (await page.locator('#ref').boundingBox())!;
  expect(ref.width).toBeGreaterThanOrEqual(120);
  expect(overlap(ref, (await page.locator('#sheet').boundingBox())!)).toBe(false);
  for (const b of await boxes(page, '#lesson button:visible')) expect(overlap(b, ref)).toBe(false);
  await fits(page);
  await page.locator('#mode').tap();

  for (let i = 0; i < cloud.steps.length; i++) {
    for (const d of cloud.steps[i].strokes) await touchStroke(page, await sample(page, d));
    await page.locator('#next').tap();
  }
  await expect(page.locator('.result')).toBeVisible();
  expect(parseInt((await page.locator('.result .pct').textContent())!)).toBeGreaterThanOrEqual(80);
  const card = (await page.locator('.rcard').boundingBox())!;
  expect(card.x >= 0 && card.y >= 0 && card.x + card.width <= vp.width && card.y + card.height <= vp.height).toBe(true);
  await fits(page);
  await page.locator('.result .go').tap();
  await expect(page.locator('#lesson')).toHaveAttribute('data-phase', 'color');

  // Every colour tool is on screen, clear of the canvas and of each other, and responds to a tap.
  await fits(page);
  const tools = await boxes(page, '#lesson button:visible'), canvas = (await page.locator('#sheet').boundingBox())!;
  for (const [i, b] of tools.entries()) {
    expect(overlap(b, canvas)).toBe(false);
    for (const c of tools.slice(i + 1)) expect(overlap(b, c)).toBe(false);
  }
  for (const c of await page.locator('.crayon').all()) {
    await c.tap();
    await expect(c).toHaveAttribute('aria-pressed', 'true');
  }
  for (const s of await page.locator('[data-size]').all()) {
    await s.tap();
    await expect(s).toHaveAttribute('aria-pressed', 'true');
  }
  for (const t of ['eraser', 'fill']) {
    await page.locator(`[data-tool=${t}]`).tap();
    await expect(page.locator(`[data-tool=${t}]`)).toHaveAttribute('aria-pressed', 'true');
    await page.locator(`[data-tool=${t}]`).tap();
  }
  await page.locator('[data-act=clear]').tap();
  await dialogOk(page, 2);
  await page.locator('.ask .no').tap();

  // A fill and a brush stroke land.
  await page.locator('.crayon[aria-label=yellow]').tap();
  await page.locator('[data-tool=fill]').tap();
  const [[fx, fy]] = await toClient(page, [[20, 20]]);
  await page.touchscreen.tap(fx, fy);
  expect(await pixel(page, '#color', [20, 20])).toEqual([0xff, 0xd2, 0x1f, 255]);
  await page.locator('[data-tool=fill]').tap();
  await page.locator('.crayon[aria-label=blue]').tap();
  await touchStroke(page, line([100, 960], [900, 960]));
  expect(await pixel(page, '#color', [500, 960])).toEqual([0x2f, 0x5b, 0xea, 255]);
  await page.locator('[data-act=undo]').tap();
  await expect.poll(() => pixel(page, '#color', [500, 960])).toEqual([0xff, 0xd2, 0x1f, 255]);

  await page.locator('[data-act=done]').tap();
  await expect(page.locator('.party')).toBeVisible();
  await expect(page.locator('#menu')).toBeVisible({ timeout: 5000 });

  await page.locator('#lhome').tap();
  await page.locator('#togallery').tap();
  await expect(page.locator('.pic')).toHaveCount(1);
  await fits(page);
  await page.locator('.pic').tap();
  await expect(page.locator('#view')).toBeVisible();
  const vbar = await boxes(page, '#vbar button');
  expect(vbar).toHaveLength(4);
  for (const [i, b] of vbar.entries()) {
    expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(64);
    expect(b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width && b.y + b.height <= vp.height).toBe(true);
    expect(overlap(b, (await page.locator('#vimg').boundingBox())!)).toBe(false);
    for (const c of vbar.slice(i + 1)) expect(overlap(b, c)).toBe(false);
  }
  await fits(page);
  await page.locator('#vbar .del').tap();
  await dialogOk(page, 2);
  await page.locator('.ask .no').tap();

  await page.locator('#vbar .color').tap(); // re-colour screen
  await expect(page.locator('#free #ink')).toBeVisible();
  await fits(page);
  await touchStroke(page, line([100, 40], [900, 40]));
  await page.locator('#fhome').tap();
  await dialogOk(page, 4); // back | replace | keep both | trash
  await page.locator('.ask .no').tap();
  await page.locator('[data-act=done]').tap();
  await dialogOk(page, 3); // back | replace | keep both
});

test('leave dialog, Free draw, empty gallery and the parent area fit', async ({ page }) => {
  await page.goto('./#lesson/cloud');
  await expect(page.locator('#ink')).toBeVisible();
  await touchStroke(page, line([100, 500], [900, 500]));
  await page.locator('#home').tap();
  await dialogOk(page, 3); // back | save | trash
  await page.locator('.ask .no').tap();

  await page.goto('./#draw');
  await expect(page.locator('#paint')).toBeVisible();
  await fits(page);
  const sheet = (await page.locator('#fsheet').boundingBox())!, vp = page.viewportSize()!;
  expect(sheet.width).toBeGreaterThan(Math.min(vp.width, vp.height) * 0.9);
  for (const b of await boxes(page, '#free button:visible')) expect(overlap(b, sheet)).toBe(false);

  await page.goto('./#gallery');
  await expect(page.locator('#empty')).toBeVisible();
  await fits(page);

  await page.goto('./');
  await page.locator('#logo').hover();
  await page.mouse.down();
  await page.waitForTimeout(3300);
  await page.mouse.up();
  await expect(page.locator('#parent')).toBeVisible();
  const panel = (await page.locator('#parent .panel').boundingBox())!;
  expect(panel.x >= 0 && panel.y >= 0 && panel.x + panel.width <= vp.width && panel.y + panel.height <= vp.height).toBe(true);
  await fits(page);
  await page.locator('#pclose').tap();
  await expect(page.locator('#parent')).toBeHidden();
});
