// Concatenate lessons/*.json (ids starting with _ are review fixtures) into public/lessons.json, scenes expanded into
// ordinary lessons (scripts/scenes.mjs), and the learning path's units (path/*.json, validated) into public/path.json.
import { writeFile, mkdir } from 'node:fs/promises';
import { loadPath } from './path-data.mjs';
import { loadLessons } from './scenes.mjs';

// Spec order within each level; ids not listed sort after these, alphabetically.
const ORDER = ['face', 'sun', 'house', 'fish', 'rainbow', 'cloud', 'flower', 'balloon', 'snail', 'ladybug',
  'cat', 'dog', 'bunny', 'owl', 'butterfly', 'turtle', 'car', 'rocket', 'tree', 'cupcake',
  'unicorn', 'horse', 'dinosaur', 'princess', 'castle', 'mermaid', 'dragon', 'elephant', 'penguin', 'giraffe'];
// Categorised lessons sort after every uncategorised one, characters then scenes, each in this order; unknown ids after, alphabetically.
const GROUPS = {
  characters: ['mickey', 'minnie', 'pooh', 'olaf', 'elsa', 'anna', 'stitch', 'lilo', 'simba', 'nemo', 'ariel', 'moana', 'rapunzel'],
  scenes: ['stitch-surf', 'lilo-sandcastle', 'elsa-castle', 'anna-snowman', 'ariel-rock', 'nemo-coral', 'pooh-honey', 'simba-rock', 'mickey-picnic'],
};
const group = (l) => (l.category ? 1 + Object.keys(GROUPS).indexOf(l.category) : 0);
const at = (list, id) => (list.includes(id) ? list.indexOf(id) : list.length);
const rank = (l) => (l.category ? at(GROUPS[l.category], l.id) : l.difficulty * 100 + at(ORDER, l.id));

const { lessons, errs, warns } = await loadLessons('lessons');
for (const m of warns) console.warn(m);
if (errs.length) {
  for (const m of errs) console.error(`lessons/${m}`);
  process.exit(1);
}
lessons.sort((a, b) => group(a) - group(b) || rank(a) - rank(b) || a.id.localeCompare(b.id));
await mkdir('public', { recursive: true });
await writeFile('public/lessons.json', JSON.stringify(lessons));
console.log(`lessons.json: ${lessons.map((l) => l.id).join(', ')}`);

// ponytail: geometry bounds (40..960) need a browser to measure, so only `npm run render:path` checks them.
const { units, errs: perrs } = await loadPath('path', new Map(lessons.map((l) => [l.id, l])));
if (perrs.length) {
  for (const m of perrs) console.error(`path/${m}`);
  process.exit(1);
}
await writeFile('public/path.json', JSON.stringify(units));
console.log(`path.json: ${units.map((u) => `${u.id} (${u.stops.map((s) => s.id).join(', ')})`).join('; ')}`);
