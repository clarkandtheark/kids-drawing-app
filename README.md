# kids-drawing-app

Offline-capable PWA that teaches a 6-year-old to draw on an iPad, step by step.

The full brief is in [SPEC.md](SPEC.md).

## How it works

- **Path** (the home screen): eight units of stops, unlocked in order. A stop is 3 to 7 short exercises on one canvas;
  finishing it earns 1 to 3 stars and a sticker.
- **Sticker book** (`#stickers`): one slot per stop, empty until its stop is done.
- **Library** (`#library`): the original grid of whole-picture lessons (`lessons/*.json`). The path's `lesson`
  exercises play these too.
- **Parent area** (hold the logo for 3 seconds): voice, "Unlock all stops", "Reset progress", export/import drawings.

### Curriculum content: `path/*.json`

One file per unit, named `<number>-<unitId>.json` (`{ id, title, emoji, stops: [{ id, title, sticker, exercises }] }`).
The build checks every file and writes `path.json`. Exercise `type` and fields (coordinates are 0..1000 SVG paths):

- `trace` / `memory`: `say`, `strokes`. Memory shows the drawing, hides it, and she redraws it.
- `shape`: `say`, `strokes`, optional `also` (accepted alternative templates, each a list of strokes; the best wins and
  only `strokes` is shown), `rotations`, `closed`. Size and position are free.
- `finish`: `say`, `given` (drawn for her), `strokes` (what is missing), optional `hint`, and `open: true` when any
  reasonable answer counts and `strokes` only marks where it goes.
- `create`: `say`. Free colouring and drawing, not graded.
- `lesson`: `lesson` (a Library lesson id), optional `say`.

`npm run render:path` validates the curriculum and writes one contact sheet per stop to `review/path/`.
`node scripts/sweep-path.mjs` simulates decent attempts on every graded exercise through the real `grade()` and fails
if any gets one star. `tests-offline/pathwalk.spec.ts` plays the whole path by touch (run by `npm run test:offline`).

### Why vanilla TypeScript and Vite, not React

Five screens around a canvas, drawn by hand-written pointer code, with no component state worth a framework:
what the screens share is the hash route and a small IndexedDB store. Skipping React keeps the offline bundle small
(about 25 kB gzipped) and the service-worker precache short.

## Deploying

Live site: https://clarkandtheark.github.io/kids-drawing-app/

- Pages is set to Settings → Pages → Source: GitHub Actions.
- Every push to `main` builds and deploys.
- HTTPS is required for the service worker (Pages provides it).
- Install on iPad: open the URL in Safari → Share → Add to Home Screen.

## Local development

- `npm run dev`: dev server with hot reload (no service worker in dev, so you always see fresh files).
- `npm test`: Playwright tests against the dev server in iPad portrait and landscape. `PORT=5182 npm test` picks another port.
- `npm run test:offline`: builds for production, serves `dist/` under `/kids-drawing-app/` on port 5183 and checks
  the offline cache, manifest and icons, then runs the end-to-end pass (every lesson, a full journey, offline,
  rotation) and writes review screenshots to `review/final/`. The server stops when the tests finish.
- `npm run render`: validates `lessons/*.json` and writes review PNGs to `review/`.

## Offline cache and updates

The build writes `dist/sw.js` with a list of every file in `dist/` and a cache version that is a hash of their
contents, so any change (code, styles, a lesson) gives a new cache. After the first visit the app runs from that
cache and needs no network.

A new version downloads quietly in the background and only takes over the next time the app is opened, never
mid-drawing. To force an update on the iPad: close the app fully (swipe it away) and open it, then close and open
it once more. If that does not help, remove it from the Home Screen and add it again.

## Icons

The icon artwork is `scripts/icon.svg`. After editing it, run `node scripts/make-icons.mjs` to rewrite the PNGs in
`public/` (uses the Playwright Chromium already installed) and commit them.
