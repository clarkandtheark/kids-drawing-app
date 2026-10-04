// Dev tool: rasterize scripts/icon.svg into the PNGs in public/. Usage: node scripts/make-icons.mjs
// The PNGs are committed, so the build never needs a browser.
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const svg = await readFile(new URL('./icon.svg', import.meta.url), 'utf8');
// [file, size, artwork scale]; maskable keeps the art inside the 80% safe circle.
const OUT = [
  ['apple-touch-icon.png', 180, 1],
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-maskable-512.png', 512, 0.72],
  ['favicon.png', 32, 1],
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const [file, size, scale] of OUT) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    await page.evaluate((s) => document.querySelector('#art').setAttribute('transform',
      `translate(${512 * (1 - s)} ${512 * (1 - s)}) scale(${s})`), scale);
    await page.screenshot({ path: `public/${file}` });
    console.log(`public/${file}`);
  }
} finally {
  await browser.close();
}
