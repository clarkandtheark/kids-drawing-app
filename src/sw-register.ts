/// <reference types="vite/client" />
// Offline cache. Production builds only: `npm run dev` has no precache list and must never serve stale files.
// Relative URL, so the worker's scope is the folder the app is served from (the GitHub Pages sub-path).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
}
