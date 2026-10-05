// Narration clips (#44): every spoken line has a plausible clip, and the build fails when content and audio drift
// apart. Node-side (no browser), so it lives here: tests/ is type-checked without @types/node.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { voiceLines } from '../scripts/voice.mjs';

const check = (root: string) => spawnSync(process.execPath, ['scripts/voice.mjs', root], { encoding: 'utf8' });

test('every spoken line has a clip that exists, is not empty and is about as long as its text', () => {
  const lines: string[] = voiceLines();
  const { lines: clips } = JSON.parse(readFileSync('public/voice/index.json', 'utf8'));
  // The inventory really covers every source: a lesson step, a path exercise, and each kind of line in src/lines.ts.
  const cat = JSON.parse(readFileSync('lessons/cat.json', 'utf8')), unit = JSON.parse(readFileSync('path/01-lines.json', 'utf8'));
  for (const t of [cat.steps[0].say, unit.stops[0].exercises[0].say, 'Time to color! Pick a crayon.', 'Wow, three stars! Amazing!',
    'Hooray! You did it!', "Let's draw a whole picture! Tap the green button.", 'You did it! Here is your sticker!']) expect(lines).toContain(t);
  expect(lines).not.toContain('');
  const odd: string[] = [];
  for (const t of lines) {
    const c = clips[t];
    expect(c, t).toBeTruthy();
    const f = join('public/voice', c.file);
    expect(existsSync(f) && statSync(f).size > 0, `${c.file}: ${t}`).toBe(true);
    // ~13 characters a second at speed 0.9; flag anything under 0.4 s, over 15 s, or far off for its length.
    if (c.dur < 0.4 || c.dur > 15 || c.dur < t.length / 30 || c.dur > t.length / 5 + 1.5) odd.push(`${c.dur}s ${t}`);
  }
  expect(odd).toEqual([]);
});

test('the build check passes on the real tree and fails, listing the line, when a lesson line has no clip', () => {
  const ok = check('.');
  expect(ok.status, ok.stderr).toBe(0);
  expect(ok.stdout).toMatch(/all \d+ spoken lines have a clip/);

  const root = mkdtempSync(join(tmpdir(), 'voice-'));
  try {
    for (const d of ['lessons', 'path', 'public/voice']) cpSync(d, join(root, d), { recursive: true });
    mkdirSync(join(root, 'src'));
    cpSync('src/lines.ts', join(root, 'src/lines.ts'));
    expect(check(root).status).toBe(0);
    const f = join(root, 'lessons/cat.json'), cat = JSON.parse(readFileSync(f, 'utf8'));
    cat.steps[0].say = 'Draw a great big circle for the kitty.';
    writeFileSync(f, JSON.stringify(cat));
    const bad = check(root);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('"Draw a great big circle for the kitty."');
    expect(bad.stderr).toContain('npm run voice');
    expect(bad.stderr).toContain('1 spoken line(s)');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
