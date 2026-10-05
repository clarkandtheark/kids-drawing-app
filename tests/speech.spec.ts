// Narration (#44): pre-generated clips through the one Web Audio context, speechSynthesis only as the fallback.
// speech.ts's test hooks: window.__said gets every line asked for, window.__played [text, 'clip' | 'synth'] as it starts.
import { test, expect, type Page } from '@playwright/test';
import { line, touchStroke } from './helpers';
import cat from '../lessons/cat.json' with { type: 'json' };
import lines from '../path/01-lines.json' with { type: 'json' };
import manifest from '../public/voice/index.json' with { type: 'json' };

const record = (page: Page, voices: [string, string][] = []) => page.addInitScript((voices) => {
  const w = window as any;
  w.__said = [];
  w.__played = [];
  w.__spoken = []; // what reached speechSynthesis.speak
  w.__src = []; // clip sources started/stopped (the one-sample unlock sound is left out)
  // The real utterance rejects fake voice objects, so use a plain recorder.
  w.SpeechSynthesisUtterance = class {
    voice: any = null; pitch = 1; rate = 1; lang = '';
    constructor(public text: string) {}
  };
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      speak: (u: any) => w.__spoken.push({ text: u.text, voice: u.voice && u.voice.name, pitch: u.pitch, rate: u.rate, lang: u.lang }),
      cancel() {},
      getVoices: () => voices.map(([name, lang]) => ({ name, lang })),
    },
  });
  const P = AudioBufferSourceNode.prototype, start = P.start, stop = P.stop;
  P.start = function (this: AudioBufferSourceNode, ...a: any[]) { if (this.buffer!.length > 1) w.__src.push('start'); return start.apply(this, a as []); };
  P.stop = function (this: AudioBufferSourceNode, ...a: any[]) { w.__src.push('stop'); return stop.apply(this, a as []); };
}, voices);

const get = <T>(page: Page, k: string) => page.evaluate((k) => (window as any)[k], k) as Promise<T>;
const played = (page: Page) => get<[string, string][]>(page, '__played');
/** Call one of speech.ts's exports in the page (the dev server serves the module). */
const call = (page: Page, fn: string, arg?: unknown) =>
  page.evaluate(async ([fn, arg]) => (await import('/src/speech.ts' as string))[fn as string](arg), [fn, arg] as const);

const openCat = async (page: Page) => {
  await page.goto('./#library');
  await page.locator('.card[data-id=cat]').tap();
  await expect(page.locator('#lesson')).toBeVisible();
};

test.describe('browser voice fallback', () => {
  // No clip list at all: every line goes to speechSynthesis, which keeps its voice choice.
  test.beforeEach(({ page }) => page.route('**/voice/index.json', (r) => r.fulfill({ status: 404 })));
  const first = (page: Page) => () => get<any[]>(page, '__spoken').then((s) => s[0]);

  test('prefers a natural voice over novelty ones, pitch 1', async ({ page }) => {
    await record(page, [
      ['Albert', 'en-US'], ['Bad News', 'en-US'], ['Samantha', 'en-US'],
      ['Samantha (Enhanced)', 'en-US'], ['Zarvox', 'en-US'], ['Thomas', 'fr-FR'],
    ]);
    await openCat(page);
    await expect.poll(first(page)).toBeTruthy();
    expect(await first(page)()).toMatchObject({ text: cat.steps[0].say, voice: 'Samantha (Enhanced)', pitch: 1, rate: 0.9, lang: 'en-US' });
    expect(await played(page)).toEqual([[cat.steps[0].say, 'synth']]);
  });

  test('only novelty voices: no explicit voice set', async ({ page }) => {
    await record(page, [['Albert', 'en-US'], ['Bad News', 'en-US'], ['Zarvox', 'en_US']]);
    await openCat(page);
    await expect.poll(first(page)).toBeTruthy();
    expect((await first(page)()).voice).toBeNull();
  });
});

test('a line with a clip plays through Web Audio, never speechSynthesis', async ({ page }) => {
  await record(page);
  await openCat(page);
  await expect.poll(() => played(page)).toEqual([[cat.steps[0].say, 'clip']]);
  expect(await get(page, '__spoken')).toEqual([]);
  expect(await get(page, '__src')).toEqual(['start']);
});

test('a line with no clip, or whose clip fails to load, falls back to speechSynthesis', async ({ page }) => {
  await record(page);
  await page.route('**/voice/index.json', async (r) => {
    const m = await (await r.fetch()).json();
    delete m.lines[cat.steps[0].say];
    await r.fulfill({ json: m });
  });
  await openCat(page);
  await expect.poll(() => played(page)).toEqual([[cat.steps[0].say, 'synth']]);
  // A broken clip (server error, then garbage); lines past the 4 decoded ahead on opening: the line still gets spoken, nothing throws.
  await page.route('**/voice/*.m4a', (r) => r.fulfill({ status: 500 }));
  await call(page, 'say', cat.steps[6].say);
  await expect.poll(() => played(page)).toContainEqual([cat.steps[6].say, 'synth']);
  await page.unroute('**/voice/*.m4a');
  await page.route('**/voice/*.m4a', (r) => r.fulfill({ body: 'not audio' }));
  await call(page, 'say', cat.steps[7].say);
  await expect.poll(() => played(page)).toContainEqual([cat.steps[7].say, 'synth']);
  expect(await get(page, '__src')).toEqual([]);
});

test('a new line stops the one playing; stopSpeech stops it; muted plays nothing; unmuting replays nothing', async ({ page }) => {
  await record(page);
  await openCat(page);
  await expect.poll(() => get(page, '__src')).toEqual(['start']);
  await call(page, 'say', cat.steps[6].say); // the first line is still playing
  await expect.poll(() => get(page, '__src')).toEqual(['start', 'stop', 'start']);
  await call(page, 'stopSpeech');
  expect(await get(page, '__src')).toEqual(['start', 'stop', 'start', 'stop']);
  await call(page, 'setMuted', true);
  await call(page, 'say', cat.steps[7].say);
  await page.waitForTimeout(500);
  await call(page, 'setMuted', false);
  await page.waitForTimeout(500);
  expect(await get(page, '__src')).toEqual(['start', 'stop', 'start', 'stop']);
  expect((await played(page)).map(([t]) => t)).toEqual([cat.steps[0].say, cat.steps[6].say]);
  expect(await get(page, '__spoken')).toEqual([]);
  // A line asked for while an earlier clip is still loading (past the 4 decoded ahead) wins: the earlier one never starts.
  await page.route('**/voice/*.m4a', async (r) => { await new Promise((ok) => setTimeout(ok, 400)); await r.fallback(); });
  await call(page, 'say', cat.steps[7].say);
  await call(page, 'say', cat.steps[8].say);
  await expect.poll(() => played(page)).toContainEqual([cat.steps[8].say, 'clip']);
  await page.waitForTimeout(600);
  expect((await played(page)).map(([t]) => t)).not.toContain(cat.steps[7].say);
});

test('before any tap a line falls back to the browser voice; after one, lines spoken from timers play their clips', async ({ page }) => {
  await record(page);
  const stop = lines.stops[0];
  await page.goto(`./#stop/${lines.id}/${stop.id}`); // opened by URL: no gesture yet
  await expect(page.locator('#sink')).toBeVisible();
  await expect.poll(() => played(page)).toEqual([[stop.exercises[0].say, 'synth']]);
  await expect(page.locator('#stop')).toHaveAttribute('data-phase', 'draw', { timeout: 10_000 });
  await touchStroke(page, line([180, 500], [820, 500])); // the first tap unlocks audio
  await page.locator('#sok').tap();
  // The reaction shows, then (from a timer, outside the tap) the next exercise or the retry speaks: a clip.
  await expect.poll(() => played(page), { timeout: 10_000 }).toHaveLength(2);
  expect((await played(page))[1][1]).toBe('clip');
});

test('opening a lesson decodes its next lines in the background, a few at a time', async ({ page }) => {
  await record(page);
  const fetched: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/voice/') && r.url().endsWith('.m4a')) fetched.push(r.url().split('/').pop()!); });
  await openCat(page);
  const ahead = cat.steps.slice(0, 5).map((s) => manifest.lines[s.say as keyof typeof manifest.lines].file);
  await expect.poll(() => fetched.length).toBe(5); // the first line, then 4 ahead
  expect(fetched.sort()).toEqual([...ahead].sort());
});

test.describe('silent switch (iOS)', () => {
  test('the first tap sets the audio session to playback where it exists; a throwing one breaks nothing', async ({ page }) => {
    await record(page);
    await page.addInitScript(() => {
      const w = window as any;
      w.__session = { type: 'auto' };
      Object.defineProperty(navigator, 'audioSession', { configurable: true, value: w.__session });
    });
    await page.goto('./#library');
    expect(await page.evaluate(() => (window as any).__session.type)).toBe('auto'); // nothing before a gesture
    await page.locator('.card[data-id=cat]').tap();
    await expect.poll(() => page.evaluate(() => (window as any).__session.type)).toBe('playback');
    await expect.poll(() => played(page)).toEqual([[cat.steps[0].say, 'clip']]);

    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => Object.defineProperty(navigator, 'audioSession', {
      configurable: true, value: { get type() { return 'auto'; }, set type(_: string) { throw new Error('nope'); } },
    }));
    await page.goto('about:blank');
    await openCat(page);
    await expect.poll(() => played(page)).toEqual([[cat.steps[0].say, 'clip']]);
    expect(errors).toEqual([]);
  });

  test('older Safari (no audioSession): a looping silent inline <audio> starts on the first tap and pauses when muted', async ({ page }) => {
    await record(page);
    await page.addInitScript(() => {
      const w = window as any;
      w.ongesturestart = null; // what Safari has
      w.__media = [];
      const P = HTMLMediaElement.prototype, play = P.play, pause = P.pause;
      P.play = function (this: HTMLMediaElement) { w.__media.push(['play', this.src.slice(0, 14), this.loop, this.hasAttribute('playsinline')]); return play.call(this); };
      P.pause = function (this: HTMLMediaElement) { w.__media.push(['pause']); return pause.call(this); };
    });
    await page.goto('./#library');
    expect(await get(page, '__media')).toEqual([]);
    await page.locator('.card[data-id=cat]').tap();
    await expect.poll(() => get<unknown[]>(page, '__media').then((m) => m[0])).toEqual(['play', 'data:audio/wav', true, true]);
    await expect.poll(() => played(page)).toEqual([[cat.steps[0].say, 'clip']]); // Web Audio still plays alongside
    await call(page, 'setMuted', true);
    expect((await get<unknown[][]>(page, '__media')).at(-1)).toEqual(['pause']);
  });

  test('where neither exists, no <audio> loop is made', async ({ page }) => {
    await record(page);
    await page.addInitScript(() => {
      const w = window as any;
      w.__plays = 0;
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) { w.__plays++; return play.call(this); };
    });
    await openCat(page);
    await expect.poll(() => played(page)).toEqual([[cat.steps[0].say, 'clip']]);
    expect(await get(page, '__plays')).toBe(0);
  });
});
