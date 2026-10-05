/// <reference types="vite/client" />
// Offline cache. Production builds only: `npm run dev` has no precache list and must never serve stale files.
// Relative URL, so the worker's scope is the folder the app is served from (the GitHub Pages sub-path).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js');
    navigator.serviceWorker.ready.then(() => setTimeout(warmVoice, WARM_DELAY));
  });
}

// The narration clips are not in the worker's install-time precache (megabytes of audio would make the first install
// slow and fragile). Instead, every launch, the page tops up their own cache (the name is shared with src/sw.js):
// drops clips that left the manifest, fetches the missing ones a few at a time, keeps what it already has. Stopping
// halfway (app closed, offline) loses nothing: the next launch carries on. A clip not cached yet is spoken by the
// browser's voice when offline (speech.ts).
const VOICE = 'kids-drawing-voice-1', WARM_DELAY = 3000, AT_ONCE = 4; // after the first screen and lesson have loaded
async function warmVoice() {
  try {
    if (!navigator.onLine) return;
    const m: { lines: Record<string, { file: string }> } = await (await fetch('voice/index.json')).json();
    const want = new Set(Object.values(m.lines).map((c) => new URL(`voice/${c.file}`, location.href).href));
    const cache = await caches.open(VOICE);
    const have = new Set<string>();
    for (const k of await cache.keys()) {
      if (want.has(k.url)) have.add(k.url);
      else await cache.delete(k);
    }
    const todo = [...want].filter((u) => !have.has(u));
    await Promise.all(Array.from({ length: AT_ONCE }, async () => {
      // Gone offline: stop at once (the next launch carries on); one failure stops every worker.
      for (let u; navigator.onLine && (u = todo.pop());) {
        const r = await fetch(u).catch((e) => { todo.length = 0; throw e; });
        if (r.ok) await cache.put(u, r);
      }
    }));
  } catch { /* offline or quota: the next launch tries again */ }
}
