// Spoken step instructions. Silent (never throws) where speechSynthesis is missing.
// iOS only lets speech start from a user gesture, so call say() synchronously from a tap handler.

const KEY = 'kids-drawing:muted';

// ponytail: localStorage for now; the IndexedDB settings store replaces these two functions.
export function muted() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
export function setMuted(m: boolean) {
  try { localStorage.setItem(KEY, m ? '1' : '0'); } catch { /* private mode: session-only */ }
  if (m) stopSpeech();
}

export function say(text: string) {
  const s = window.speechSynthesis;
  if (!s || muted()) return;
  try {
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.9;
    u.pitch = 1.15;
    u.lang = 'en-US';
    // getVoices() is empty until the browser has loaded them, so look again every time.
    const v = s.getVoices().find((v) => v.lang.replace('_', '-') === 'en-US');
    if (v) u.voice = v;
    s.speak(u);
  } catch { /* speech is a nice-to-have */ }
}

export function stopSpeech() {
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
}
