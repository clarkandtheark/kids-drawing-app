// Spoken step instructions. Silent (never throws) where speechSynthesis is missing.
// iOS only lets speech start from a user gesture, so call say() synchronously from a tap handler.
import { getSetting, setSetting } from './store';

let isMuted = false;

/** Load the persisted mute setting; await before the first screen so muted() is right from the start. */
export async function loadSpeechSettings() { isMuted = await getSetting('muted', false); }

export const muted = () => isMuted;
export function setMuted(m: boolean) {
  isMuted = m;
  setSetting('muted', m);
  if (m) stopSpeech();
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

export function say(text: string) {
  const s = window.speechSynthesis;
  if (!s || isMuted) return;
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
  } catch { /* speech is a nice-to-have */ }
}

export function stopSpeech() {
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
}
