// Service worker TEMPLATE: the sw plugin in vite.config.ts fills in FILES and VERSION and writes dist/sw.js.
const FILES = __FILES__;
const PREFIX = 'kids-drawing-'; // other GitHub Pages apps share this origin's caches; only touch ours
const CACHE = PREFIX + __VERSION__;

// No skipWaiting(): a new version installs quietly in the background and waits until every window of the
// app is closed, so it takes over on the NEXT launch. Swapping workers (or reloading) under a child who is
// mid-drawing could lose her picture or mix old and new files in one session. First install has no
// predecessor, so it activates straight away and clients.claim() makes the very first visit offline-ready.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Cache-first for same-origin GETs; any page navigation gets the cached shell. Misses go to the network.
// ignoreVary: servers send `Vary: Origin`, and the crossorigin module script carries an Origin header that
// the precache request did not, so without it the app's own JS would miss the cache.
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE)
    .then((c) => c.match(r.mode === 'navigate' ? './' : r, { ignoreSearch: true, ignoreVary: true }))
    .then((hit) => hit || fetch(r)));
});
