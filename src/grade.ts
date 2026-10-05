// Grading UI: the quick reaction on a progress dot after each step, the stars-and-percent result when
// tracing ends, and the short Web Audio tones for both. Scoring itself is score.ts.
import type { Reaction } from './score';
import { RESULT_CHEER } from './lines';
import { audio, muted, say } from './speech';
import { saveScore } from './store';

const STAR_D = 'm12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.4 6.3-.9Z';
/** A star; CSS colours it (gold when it has class `got`, hollow otherwise). */
export const star = (got: boolean) => `<svg class="${got ? 'got' : ''}" viewBox="0 0 24 24"><path d="${STAR_D}"/></svg>`;
/** A crayon (level markers, the "go colour" button); `--c` sets its colour. */
export const CRAYON = '<svg viewBox="0 0 24 24"><g transform="rotate(35 12 12)">'
  + '<path d="M8 8.5 12 1.5l4 7Z" fill="var(--c, #ff5a36)"/><path d="M10.3 4.5 12 1.5l1.7 3Z" fill="rgb(0 0 0 / .3)"/>'
  + '<rect x="8" y="8.5" width="8" height="14" rx="1.5" fill="var(--c, #ff5a36)"/>'
  + '<path d="M8 11.5h8M8 19h8" stroke="#fff8ea" stroke-opacity=".75" stroke-width="1.5"/></g></svg>';
const SMILE = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#7fd45f" stroke="#3f9a2c" stroke-width="1.4"/>'
  + '<circle cx="8.6" cy="9.8" r="1.5" fill="#24481a"/><circle cx="15.4" cy="9.8" r="1.5" fill="#24481a"/>'
  + '<path d="M7.3 13.6a5.2 5.2 0 0 0 9.4 0" fill="none" stroke="#24481a" stroke-width="1.9" stroke-linecap="round"/></svg>';

/**
 * Soft notes (Hz), one every `gap` seconds starting `at` seconds from now, on the app's one AudioContext (speech.ts).
 * Silent when muted or where Web Audio is missing. Call inside a tap: iOS only lets an AudioContext start from a user gesture.
 */
export function tones(notes: number[], { at = 0, gap = 0.09, len = 0.4, vol = 0.14, type = 'triangle' as OscillatorType } = {}) {
  if (muted() || !notes.length) return;
  try {
    const a = audio();
    if (!a) return;
    notes.forEach((f, i) => {
      const t = a.currentTime + 0.02 + at + i * gap, o = a.createOscillator(), g = a.createGain();
      o.type = type;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.015); // quick soft attack, then a bell-like fade
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + len + 0.05);
    });
  } catch { /* sound is a nice-to-have */ }
}

/**
 * Show a step's reaction on its progress dot, without blocking anything: the dot takes the reaction's look
 * ('great' gold star, 'good' green, 'try' stays hollow with a gentle wiggle) and 'great'/'good' float a
 * star/smile up from it. No words, so it never talks over the next step's instruction.
 */
export function react(dot: HTMLElement, r: Reaction, sound = true) {
  delete dot.dataset.r;
  void dot.offsetWidth; // restart the dot's CSS animation if the reaction repeats
  dot.dataset.r = r;
  dot.querySelector('.pop')?.remove();
  if (r !== 'try') {
    const p = document.createElement('b');
    p.className = 'pop';
    p.innerHTML = r === 'great' ? star(true) : SMILE;
    p.addEventListener('animationend', () => p.remove());
    dot.append(p);
  }
  if (sound) {
    if (r === 'great') tones([1046.5, 1318.5, 1568]); // C6 E6 G6, a happy arpeggio
    else if (r === 'good') tones([880], { vol: 0.1, len: 0.35, type: 'sine' });
    else tones([262], { vol: 0.08, len: 0.3, type: 'sine' }); // a soft low hum, not a buzzer
  }
}

const STAR_MS = 450, FIRST_MS = 300; // the stars fill in one by one (CSS uses the same timing)
const ARM_MS = 900; // taps outside the button are ignored this long, so a double-tap on the checkmark can't skip it

/**
 * The result when tracing ends: three big stars filling in up to her score, the percentage, a cheer, and a
 * crayon button (or a tap anywhere) that runs `done` (into Color mode). Saves her best score for the lesson.
 */
export function showResult(lessonId: string, s: { percent: number; stars: 1 | 2 | 3 }, done: () => void) {
  saveScore(lessonId, { percent: s.percent, stars: s.stars });
  const el = document.createElement('div');
  el.className = 'result';
  el.innerHTML = `<div class="rcard"><div class="rstars">${[1, 2, 3].map((i) =>
    `<span style="--d:${FIRST_MS + (i - 1) * STAR_MS}ms">${star(false)}${i <= s.stars ? star(true) : ''}</span>`).join('')}</div>
    <b class="pct">${s.percent}%</b>
    <button class="go" aria-label="Color it">${CRAYON}</button></div>`;
  document.body.append(el);
  say(RESULT_CHEER[s.stars]);
  tones([523.25, 659.25, 784].slice(0, s.stars), { at: FIRST_MS / 1000, gap: STAR_MS / 1000, len: 0.6 }); // a note per star as it lands
  const t0 = performance.now();
  const close = () => { el.remove(); removeEventListener('hashchange', close); };
  addEventListener('hashchange', close); // leaving the lesson takes the overlay with it
  el.addEventListener('click', (e) => {
    if (!(e.target as Element).closest('.go') && performance.now() - t0 < ARM_MS) return;
    close();
    done();
  });
}
