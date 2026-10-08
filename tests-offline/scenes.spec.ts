// Scenes (#53), node side: the path transformer, the build's expansion and validation, the voice check and the render's
// part sheets. Node-side, so it lives here (tests/ is type-checked without @types/node); tests/scenes.spec.ts plays one.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathBox, transformPath } from '../scripts/scenes.mjs';

test.beforeEach(() => { test.skip(test.info().project.name !== 'portrait', 'node-only: once is enough'); });

const cat = JSON.parse(readFileSync('lessons/cat.json', 'utf8'));
const all = readdirSync('lessons').filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(`lessons/${f}`, 'utf8')));
const own = (n: number, say = 'Draw a line.') => Array.from({ length: n }, (_, i) => ({ say: `${say} ${i + 1}`, strokes: [`M 100 ${100 + i * 20} L 300 ${100 + i * 20}`] }));
type Part = Record<string, unknown>;
const scene = (parts: Part[] = [
  { title: 'Ground', say: 'First the ground.', steps: own(3) },
  { title: 'Cat', say: 'Now the cat.', ref: 'cat', scale: 0.5, x: 400, y: 300, omit: [7, 8], steps: own(1, 'A box.') },
]) => ({ id: 'fx-scene', title: 'Fixture scene', difficulty: 3, category: 'scenes', emoji: '🐱', parts });

/** Run a script in a scratch dir holding lessons/cat.json and `files` (lessons/<name>); exit code, stdout, stderr and the built lessons. */
function run(script: string, files: Record<string, unknown>, extra = (_dir: string) => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'scene-'));
  try {
    mkdirSync(join(dir, 'lessons'));
    cpSync('lessons/cat.json', join(dir, 'lessons/cat.json'));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, 'lessons', name), JSON.stringify(body));
    extra(dir);
    const r = spawnSync('node', [resolve(`scripts/${script}`), ...(script === 'render-lessons.mjs' ? ['fx-scene'] : [])], { cwd: dir, encoding: 'utf8' });
    const out = existsSync(join(dir, 'public/lessons.json')) ? JSON.parse(readFileSync(join(dir, 'public/lessons.json'), 'utf8')) : null;
    const sheets = existsSync(join(dir, 'review/fx-scene')) ? readdirSync(join(dir, 'review/fx-scene')).sort() : [];
    return { code: r.status, out: r.stdout, err: r.stderr, lessons: out, sheets };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('transformer: scale 1 offset 0 is the identity on every stroke in lessons/', () => {
  const norm = (d: string) => d.trim().replace(/\s+/g, ' ').replace(/-?\d*\.?\d+/g, (n) => String(+n));
  let n = 0;
  for (const l of all) for (const s of l.steps ?? l.parts.flatMap((p: { steps?: unknown[] }) => p.steps ?? [])) for (const d of s.strokes) {
    expect(transformPath(d, 1, 0, 0), d).toBe(norm(d));
    n++;
  }
  expect(n).toBeGreaterThan(300);
  // every command: H/V keep their letter, arcs scale their radii and keep rotation and flags (rotation's number rewritten: -8.0 is -8)
  expect(transformPath('M 10 20 L 30 40 H 50 V 60 C 1 2 3 4 5 6 S 7 8 9 10 Q 11 12 13 14 T 15 16 A 10 20 30 1 0 70 80 Z', 2, 100, 1000))
    .toBe('M 120 1040 L 160 1080 H 200 V 1120 C 102 1004 106 1008 110 1012 S 114 1016 118 1020 Q 122 1024 126 1028 T 130 1032 A 20 40 30 1 0 240 1160 Z');
  expect(transformPath('M 0 0 L 1 1 2 2', 1, 5, 5)).toBe('M 5 5 L 6 6 L 7 7'); // implicit repeats
});

test('transformer: a scaled circle, and every scaled character stroke, measure in the browser as the scaled box', async ({ page }) => {
  const circle = 'M 300 500 A 200 200 0 1 1 700 500 A 200 200 0 1 1 300 500 Z';
  const strokes = [circle, ...all.filter((l) => l.category === 'characters').flatMap((l) => l.steps.flatMap((s: { strokes: string[] }) => s.strokes))];
  const k = 0.45, dx = 120, dy = 333;
  await page.setContent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"></svg>');
  const boxes = await page.evaluate((ds) => ds.map((d) => {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    document.querySelector('svg')!.append(p);
    const b = p.getBBox();
    return [b.x, b.y, b.x + b.width, b.y + b.height];
  }), strokes.map((d) => transformPath(d, k, dx, dy)));
  expect(boxes[0].map((v) => Math.round(v))).toEqual([k * 300 + dx, k * 300 + dy, k * 700 + dx, k * 700 + dy].map(Math.round));
  strokes.forEach((d, i) => { // the node-side measure the build uses agrees with the browser's
    const mine = pathBox(transformPath(d, k, dx, dy));
    mine.forEach((v, j) => expect(Math.abs(v - boxes[i][j]), d).toBeLessThan(0.75));
  });
});

test('build: a scene expands into ordinary steps with parts, ref strokes transformed, omit applied', () => {
  const r = run('build-lessons.mjs', { 'fx-scene.json': scene() });
  expect(r.code, r.err).toBe(0);
  const l = r.lessons.find((x: { id: string }) => x.id === 'fx-scene');
  expect(r.lessons.map((x: { id: string }) => x.id)).toEqual(['cat', 'fx-scene']); // scenes after everything else
  expect(l.parts).toEqual([
    { title: 'Ground', say: 'First the ground.', from: 0, to: 3 },
    { title: 'Cat', say: 'Now the cat.', from: 3, to: 3 + 7 + 1 },
  ]);
  expect(l.steps).toHaveLength(11);
  expect(l.steps.map((s: { part: number }) => s.part)).toEqual([0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1]);
  expect(l.steps[0]).toEqual({ say: 'Draw a line. 1', strokes: ['M 100 100 L 300 100'], part: 0 });
  cat.steps.slice(0, 7).forEach((s: { say: string; strokes: string[] }, i: number) =>
    expect(l.steps[3 + i]).toEqual({ say: s.say, strokes: s.strokes.map((d) => transformPath(d, 0.5, 400, 300)), part: 1 }));
  expect(l.steps[3].strokes[0]).toBe('M 550 470 A 100 100 0 1 1 750 470 A 100 100 0 1 1 550 470 Z'); // cat's head circle, halved and moved
  expect(l.steps[10].say).toBe('A box. 1');
  expect(Object.keys(l).sort()).toEqual(['category', 'difficulty', 'emoji', 'id', 'parts', 'steps', 'title']);
});

test('build: every scene validation error fails with a clear message; a tiny scaled stroke only warns', () => {
  const s = () => scene().parts as Part[];
  const bad: [string, unknown, RegExp][] = [
    ['one part', scene(s().slice(0, 1)), /must have 2 to 6 parts \(has 1\)/],
    ['seven parts', scene([...s(), ...s(), ...s(), s()[0]]), /must have 2 to 6 parts \(has 7\)/],
    ['top-level steps', { ...scene(), steps: own(8) }, /unknown field "steps" \(a scene has parts/],
    ['wrong category', { ...scene(), category: 'characters' }, /category must be "scenes"/],
    ['id not the file name', { ...scene(), id: 'other' }, /id "other" does not match filename "fx-scene"/],
    ['part without title', scene([{ ...s()[0], title: '' }, s()[1]]), /part 1: title must be a non-empty string/],
    ['part without say', scene([{ ...s()[0], say: undefined }, s()[1]]), /part 1 "Ground": say must be a non-empty string/],
    ['part with nothing', scene([{ title: 'Ground', say: 'Hi.' }, s()[1]]), /part 1 "Ground": needs steps \(1 to 12\) or a ref/],
    ['13 steps in a part', scene([{ ...s()[0], steps: own(13) }, s()[1]]), /part 1 "Ground": steps must be an array of 1 to 12 steps/],
    ['empty steps', scene([{ ...s()[0], steps: [] }, s()[1]]), /part 1 "Ground": steps must be an array of 1 to 12 steps/],
    ['four strokes', scene([{ ...s()[0], steps: [{ say: 'x', strokes: Array(4).fill('M 100 100 L 200 200') }] }, s()[1]]), /part 1 "Ground" step 1: must have 1 to 3 strokes/],
    ['relative command', scene([{ ...s()[0], steps: [{ say: 'x', strokes: ['M 100 100 l 50 0'] }] }, s()[1]]), /part 1 "Ground" step 1 stroke 1: illegal character "l"/],
    ['unknown part field', scene([s()[0], { ...s()[1], scal: 1 }]), /part 2 "Cat": unknown field "scal"/],
    ['unknown ref', scene([s()[0], { ...s()[1], ref: 'nope' }]), /part 2 "Cat": ref "nope" is not a lesson in lessons\//],
    ['ref to a scene', scene([s()[0], { ...s()[1], ref: 'fx-scene' }]), /ref "fx-scene" is a scene; a part can only reference an ordinary lesson/],
    ['no scale', scene([s()[0], { ...s()[1], scale: undefined }]), /part 2 "Cat": scale must be a number above 0, at most 1/],
    ['scale above 1', scene([s()[0], { ...s()[1], scale: 1.5 }]), /scale must be a number above 0, at most 1/],
    ['no x', scene([s()[0], { ...s()[1], x: 'left' }]), /part 2 "Cat": x must be a number/],
    ['bad omit', scene([s()[0], { ...s()[1], omit: [9] }]), /omit must be an array of "cat" step indexes, zero-based, 0 to 8/],
    ['omit everything', scene([s()[0], { ...s()[1], omit: [0, 1, 2, 3, 4, 5, 6, 7, 8], steps: undefined }]), /omits every step of "cat" and has no steps of its own/],
    ['scale without ref', scene([{ ...s()[0], scale: 0.5 }, s()[1]]), /part 1 "Ground": scale only goes with ref/],
    ['too few steps', scene([{ ...s()[0], steps: own(1) }, { ...s()[1], omit: [1, 2, 3, 4, 5, 6, 7, 8] }]), /has 3 steps in all; a scene needs 8 to 40/],
    ['too many steps', scene([...[0, 1, 2, 3].map(() => ({ ...s()[0], steps: own(10) })), { ...s()[1], omit: [] }]), /has 50 steps in all; a scene needs 8 to 40/],
    ['off the page after scaling', scene([s()[0], { ...s()[1], x: 600 }]), /part 2 "Cat" step \d stroke \d: bbox x [\d.]+\.\.[\d.]+, y [\d.]+\.\.[\d.]+ is outside 40\.\.960 after scaling/],
    ['own step off the page', scene([{ ...s()[0], steps: [{ say: 'x', strokes: ['M 10 500 L 500 500'] }] }, s()[1]]), /part 1 "Ground" step 1 stroke 1: bbox x 10\.\.500, y 500\.\.500 is outside 40\.\.960$/m],
  ];
  for (const [name, body, msg] of bad) {
    const r = run('build-lessons.mjs', { 'fx-scene.json': body });
    expect(r.code, name).toBe(1);
    expect(r.err, name).toMatch(msg);
    expect(r.lessons, name).toBeNull();
  }
  const tiny = run('build-lessons.mjs', { 'fx-scene.json': scene([s()[0], { ...s()[1], scale: 0.1, omit: [] }]) });
  expect(tiny.code, tiny.err).toBe(0);
  // cat's eyes (step index 5) are 44x60; at 0.1 they are 4x6
  expect(tiny.err).toMatch(/fx-scene: WARNING part 2 "Cat": "cat" step index 5 \("Give your cat two oval eyes."\) stroke 1 is only 4x6 after scaling, too small to trace; consider "omit": \[5\]/);
  expect(run('build-lessons.mjs', { 'fx-scene.json': scene() }).err).not.toMatch(/WARNING/);
});

test('voice: a scene part intro or own step with no clip fails the build check; referenced lines reuse their clips', () => {
  const root = mkdtempSync(join(tmpdir(), 'voice-'));
  const check = () => spawnSync(process.execPath, ['scripts/voice.mjs', root], { encoding: 'utf8' });
  try {
    for (const d of ['lessons', 'path', 'public/voice']) cpSync(d, join(root, d), { recursive: true });
    mkdirSync(join(root, 'src'));
    cpSync('src/lines.ts', join(root, 'src/lines.ts'));
    expect(check().status).toBe(0);
    const f = join(root, 'lessons/stitch-surf.json'), s = JSON.parse(readFileSync(f, 'utf8'));
    s.parts[0].say = 'A brand new part intro.';
    s.parts[3].steps[0].say = 'A brand new scene step.';
    writeFileSync(f, JSON.stringify(s));
    const bad = check();
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('2 spoken line(s)');
    expect(bad.stderr).toContain('"A brand new part intro."');
    expect(bad.stderr).toContain('"A brand new scene step."');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('render: a scene gets its sheet, final and a sheet per part; a bad scene fails the render too', () => {
  const r = run('render-lessons.mjs', { 'fx-scene.json': scene() });
  expect(r.code, r.err).toBe(0);
  expect(r.sheets).toEqual(expect.arrayContaining(['sheet.png', 'final.png', 'part-1.png', 'part-2.png', 'step-11.png']));
  expect(r.sheets).not.toContain('part-3.png');
  const bad = run('render-lessons.mjs', { 'fx-scene.json': scene([(scene().parts as Part[])[0], { ...(scene().parts as Part[])[1], x: 600 }]) });
  expect(bad.code).toBe(1);
  expect(bad.err).toMatch(/outside 40\.\.960 after scaling/);
});
