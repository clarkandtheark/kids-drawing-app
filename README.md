# kids-drawing-app

Offline-capable PWA that teaches a 6-year-old to draw on an iPad, step by step.

The full brief is in [SPEC.md](SPEC.md).

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
