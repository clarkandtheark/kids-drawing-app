# Spec — kids' guided drawing PWA

Noah's original brief, verbatim. This is the canonical spec.

Build an offline-capable Progressive Web App (PWA) that teaches my 6-year-old daughter to draw on an iPad. It will be installed via Safari's "Add to Home Screen" and used with a finger or Apple Pencil. She is an early reader, so the app must be usable without reading.

## Core experience: step-by-step guided drawing
- A lesson is a drawing broken into 4-10 steps. Each step adds 1-3 strokes.
- On each step:
  1. Animate the new stroke(s) being drawn in a bright highlight color (about 1.5s, then a short pause). Strokes from earlier steps stay visible in a neutral gray.
  2. Leave a faint dotted guide of the new stroke on the canvas.
  3. She draws on her own layer above the guide.
  4. Big buttons: Replay animation, Undo, Next step, Previous step.
- A toggle switches between "Trace mode" (guide shown on the canvas) and "Copy mode" (the reference appears in a small panel beside the canvas and she draws freehand on a blank canvas). Default is Trace mode.
- After the last step, switch to Color mode: a palette of about 12 big crayon-style colors, a few brush sizes, an eraser, and a fill bucket.
- When she finishes, show a celebration (confetti plus a star) and save the drawing to her gallery.
- Use the Web Speech API (speechSynthesis) to read short, friendly instructions aloud on each step ("Now draw two pointy ears on top of the circle!"). Include a mute button.

## Lessons
- Store lessons as data, not code: a lessons.json file where each lesson has an id, a title, a difficulty (1-3), an emoji or thumbnail, and steps[]. Each step has SVG path data for its strokes, in a normalized 1000x1000 coordinate space, plus a spoken instruction.
- Author 30 lessons that progress in difficulty:
  - Level 1: circle face, sun, house, fish, rainbow, cloud, flower, heart-balloon, snail, ladybug.
  - Level 2: cat, dog, bunny, owl, butterfly, turtle, car, rocket, tree, cupcake.
  - Level 3: unicorn, horse, dinosaur, princess, castle, mermaid, dragon, elephant, penguin, giraffe.
- Build every drawing from simple shapes (circles, ovals, curves, triangles) the way a kids' drawing teacher would. The strokes must look good and assemble into a recognizable result. Render each finished lesson to PNG and visually check it before calling the lessons done.
- Write a small dev-only script that renders every lesson's steps to images, so I can review them.

## Home screen
- A grid of big lesson cards with thumbnails, grouped by level. Each card shows a star once completed.
- A "Free draw" mode: a blank canvas with the same color tools.
- A "My Drawings" gallery: tap a drawing to view it full-screen, then delete it or share/save it to Photos via the Web Share API.

## Drawing engine
- HTML canvas with Pointer Events. Smooth strokes with quadratic curve interpolation.
- Apple Pencil: use pointer pressure for line width. When the active pointer is a pen, ignore touch input (palm rejection).
- Prevent iPad Safari's scroll, zoom, double-tap zoom, and text selection everywhere on the drawing screen.
- Support portrait and landscape. Make the canvas as large as possible.
- Undo with at least 30 levels.

## Design for a 6-year-old
- Tap targets at least 64px. Bright, warm, friendly visual style with rounded shapes. No small text in the core flow; use icons for everything.
- No ads, no external links, no accounts, no analytics, no network calls after first load.
- "Clear canvas" asks for confirmation first.
- A hidden parent area (long-press the logo for 3 seconds): reset progress, export or import the gallery as a zip, toggle voice.

## Tech
- Vanilla TypeScript + Vite (or React + Vite if that's clearly better for this; justify the choice). Keep dependencies minimal.
- Service worker that precaches everything, so the app works fully offline after first load.
- Web app manifest with icons (generate a simple crayon icon), display: standalone, and correct apple-touch-icon plus apple-mobile-web-app meta tags.
- Persist progress and the gallery in IndexedDB.
- Deploy target: GitHub Pages via a GitHub Actions workflow (HTTPS is required for the service worker). Include setup steps in the README.

## Process
1. Before writing code, propose the architecture, the lesson JSON schema, and 3 sample lessons. Wait for my approval.
2. Build the drawing engine and a single lesson end-to-end first.
3. Then author all 30 lessons and run the render-review script.
4. Test with Playwright at an iPad viewport (1024x1366 and 1366x1024). Simulate touch strokes, verify offline mode works, and fix anything broken before reporting done.
