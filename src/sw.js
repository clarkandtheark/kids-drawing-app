// Service worker TEMPLATE: the sw plugin in vite.config.ts fills in FILES and VERSION and writes dist/sw.js.
const FILES = __FILES__;
const PREFIX = 'kids-drawing-'; // other GitHub Pages apps share this origin's caches; only touch ours
const CACHE = PREFIX + __VERSION__;
// Narration clips live in their own cache, filled in the background by the page (sw-register.ts) after install and
// kept across app versions: clip names are content hashes, so an update only fetches clips that are new. Bump the
// number only if the cache's format changes; the old one is then deleted below like any old version.
const VOICE = PREFIX + 'voice-1';

// No skipWaiting(): a new version installs quietly in the background and waits until every window of the
// app is closed, so it takes over on the NEXT launch. Swapping workers (or reloading) under a child who is
// mid-drawing could lose her picture or mix old and new files in one session. First install has no
// predecessor, so it activates straight away and clients.claim() makes the very first visit offline-ready.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE && k !== VOICE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Cache-first for same-origin GETs; any page navigation gets the cached shell. Misses go to the network.
// ignoreVary: servers send `Vary: Origin`, and the crossorigin module script carries an Origin header that
// the precache request did not, so without it the app's own JS would miss the cache.
self.addEventListener('fetch', (e) => {
  const r = e.request;
  const url = new URL(r.url);
  if (r.method !== 'GET' || url.origin !== location.origin) return;
  const clip = /\/voice\/[^/]+\.m4a$/.test(url.pathname);
  e.respondWith(caches.open(clip ? VOICE : CACHE)
    .then((c) => c.match(r.mode === 'navigate' ? './' : r, { ignoreSearch: true, ignoreVary: true }))
    // A clip not cached yet, offline: 204 tells the page to use the browser's voice, without a failed-request error.
    .then((hit) => hit || (clip ? fetch(r).catch(() => new Response(null, { status: 204 })) : fetch(r))));
});
