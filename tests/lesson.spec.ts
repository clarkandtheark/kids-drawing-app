import { test, expect, type Page } from '@playwright/test';
import { ink, lessons, line, touchStroke } from './helpers';
import cat from '../lessons/cat.json' with { type: 'json' };

const N = cat.steps.length;

let errors: string[];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // Record speech instead of making noise.
  await page.addInitScript(() => {
    const said: string[] = ((window as any).__said = []);
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { speak: (u: SpeechSynthesisUtterance) => said.push(u.text), cancel() {}, getVoices: () => [] },
    });
  });
});
test.afterEach(() => expect(errors).toEqual([]));

const said = (page: Page) => page.evaluate(() => (window as any).__said as string[]);
const count = (page: Page, sel: string) => page.locator(sel).count();
const phase = (page: Page) => page.locator('#lesson').getAttribute('data-phase');
const openCat = async (page: Page) => {
  await page.goto('./#library');
  await page.locator('.card[data-id=cat]').tap();
  await expect(page.locator('#lesson')).toBeVisible();
};

test('picker shows a card per lesson; tapping cat opens it', async ({ page }) => {
  await page.goto('./#library');
  await expect(page.locator('.card')).toHaveCount((await lessons(page)).length);
  await expect(page.locator('.card[data-id=cat] svg path')).toHaveCount(cat.steps.flatMap((s) => s.strokes).length);
  await page.locator('.card[data-id=cat]').tap();
  await expect(page).toHaveURL(/#lesson\/cat$/);
  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('#sheet #guide')).toHaveCount(1);
  await page.locator('#home').tap();
  await expect(page.locator('.card')).toHaveCount((await lessons(page)).length);
  await expect(page.locator('#lesson')).toBeHidden();
});

test('walk the cat lesson: guide paths per step, ink persists, speech per step, colour then done returns home', async ({ page }) => {
  await openCat(page);
  await expect(page.locator('#prev')).toBeDisabled();
  let gray = 0, inked = 0;
  for (let i = 0; i < N; i++) {
    expect(await count(page, '#guide path.gray')).toBe(gray);
    expect(await count(page, '#guide path.now')).toBe(cat.steps[i].strokes.length);
    await expect(page.locator('#dots i.on')).toHaveCount(1);
    expect(await page.locator('#dots i').nth(i).getAttribute('class')).toBe('on');
    await expect(page.locator('#next')).toHaveAttribute('aria-label', i === N - 1 ? 'Done' : 'Next');
    if (i % 3 === 0) { // draw at some steps, ink must accumulate
      await touchStroke(page, line([100, 100 + i * 80], [900, 100 + i * 80]));
      const n = await ink(page);
      expect(n).toBeGreaterThan(inked);
      inked = n;
    }
    expect(await ink(page)).toBe(inked);
    if (i === 4) { // Previous keeps ink, goes back a step in the guide
      await page.locator('#prev').tap();
      expect(await count(page, '#guide path.now')).toBe(cat.steps[3].strokes.length);
      expect(await ink(page)).toBe(inked);
      await page.locator('#next').tap();
      expect(await ink(page)).toBe(inked);
    }
    gray += cat.steps[i].strokes.length;
    if (i < N - 1) await page.locator('#next').tap();
  }
  await expect(page.locator('#next')).toHaveClass(/done/);
  await expect.poll(() => phase(page)).toBe('guide');
  await expect(page.locator('#next')).toHaveClass(/ready/);
  const lines = await said(page);
  for (const s of cat.steps) expect(lines).toContain(s.say);
  expect(lines.at(-1)).toBe(cat.steps[N - 1].say);
  await page.locator('#next').tap(); // last checkmark: the result, then Color mode, then Done celebrates and goes home
  await page.locator('.result .go').tap();
  await expect(page.locator('#lesson')).toHaveAttribute('data-phase', 'color');
  await page.locator('[data-act=done]').tap();
  await expect(page.locator('#menu')).toBeVisible({ timeout: 5000 });
});

test('replay restarts the animation; undo removes the last stroke', async ({ page }) => {
  await openCat(page);
  await expect.poll(() => phase(page)).toBe('guide');
  await expect(page.locator('#sheet #guide .now.rest')).toHaveCount(1);
  const before = (await said(page)).length;
  await page.locator('#replay').tap();
  expect(await phase(page)).toBe('anim');
  await expect(page.locator('#guide .now.rest')).toHaveCount(0);
  expect((await said(page)).length).toBe(before + 1);
  await expect.poll(() => phase(page)).toBe('guide');

  await touchStroke(page, line([100, 100], [900, 100]));
  await touchStroke(page, line([100, 900], [900, 900]));
  await page.locator('#undo').tap();
  await expect.poll(() => ink(page, [0, 850, 1000, 950])).toBe(0);
  expect(await ink(page, [0, 50, 1000, 150])).toBeGreaterThan(0);
});

test('copy mode moves the reference beside the canvas and keeps ink', async ({ page }) => {
  await openCat(page);
  await touchStroke(page, line([200, 500], [800, 500]));
  const n = await ink(page);
  await page.locator('#mode').tap();
  await expect(page.locator('#sheet #guide')).toHaveCount(0);
  await expect(page.locator('#ref')).toBeVisible();
  await expect(page.locator('#ref #guide path.now')).toHaveCount(1);
  expect(await ink(page)).toBe(n);
  await touchStroke(page, line([200, 700], [800, 700]));
  const ref = (await page.locator('#ref').boundingBox())!, sheet = (await page.locator('#sheet').boundingBox())!;
  expect(overlap(ref, sheet)).toBe(false);
  await page.locator('#mode').tap();
  await expect(page.locator('#sheet #guide')).toHaveCount(1);
  await expect(page.locator('#ref')).toBeHidden();
  expect(await ink(page)).toBeGreaterThan(n);
});

test('mute persists across reload and silences every step', async ({ page }) => {
  await openCat(page);
  expect(await said(page)).toEqual([cat.steps[0].say]);
  await page.locator('#mute').tap();
  await expect(page.locator('#mute')).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.locator('#mute')).toHaveAttribute('aria-pressed', 'true');
  for (let i = 1; i < N; i++) await page.locator('#next').tap();
  await page.locator('#replay').tap();
  expect(await said(page)).toEqual([]);
  await page.locator('#mute').tap(); // unmuting speaks the current step
  expect(await said(page)).toEqual([cat.steps[N - 1].say]);
});

type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('every control is at least 64px and clear of the canvas, in both modes', async ({ page }) => {
  await openCat(page);
  for (const mode of ['trace', 'copy']) {
    if (mode === 'copy') await page.locator('#mode').tap();
    await expect.poll(() => phase(page)).toBe('guide');
    const sheet = (await page.locator('#sheet').boundingBox())!;
    const vp = page.viewportSize()!;
    expect(Math.min(sheet.width, sheet.height)).toBeGreaterThan(Math.min(vp.width, vp.height) * 0.9);
    const buttons = page.locator('#lesson button');
    expect(await buttons.count()).toBe(7);
    for (const b of await buttons.all()) {
      const r = (await b.boundingBox())!;
      expect(r.width).toBeGreaterThanOrEqual(64);
      expect(r.height).toBeGreaterThanOrEqual(64);
      expect(overlap(r, sheet), await b.getAttribute('id') ?? '').toBe(false);
      expect(r.x >= 0 && r.y >= 0 && r.x + r.width <= vp.width && r.y + r.height <= vp.height).toBe(true);
    }
    expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight)).toBe(true);
  }
});

test('review screenshots', async ({ page }, info) => {
  const name = (s: string) => `review/lesson-${s}-${info.project.name}.png`;
  await page.goto('./#library');
  await expect(page.locator('.card')).toHaveCount((await lessons(page)).length);
  await page.screenshot({ path: name('picker') });
  await page.locator('.card[data-id=cat]').tap();
  for (let i = 0; i < 3; i++) {
    await expect.poll(() => phase(page)).toBe('guide');
    await page.locator('#next').tap();
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: name('anim') });
  await expect.poll(() => phase(page)).toBe('guide');
  await touchStroke(page, Array.from({ length: 41 }, (_, i) => [500 + 200 * Math.cos(i / 6.5), 340 + 200 * Math.sin(i / 6.5)] as [number, number]));
  await touchStroke(page, line([330, 234], [295, 68]).concat(line([295, 68], [445, 148])));
  await page.screenshot({ path: name('trace') });
  await page.locator('#mode').tap();
  await expect.poll(() => phase(page)).toBe('guide');
  await page.screenshot({ path: name('copy') });
  await page.locator('#mode').tap();
  for (let i = 3; i < N - 1; i++) await page.locator('#next').tap();
  await expect.poll(() => phase(page)).toBe('guide');
  await page.screenshot({ path: name('last') });
});
