// Drives the app into every screen and state, deterministically, and screenshots each (see playwright.capture.config.ts).
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { line, touchStroke, type P } from '../../tests/helpers';
import cat from '../../lessons/cat.json' with { type: 'json' };

declare const process: { env: Record<string, string | undefined> };
const OUT = `review/phone/${process.env.SHOTS ?? 'final'}`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak() {}, cancel() {}, getVoices: () => [] } });
    (navigator as any).canShare = () => false;
    // Confetti and the floating step reactions are random / mid-flight: hide them so shots are byte-stable.
    addEventListener('DOMContentLoaded', () => document.head.insertAdjacentHTML('beforeend',
      '<style>.party canvas, #dots .pop { visibility: hidden !important; }</style>'));
  });
});

const shot = async (page: Page, info: TestInfo, name: string) => {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${OUT}/${info.project.name}/${name}.png`, fullPage: true, animations: 'disabled', caret: 'hide' });
};
const guideReady = (page: Page) => expect(page.locator('#lesson')).toHaveAttribute('data-phase', 'guide', { timeout: 5000 });
const circle = (cx: number, cy: number, r: number, n = 48): P[] =>
  Array.from({ length: n + 2 }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)]);

test('home, empty gallery, parent', async ({ page }, info) => {
  await page.goto('./');
  await expect(page.locator('.card')).not.toHaveCount(0);
  await shot(page, info, '01-home');
  await page.locator('#menu').evaluate((e) => { e.scrollTop = e.scrollHeight; });
  await shot(page, info, '02-home-end');
  await page.locator('#menu').evaluate((e) => { e.scrollTop = 0; });
  await page.locator('#logo').hover();
  await page.mouse.down();
  await page.waitForTimeout(3300);
  await page.mouse.up();
  await expect(page.locator('#parent')).toBeVisible();
  await shot(page, info, '03-parent');
  await page.goto('./#gallery');
  await expect(page.locator('#empty')).toBeVisible();
  await shot(page, info, '04-gallery-empty');
});

test('lesson, result, colour, dialogs, celebration, then gallery, viewer and re-colour', async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.goto('./#lesson/cat');
  await guideReady(page);
  await touchStroke(page, circle(500, 450, 220));
  await shot(page, info, '10-lesson-trace');
  await page.locator('#mode').tap();
  await guideReady(page);
  await shot(page, info, '11-lesson-copy');
  await page.locator('#mode').tap();
  await guideReady(page);
  await page.locator('#next').tap();
  await guideReady(page);
  await shot(page, info, '12-lesson-reaction');
  await page.locator('#home').tap();
  await expect(page.locator('.ask')).toBeVisible();
  await shot(page, info, '13-dialog-leave');
  await page.locator('.ask .no').tap();
  for (let i = 1; i < cat.steps.length; i++) { await page.locator('#next').tap(); if (i < cat.steps.length - 1) await guideReady(page); }
  await expect(page.locator('.result')).toBeVisible();
  await page.waitForTimeout(1800); // stars land
  await shot(page, info, '14-result');
  await page.locator('.result .go').tap();
  await expect(page.locator('#lesson')).toHaveAttribute('data-phase', 'color');
  await page.locator('[data-color="#4cc3ff"]').tap();
  await touchStroke(page, line([150, 850], [850, 850]));
  await shot(page, info, '15-color');
  await page.locator('[data-act=clear]').tap();
  await expect(page.locator('.ask')).toBeVisible();
  await shot(page, info, '16-dialog-clear');
  await page.locator('.ask .no').tap();
  await page.locator('[data-act=done]').tap();
  await expect(page.locator('.party')).toBeVisible();
  await shot(page, info, '17-celebration');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.card[data-id=cat] .score')).toBeVisible();
  await shot(page, info, '18-home-scored');

  await page.goto('./#draw');
  await expect(page.locator('#paint')).toBeVisible();
  await touchStroke(page, line([150, 300], [850, 700]));
  await shot(page, info, '20-free');
  await page.locator('[data-act=done]').tap();
  await expect(page.locator('#menu')).toBeVisible({ timeout: 5000 });

  await page.goto('./#gallery');
  await expect(page.locator('.pic')).toHaveCount(2);
  await expect.poll(() => page.locator('.pic img').evaluateAll((i) => i.every((x) => (x as HTMLImageElement).complete))).toBe(true);
  await shot(page, info, '30-gallery');
  await page.locator('.pic').nth(1).tap();
  await expect(page.locator('#view')).toBeVisible();
  await expect.poll(() => page.locator('#vimg').evaluate((i) => (i as HTMLImageElement).complete)).toBe(true);
  await shot(page, info, '31-viewer');
  await page.locator('#vbar .del').tap();
  await shot(page, info, '32-dialog-delete');
  await page.locator('.ask .no').tap();
  await page.locator('#vbar .color').tap();
  await expect(page.locator('#ink')).toBeVisible();
  await touchStroke(page, line([150, 150], [850, 150]));
  await shot(page, info, '33-recolor');
  await page.locator('#fhome').tap();
  await expect(page.locator('.ask .both')).toBeVisible();
  await shot(page, info, '34-dialog-replace');
});
