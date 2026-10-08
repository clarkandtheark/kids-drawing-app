// Spoken lines. Every line the app says has a pre-generated narration clip (public/voice/, made by `npm run voice`)
// played through Web Audio; a line with no clip, or whose clip can't be fetched or decoded, or before any tap has
// unlocked audio, falls back to speechSynthesis. Never throws; silent where neither exists.
import { getSetting, setSetting } from './store';

let isMuted = false;
type Clip = { file: string; dur: number };
let lines: Record<string, Clip> = {}; // voice/index.json: exact app text -> its clip
let src: AudioBufferSourceNode | undefined; // the clip playing now
let token = 0; // bumps on every say/stop, so a clip still loading for an older line never starts
const w = window as any;

/** Load the persisted mute setting and the clip list; await before the first screen so both are right from the start. */
export async function loadSpeechSettings() {
  [isMuted] = await Promise.all([getSetting('muted', false), loadClips()]);
}

/** The clip list. A failed fetch leaves it empty (everything falls back to speechSynthesis) and is retried next launch. */
export const loadClips = () => fetch('voice/index.json').then((r) => r.json())
  .then((m: { lines: Record<string, Clip> }) => (lines = m.lines)).catch(() => lines);

export const muted = () => isMuted;
export function setMuted(m: boolean) {
  isMuted = m;
  setSetting('muted', m);
  if (m) { stopSpeech(); loop?.pause(); }
}

let ctx: AudioContext | undefined;
/**
 * The app's one AudioContext (clips here, tones in grade.ts): created on first use and resumed whenever it isn't
 * running (iOS starts it suspended, and 'interrupted' after a call or the app going to the background). iOS only
 * lets it start inside a tap, so every tap tries (below). Undefined where Web Audio is missing.
 */
export function audio() {
  try {
    const AC: typeof AudioContext | undefined = window.AudioContext ?? w.webkitAudioContext;
    if (!ctx && AC) {
      try { // narration must be heard with the ringer switch on silent, like a video; Web Audio is muted by it otherwise
        if (w.navigator.audioSession) w.navigator.audioSession.type = 'playback'; // iOS 16.4+
      } catch { /* older iOS: the silent <audio> loop below */ }
      ctx = new AC();
      try { // a one-sample silent sound inside the tap: older iOS only unlocks a context that has played something
        const s = ctx.createBufferSource();
        s.buffer = ctx.createBuffer(1, 1, 22050);
        s.connect(ctx.destination);
        s.start();
      } catch { /* not needed elsewhere */ }
    }
    if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
    if (!w.navigator.audioSession && 'ongesturestart' in window) silentLoop(); // Safari without audioSession
  } catch { /* sound is a nice-to-have */ }
  return ctx;
}

// Older iOS: a playing <audio> element switches the page's audio session to media playback, which the silent switch
// doesn't mute, so Web Audio is heard too. A tiny looping silent WAV, inline, started inside a tap, paused when muted.
// ponytail: no mediaSession metadata, so iOS shows no title; whether it still shows lock-screen controls is unverified.
let loop: HTMLAudioElement | undefined;
function silentLoop() {
  if (!loop) {
    loop = new Audio('data:audio/wav;base64,UklGRogAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YWQAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA');
    loop.loop = true;
    loop.setAttribute('playsinline', '');
  }
  if (loop.paused) loop.play().catch(() => {});
}
// pointerup/touchend/keydown count as a user gesture everywhere (pointerdown does for a mouse). Muted: no context at all.
for (const t of ['pointerdown', 'pointerup', 'touchend', 'keydown']) addEventListener(t, () => { if (!isMuted) audio(); }, { capture: true, passive: true });

// ponytail: 12 decoded lines (~0.5 MB each at 48 kHz) and prefetch 4 ahead, one decode at a time; raise both if a
// lesson ever needs more lines warm, lower them if an old iPad runs short of memory.
const KEEP = 12, AHEAD = 4;
const bufs = new Map<string, Promise<AudioBuffer>>(); // least recently used first
const OFFLINE_MS = 60_000;
let offlineUntil = 0;
addEventListener('online', () => { offlineUntil = 0; });

/** A clip's decoded audio, from the small LRU or fetched (cache-first in the service worker) and decoded. */
function buffer(file: string, a: AudioContext) {
  let b = bufs.get(file);
  if (b) bufs.delete(file);
  else {
    const p = b = (async () => {
      const url = `voice/${file}`;
      // Not in the audio cache yet (still warming up) and offline: don't try the network, speak the line instead.
      // navigator.onLine can say online when it isn't, so a failed clip fetch also counts as offline for a while.
      if ((!navigator.onLine || Date.now() < offlineUntil) && !(await window.caches?.match(url))) throw new Error('offline');
      const r = await fetch(url).catch((e) => { offlineUntil = Date.now() + OFFLINE_MS; throw e; });
      if (r.status === 204) offlineUntil = Date.now() + OFFLINE_MS; // the service worker: not cached, and offline
      if (r.status !== 200) throw new Error(`${r.status}`);
      const data = await r.arrayBuffer();
      // Callback form for older Safari; newer browsers also return a promise, rejected on bad data: swallow that one.
      return new Promise<AudioBuffer>((ok, fail) => { a.decodeAudioData(data, ok, fail)?.catch(() => {}); });
    })();
    p.catch(() => { if (bufs.get(file) === p) bufs.delete(file); });
  }
  bufs.set(file, b);
  for (const k of bufs.keys()) if (bufs.size > KEEP) bufs.delete(k);
  return b;
}

/** Decode the next few of `texts` in the background (a lesson's or stop's upcoming lines) so they start at once. */
export function prefetch(texts: string[]) {
  const a = ctx; // only once a tap has made the context: no point decoding for a page nobody has touched
  if (isMuted || !a) return;
  texts.filter((t) => lines[t]).slice(0, AHEAD)
    .reduce<Promise<unknown>>((p, t) => p.then(() => buffer(lines[t].file, a)).catch(() => {}), Promise.resolve());
}

/** Speak `text`. `then` runs once it has been spoken (a scene part's intro, then its step's line), unless another line or
 *  stopSpeech comes first. A clip ends on its own; the browser's voice and muted run it after an estimate of the line's
 *  length instead (iOS often never fires the utterance's end). */
export function say(text: string, then?: () => void) {
  stopSpeech();
  const me = token;
  const after = () => { if (me === token) then?.(); };
  // ponytail: ~13 characters a second at rate 0.9, plus a beat; the browser voice may run a little over or under
  const later = () => { if (then) setTimeout(after, (lines[text]?.dur ?? text.length / 13) * 1000 + 300); };
  if (isMuted) return later();
  w.__said?.push(text); // test hook: every line asked for (tests set window.__said = [])
  const clip = lines[text];
  // userActivation: making a context outside a tap only gets a suspended one (and a console warning).
  const a = clip && (ctx ?? (w.navigator.userActivation?.isActive === false ? undefined : audio()));
  if (!clip || !a) { synth(text); return later(); }
  buffer(clip.file, a).then(async (b) => {
    if (me !== token) return;
    if (a.state !== 'running') { // just created in this tap, or no tap yet: give resume a moment
      a.resume().catch(() => {});
      await new Promise((r) => setTimeout(r, 300));
      if (me !== token) return;
      if ((a.state as string) !== 'running') throw new Error('locked'); // iOS would play nothing
    }
    const s = src = a.createBufferSource();
    s.buffer = b;
    s.connect(a.destination);
    s.onended = () => { if (src === s) src = undefined; after(); };
    s.start();
    w.__played?.push([text, 'clip']); // test hook: how each line played
  }).catch(() => { if (me === token) { synth(text); later(); } });
}

// Natural voices, best first. Anything else (Apple's novelty voices like Albert/Zarvox) is never chosen.
const NATURAL = ['Ava', 'Zoe', 'Samantha', 'Allison', 'Susan', 'Nicky', 'Karen', 'Moira', 'Tessa', 'Serena',
  'Google US English', 'Microsoft Aria', 'Microsoft Jenny'];

// undefined = set no voice and let the system default for lang en-US speak.
export function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const en = voices.filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith('en'));
  for (const n of NATURAL) {
    const m = en.filter((v) => v.name.toLowerCase().startsWith(n.toLowerCase()));
    const v = m.find((v) => /premium|enhanced/i.test(v.name)) ?? m[0];
    if (v) return v;
  }
  return undefined;
}

/** The browser's own voice. iOS only lets it start from a user gesture, so a line with no clip speaks inside the tap. */
function synth(text: string) {
  const s = window.speechSynthesis;
  if (!s) return;
  try {
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.9;
    u.pitch = 1;
    u.lang = 'en-US';
    // getVoices() is empty until the browser has loaded them, so look again every time.
    const v = pickVoice(s.getVoices());
    if (v) u.voice = v;
    s.speak(u);
    w.__played?.push([text, 'synth']);
  } catch { /* speech is a nice-to-have */ }
}

export function stopSpeech() {
  token++;
  try { src?.stop(); } catch { /* already ended */ }
  src = undefined;
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
}
