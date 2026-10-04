# kids-drawing-app

Offline-capable PWA that teaches a 6-year-old to draw on an iPad, step by step.

The full brief is in [SPEC.md](SPEC.md).

## Deploying

Live site: https://clarkandtheark.github.io/kids-drawing-app/

- Pages is set to Settings → Pages → Source: GitHub Actions.
- Every push to `main` builds and deploys.
- HTTPS is required for the service worker (Pages provides it).
- Install on iPad: open the URL in Safari → Share → Add to Home Screen.
