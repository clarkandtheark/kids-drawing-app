// Learning path data (#36): path.json is in the production build and the service-worker precache, and the build /
// render scripts reject bad path files with a clear message. Node-side, so it lives here (tests/ is type-checked
// without @types/node).
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { precacheList } from '../vite.config';
import { line, touchStroke } from '../tests/helpers';

test('path.json is built into dist/, precached by the worker, and served offline', async ({ page, context }) => {
  expect(precacheList('dist')).toContain('path.json');
  expect(readFileSync('dist/sw.js', 'utf8')).toContain('"path.json"');
  // Whatever the curriculum is: its first stop, picked from the built path.json.
  const units = JSON.parse(readFileSync('dist/path.json', 'utf8'));
  expect(units.length).toBeGreaterThan(0);
  const [u] = units, [s] = u.stops;

  await page.addInitScript(() => Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak() {}, cancel() {}, getVoices: () => [] } }));
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.goto(`./#stop/${u.id}/${s.id}`);
  await expect(page.locator('#stop')).toBeVisible();
  await expect(page.locator('#sbar i')).toHaveCount(s.exercises.length);
});

test('offline after the first load: the path home screen draws and its current stop plays', async ({ page, context }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak() {}, cancel() {}, getVoices: () => [] } }));
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#path')).toBeVisible();
  const units = JSON.parse(readFileSync('dist/path.json', 'utf8'));
  await expect(page.locator('.unit')).toHaveCount(units.length);
  await expect(page.locator('.stop[data-state=current]')).toHaveCount(1);
  await page.locator('.stop[data-state=current]').tap();
  await expect(page.locator('#stop')).toBeVisible();
  // Whatever the curriculum's first exercise is (read from path.json): play it and it gets a result.
  const first = units[0].stops[0].exercises[0].type;
  await expect(page.locator('#stop')).toHaveAttribute('data-kind', first);
  await expect(page.locator('#stop')).toHaveAttribute('data-phase', 'draw', { timeout: 15_000 });
  if (first === 'lesson') { // the play button opens the linked lesson, offline too
    await page.locator('#sok').tap();
    await expect(page.locator('#lesson')).toBeVisible();
    return;
  }
  await touchStroke(page, line([200, 500], [800, 500], 30));
  await page.locator(first === 'create' ? '#stools [data-act=done]' : '#sok').tap();
  await expect(page.locator('#sbar i').first()).toHaveAttribute('data-r', /./, { timeout: 10_000 });
});

const ok = () => ({
  id: 'demo', title: 'Demo', emoji: '⭐',
  stops: [{ id: 'one', title: 'One', sticker: '⭐', exercises: [
    { type: 'trace', say: 'Trace it.', strokes: ['M 200 500 L 800 500'] },
    { type: 'shape', say: 'Draw it.', strokes: ['M 200 500 L 800 500'], also: [['M 200 450 L 500 550 L 800 450']], rotations: [90], closed: false },
    { type: 'memory', say: 'Remember it.', strokes: ['M 200 500 L 800 500'] },
    { type: 'finish', say: 'Finish it.', given: ['M 200 200 L 800 200'], strokes: ['M 200 500 L 800 500'], hint: true, open: true },
    { type: 'create', say: 'Make one.' },
    { type: 'lesson', lesson: 'sun' },
  ] }],
});
type U = ReturnType<typeof ok>;
type Ex = Record<string, unknown>;
const ex = (f: (xs: Ex[]) => void) => (u: U) => { f(u.stops[0].exercises as Ex[]); };

/** Run a script in a scratch dir holding lessons/sun.json and the given path files; returns exit code and stderr. */
function run(script: string, files: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'path-'));
  try {
    mkdirSync(join(dir, 'lessons'));
    mkdirSync(join(dir, 'path'));
    cpSync('lessons/sun.json', join(dir, 'lessons/sun.json'));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, 'path', name), typeof body === 'string' ? body : JSON.stringify(body));
    const r = spawnSync('node', [resolve(`scripts/${script}`)], { cwd: dir, encoding: 'utf8' });
    return { code: r.status, err: r.stderr, out: readOr(join(dir, 'public/path.json')) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const readOr = (f: string) => { try { return readFileSync(f, 'utf8'); } catch { return null; } };

test('the build accepts a good unit and rejects each kind of bad input with a clear message', () => {
  test.skip(test.info().project.name !== 'portrait', 'node-only: once is enough');
  const good = run('build-lessons.mjs', { '01-demo.json': ok() });
  expect(good.code, good.err).toBe(0);
  expect(JSON.parse(good.out!)[0].id).toBe('demo');

  const bad: [string, (u: U) => void, RegExp][] = [
    ['unknown type', ex((xs) => { xs[0].type = 'colour'; }), /unknown type "colour"/],
    ['missing say', ex((xs) => { delete xs[0].say; }), /missing field "say"/],
    ['missing strokes', ex((xs) => { delete xs[2].strokes; }), /memory\).*missing field "strokes"/],
    ['missing given', ex((xs) => { delete xs[3].given; }), /finish\).*missing field "given"/],
    ['missing lesson', ex((xs) => { delete xs[5].lesson; }), /missing field "lesson"/],
    ['unknown lesson', ex((xs) => { xs[5].lesson = 'nope'; }), /lesson "nope" does not exist/],
    ['unknown field', ex((xs) => { xs[1].rotation = [90]; }), /unknown field "rotation"/],
    ['bad rotations', ex((xs) => { xs[1].rotations = 'all'; }), /rotations must be an array/],
    ['also not a list', ex((xs) => { xs[1].also = 'M 0 0'; }), /also must be a non-empty array of alternatives/],
    ['also empty', ex((xs) => { xs[1].also = []; }), /also must be a non-empty array of alternatives/],
    ['also a bare path', ex((xs) => { xs[1].also = ['M 200 500 L 800 500']; }), /also\[0\] must be a non-empty array/],
    ['also bad stroke', ex((xs) => { xs[1].also = [['M 200 500 L 800 500'], ['M 200 500 l 100 0']]; }), /also\[1\]\[0\] illegal character "l"/],
    ['also on a trace', ex((xs) => { xs[0].also = [['M 200 500 L 800 500']]; }), /unknown field "also" for type trace/],
    ['open not boolean', ex((xs) => { xs[3].open = 'yes'; }), /open must be true or false/],
    ['open on a shape', ex((xs) => { xs[1].open = true; }), /unknown field "open" for type shape/],
    ['relative command', ex((xs) => { xs[0].strokes = ['M 200 500 l 100 0']; }), /illegal character "l"/],
    ['too few exercises', (u) => { u.stops[0].exercises.splice(2); }, /must have 3 to 7 exercises \(has 2\)/],
    ['too many exercises', (u) => { u.stops[0].exercises.push(...u.stops[0].exercises.slice(0, 2)); }, /must have 3 to 7 exercises \(has 8\)/],
    ['duplicate stop id', (u) => { u.stops.push(structuredClone(u.stops[0])); }, /duplicate stop id "one"/],
    ['missing sticker', (u) => { delete (u.stops[0] as Partial<U['stops'][0]>).sticker; }, /sticker must be a non-empty string/],
    ['id not matching the file', (u) => { u.id = 'other'; }, /does not match the file name/],
  ];
  for (const [name, change, msg] of bad) {
    const u = ok();
    change(u);
    const r = run('build-lessons.mjs', { '01-demo.json': u });
    expect(r.code, name).toBe(1);
    expect(r.err, name).toMatch(msg);
  }
  const dup = run('build-lessons.mjs', { '01-demo.json': ok(), '02-demo.json': ok() });
  expect(dup.code).toBe(1);
  expect(dup.err).toMatch(/duplicate unit id "demo"/);
  expect(run('build-lessons.mjs', { 'demo.json': ok() }).err).toMatch(/numeric|<number>-<unitId>/);
  expect(run('build-lessons.mjs', { '01-demo.json': '{ nope' }).err).toMatch(/invalid JSON/);
});

test('render:path rejects geometry outside 40..960 (the build cannot measure it), alternatives included', () => {
  test.skip(test.info().project.name !== 'portrait', 'node-only: once is enough');
  const u = ok();
  (u.stops[0].exercises[3] as Ex).given = ['M 200 500 C 200 -300 800 -300 800 500'];
  const r = run('render-path.mjs', { '01-demo.json': u });
  expect(r.code).toBe(1);
  expect(r.err).toMatch(/exercise 4 \(finish\) stroke "M 200 500 C.*outside 40\.\.960/);
  const v = ok();
  (v.stops[0].exercises[1] as Ex).also = [['M 200 500 L 990 500']];
  const a = run('render-path.mjs', { '01-demo.json': v });
  expect(a.code).toBe(1);
  expect(a.err).toMatch(/exercise 2 \(shape\) stroke "M 200 500 L 990 500".*outside 40\.\.960/);
});
