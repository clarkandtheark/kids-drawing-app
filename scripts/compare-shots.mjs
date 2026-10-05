// Byte-compare two screenshot trees (see playwright.capture.config.ts). Exits 1 on any difference or missing file.
// usage: node scripts/compare-shots.mjs review/phone/before review/phone/after [project ...]
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [a, b, ...only] = process.argv.slice(2);
const projects = only.length ? only : ['ipad-portrait', 'ipad-landscape'];
let n = 0, bad = 0;
for (const p of projects) {
  for (const f of readdirSync(join(a, p)).filter((f) => f.endsWith('.png')).sort()) {
    n++;
    const y = join(b, p, f);
    if (!existsSync(y)) { bad++; console.log(`MISSING ${p}/${f}`); continue; }
    if (!readFileSync(join(a, p, f)).equals(readFileSync(y))) { bad++; console.log(`DIFFERS ${p}/${f}`); }
  }
}
console.log(`${n} compared, ${bad} differing`);
process.exit(bad ? 1 : 0);
