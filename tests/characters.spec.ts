// Characters section (#31): lessons with category "characters" get their own section after level 3.
// The real character lessons may or may not be in the build, so the app is served fixture lessons instead.
import { test, expect, type Page } from '@playwright/test';
import { lessons, line, touchStroke } from './helpers';
import cat from '../lessons/cat.json' with { type: 'json' };

const FIX = ['fx-one', 'fx-two'];
let errors: string[];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak() {}, cancel() {}, getVoices: () => [] } });
  });
});
test.afterEach(() => expect(errors).toEqual([]));

/** Serve lessons.json with the fixtures appended (cat's steps under new ids, difficulty 1 and 3), or with no categorised lesson at all. */
async function serve(page: Page, withCharacters: boolean) {
  await page.route('**/lessons.json', async (route) => {
    const real = ((await (await route.fetch()).json()) as { category?: string }[]).filter((l) => !l.category);
    const fixtures = FIX.map((id, i) => ({ ...cat, id, title: `Fixture ${i + 1}`, difficulty: i ? 3 : 1, category: 'characters' }));
    await route.fulfill({ json: withCharacters ? [...real, ...fixtures] : real });
  });
}

test('characters: a fourth section after level 3 holds only the categorised lessons', async ({ page }) => {
  await serve(page, true);
  await page.goto('./#library');
  const sections = page.locator('#menu > section');
  await expect(sections).toHaveCount(4);
  await expect(sections.nth(3)).toHaveAttribute('data-category', 'characters');
  for (const n of [1, 2, 3]) await expect(sections.nth(n - 1)).toHaveAttribute('data-level', String(n));
  const ids = (sel: string) => page.locator(`${sel} .card`).evaluateAll((cs) => cs.map((c) => (c as HTMLElement).dataset.id));
  expect(await ids('section[data-category=characters]')).toEqual(FIX);
  for (const n of [1, 2, 3]) expect(await ids(`section[data-level="${n}"]`)).not.toEqual(expect.arrayContaining(FIX));
  await expect(page.locator('section[data-category=characters] .lvl svg')).toHaveCount(1);
  await expect(page.locator('section[data-category=characters] .lvl')).toHaveText(''); // icon only
  await expect(page.locator('.card')).toHaveCount((await page.locator('section[data-level] .card').count()) + FIX.length);
  const top = (s: string) => page.locator(s).evaluate((e) => e.getBoundingClientRect().top);
  expect(await top('section[data-category=characters]')).toBeGreaterThan(await top('section[data-level="3"]'));
  for (const c of await page.locator('section[data-category=characters] .card').all()) {
    await c.scrollIntoViewIfNeeded();
    const r = (await c.boundingBox())!;
    expect(r.width).toBeGreaterThanOrEqual(64);
    expect(r.height).toBeGreaterThanOrEqual(64);
  }
});

test('characters: a categorised lesson opens and plays like any other', async ({ page }) => {
  await serve(page, true);
  await page.goto('./#library');
  await page.locator('.card[data-id=fx-one]').scrollIntoViewIfNeeded();
  await page.locator('.card[data-id=fx-one]').tap();
  await expect(page).toHaveURL(/#lesson\/fx-one$/);
  await expect(page.locator('#lesson')).toBeVisible();
  await expect(page.locator('#guide path.now')).toHaveCount(cat.steps[0].strokes.length);
  await touchStroke(page, line([100, 500], [900, 500]));
  await page.locator('#next').tap();
  await expect(page.locator('#dots i').nth(1)).toHaveClass('on');
  await expect(page.locator('#guide path.now')).toHaveCount(cat.steps[1].strokes.length);
  await page.locator('#home').tap();
  await page.locator('.ask .yes').tap(); // she has drawn, so leaving asks first
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('section[data-category=characters] .card')).toHaveCount(FIX.length);
});

test('characters: with none present there is no fourth section', async ({ page }) => {
  await serve(page, false);
  await page.goto('./#library');
  await expect(page.locator('section[data-level="3"] .card').first()).toBeVisible();
  await expect(page.locator('#menu > section')).toHaveCount(3);
  await expect(page.locator('section[data-category]')).toHaveCount(0);
});

test('settings: a "Places" section after the characters, icon-only', async ({ page }) => {
  await page.route('**/lessons.json', async (route) => {
    const real = ((await (await route.fetch()).json()) as { category?: string }[]).filter((l) => !l.category);
    const fx = (id: string, category: string) => ({ ...cat, id, title: id, category });
    await route.fulfill({ json: [...real, fx('fx-char', 'characters'), fx('fx-beach', 'settings'), fx('fx-park', 'settings')] });
  });
  await page.goto('./#library');
  const sections = page.locator('#menu > section');
  await expect(sections).toHaveCount(5);
  await expect(sections.nth(3)).toHaveAttribute('data-category', 'characters');
  await expect(sections.nth(4)).toHaveAttribute('data-category', 'settings');
  await expect(page.locator('section[data-category=settings] .lvl svg')).toHaveCount(1);
  await expect(page.locator('section[data-category=settings] .lvl')).toHaveText(''); // icon only
  const ids = await page.locator('section[data-category=settings] .card').evaluateAll((cs) => cs.map((c) => (c as HTMLElement).dataset.id));
  expect(ids).toEqual(['fx-beach', 'fx-park']);
});

test('settings: the real setting lessons are built after the characters, beach to park', async ({ page }) => {
  const all = await lessons(page);
  expect(all.filter((l) => l.category === 'settings').map((l) => l.id)).toEqual(['beach', 'snowy-castle', 'seabed', 'park']);
  expect(all.findIndex((l) => l.category === 'settings')).toBeGreaterThan(all.map((l) => l.category).lastIndexOf('characters'));
});
