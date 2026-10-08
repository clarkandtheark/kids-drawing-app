// Concatenate lessons/*.json (ids starting with _ are review fixtures) into public/lessons.json,
// and the learning path's units (path/*.json, validated) into public/path.json.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { loadPath } from './path-data.mjs';

// Spec order within each level; ids not listed sort after these, alphabetically.
const ORDER = ['face', 'sun', 'house', 'fish', 'rainbow', 'cloud', 'flower', 'balloon', 'snail', 'ladybug',
  'cat', 'dog', 'bunny', 'owl', 'butterfly', 'turtle', 'car', 'rocket', 'tree', 'cupcake',
  'unicorn', 'horse', 'dinosaur', 'princess', 'castle', 'mermaid', 'dragon', 'elephant', 'penguin', 'giraffe'];
// Categorised lessons sort after every uncategorised one: characters, then settings, each in this order; unknown ids after, alphabetically.
const CATS = {
  characters: ['mickey', 'minnie', 'pooh', 'olaf', 'elsa', 'anna', 'stitch', 'lilo', 'simba', 'nemo', 'ariel', 'moana', 'rapunzel'],
  settings: ['beach', 'snowy-castle', 'seabed', 'park'],
};
const crank = (l) => {
  if (!l.category) return 0;
  const list = CATS[l.category], i = list.indexOf(l.id);
  return 1 + Object.keys(CATS).indexOf(l.category) * 100 + (i < 0 ? list.length : i);
};
const rank = (id) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);

const files = (await readdir('lessons')).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
const lessons = await Promise.all(files.map(async (f) => JSON.parse(await readFile(`lessons/${f}`, 'utf8'))));
lessons.sort((a, b) => crank(a) - crank(b) || (a.category ? 0 : a.difficulty - b.difficulty || rank(a.id) - rank(b.id)) || a.id.localeCompare(b.id));
await mkdir('public', { recursive: true });
await writeFile('public/lessons.json', JSON.stringify(lessons));
console.log(`lessons.json: ${lessons.map((l) => l.id).join(', ')}`);

// ponytail: geometry bounds (40..960) need a browser to measure, so only `npm run render:path` checks them.
const { units, errs } = await loadPath('path', new Map(lessons.map((l) => [l.id, l])));
if (errs.length) {
  for (const m of errs) console.error(`path/${m}`);
  process.exit(1);
}
await writeFile('public/path.json', JSON.stringify(units));
console.log(`path.json: ${units.map((u) => `${u.id} (${u.stops.map((s) => s.id).join(', ')})`).join('; ')}`);
