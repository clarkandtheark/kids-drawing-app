// Engine behaviour, exercised on the lesson screen's ink canvas.
import { test, expect, type Page } from '@playwright/test';
import { ink, line, toClient, touchStroke, type P } from './helpers';

// Synthetic pen events (CDP cannot emit pointerType 'pen' with pressure on touch-emulated Chromium).
async function pen(page: Page, type: 'pointerdown' | 'pointermove' | 'pointerup', p: P, pressure: number) {
  const [[clientX, clientY]] = await toClient(page, [p]);
  await page.evaluate(({ type, clientX, clientY, pressure }) => {
    document.querySelector('#ink')!.dispatchEvent(new PointerEvent(type, {
      pointerId: 99, pointerType: 'pen', isPrimary: true, bubbles: true, clientX, clientY, pressure,
      buttons: type === 'pointerup' ? 0 : 1,
    }));
  }, { type, clientX, clientY, pressure });
}

// Vertical thickness (canvas px) of ink at logical column x.
const thickness = (page: Page, x: number) => page.evaluate((x) => {
  const c = document.querySelector<HTMLCanvasElement>('#ink')!, k = c.width / 1000;
  const d = c.getContext('2d')!.getImageData(Math.round(x * k), 0, 1, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++;
  return n;
}, x);

let errors: string[];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => localStorage.setItem('kids-drawing:muted', '1'));
  await page.goto('/#lesson/cat');
  await expect(page.locator('#ink')).toBeVisible();
});
test.afterEach(() => expect(errors).toEqual([]));

test('touch stroke puts ink on the canvas, crisp at devicePixelRatio', async ({ page }) => {
  expect(await ink(page)).toBe(0);
  await touchStroke(page, line([200, 200], [800, 600]));
  expect(await ink(page, [180, 180, 820, 620])).toBeGreaterThan(5000);
  const { width, css } = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#ink')!;
    return { width: c.width, css: c.getBoundingClientRect().width };
  });
  expect(width).toBeGreaterThanOrEqual(css * 2);
});

test('a tap leaves a dot', async ({ page }) => {
  await touchStroke(page, [[500, 500]]);
  expect(await ink(page, [490, 490, 510, 510])).toBeGreaterThan(50);
});

test('30 strokes then 30 undos returns to blank; extra undo is harmless', async ({ page }) => {
  for (let i = 0; i < 30; i++) await touchStroke(page, line([100, 60 + i * 30], [900, 60 + i * 30], 4));
  expect(await ink(page)).toBeGreaterThan(0);
  const undo = page.locator('#undo');
  for (let i = 0; i < 29; i++) await undo.tap();
  await expect.poll(() => ink(page, [0, 0, 1000, 75])).toBeGreaterThan(0); // first stroke still there
  await expect.poll(() => ink(page, [0, 75, 1000, 1000])).toBe(0);
  await undo.tap();
  await expect.poll(() => ink(page)).toBe(0);
  await undo.tap();
  await page.waitForTimeout(100);
  expect(await ink(page)).toBe(0);
  await touchStroke(page, line([200, 500], [800, 500])); // still draws afterwards
  expect(await ink(page)).toBeGreaterThan(0);
});

test('pen pressure varies line width', async ({ page }) => {
  await pen(page, 'pointerdown', [150, 500], 0.05);
  for (let x = 160; x <= 850; x += 10) await pen(page, 'pointermove', [x, 500], 0.05 + ((x - 150) / 700) * 0.95);
  await pen(page, 'pointerup', [850, 500], 0);
  const thin = await thickness(page, 250), thick = await thickness(page, 780);
  expect(thin).toBeGreaterThan(0);
  expect(thick).toBeGreaterThan(thin * 2);
});

test('touch is ignored while a pen is down', async ({ page }) => {
  await pen(page, 'pointerdown', [100, 100], 0.5);
  await touchStroke(page, line([300, 600], [800, 600]));
  expect(await ink(page, [250, 550, 850, 650])).toBe(0);
  await pen(page, 'pointerup', [100, 100], 0);
  expect(await ink(page, [80, 80, 120, 120])).toBeGreaterThan(0); // the pen's own dot
});

test('a palm stroke already in progress is dropped when the pen lands', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const palm = await toClient(page, line([300, 600], [800, 600]));
  const tp = ([x, y]: P) => [{ x, y, id: 1, radiusX: 20, radiusY: 20, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(palm[0]) });
  for (const p of palm.slice(1, 7)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(p) });
  expect(await ink(page, [250, 550, 850, 650])).toBeGreaterThan(0);
  await pen(page, 'pointerdown', [100, 100], 0.5);
  for (const p of palm.slice(7)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(p) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await pen(page, 'pointerup', [100, 100], 0);
  expect(await ink(page, [250, 550, 850, 650])).toBe(0);
  expect(await ink(page, [80, 80, 120, 120])).toBeGreaterThan(0);
});

test('drawing survives resize/rotation and input still maps correctly', async ({ page }, info) => {
  await touchStroke(page, line([200, 300], [800, 300]));
  const before = await ink(page);
  const vp = page.viewportSize()!;
  await page.setViewportSize({ width: vp.height, height: vp.width });
  await page.waitForTimeout(100);
  expect(await ink(page)).toBe(before);
  await touchStroke(page, line([200, 700], [800, 700]));
  expect(await ink(page, [180, 650, 820, 750])).toBeGreaterThan(before / 2);
  await page.setViewportSize(vp);
  await touchStroke(page, line([500, 100], [500, 900], 20));
  await touchStroke(page, Array.from({ length: 41 }, (_, i): P => [500 + 220 * Math.cos(i / 6.5), 500 + 220 * Math.sin(i / 6.5)]));
  await page.screenshot({ path: `review/engine-${info.project.name}.png` });
});
