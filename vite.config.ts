import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Every file in a built dist/ except sw.js itself, as URLs relative to the worker ('index.html' becomes './').
export const precacheList = (dir: string) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((f) => f.isFile())
    .map((f) => relative(dir, join(f.parentPath, f.name)).split('\\').join('/'))
    .filter((f) => f !== 'sw.js')
    .sort()
    .map((f) => (f === 'index.html' ? './' : f));

// Hash of every precached file's name and content: any change to any file means a new cache.
export const cacheVersion = (dir: string) => {
  const h = createHash('sha256');
  for (const f of precacheList(dir)) h.update(`${f}\0`).update(readFileSync(join(dir, f === './' ? 'index.html' : f)));
  return h.digest('hex').slice(0, 12);
};

// Writes dist/sw.js from src/sw.js once everything (bundle and public/, incl. lessons.json) is in dist/.
// ponytail: reads the whole of dist/ into memory to hash it; fine for a few hundred KB, stream it if it grows to many MB.
const serviceWorker = (): Plugin => {
  let root = '', dir = '';
  return {
    name: 'service-worker',
    apply: 'build',
    configResolved: (c) => { root = c.root; dir = resolve(c.root, c.build.outDir); },
    closeBundle() {
      const sw = readFileSync(join(root, 'src/sw.js'), 'utf8')
        .replace('__FILES__', JSON.stringify(precacheList(dir)))
        .replace('__VERSION__', JSON.stringify(cacheVersion(dir)));
      writeFileSync(join(dir, 'sw.js'), sw);
    },
  };
};

// Relative asset paths: served from the GitHub Pages sub-path.
export default defineConfig({ base: './', plugins: [serviceWorker()] });
