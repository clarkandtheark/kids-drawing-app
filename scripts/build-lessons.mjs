// Concatenate lessons/*.json (ids starting with _ are review fixtures) into public/lessons.json.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';

// Spec order within each level; ids not listed sort after these, alphabetically.
const ORDER = ['face', 'sun', 'house', 'fish', 'rainbow', 'cloud', 'flower', 'balloon', 'snail', 'ladybug',
  'cat', 'dog', 'bunny', 'owl', 'butterfly', 'turtle', 'car', 'rocket', 'tree', 'cupcake',
  'unicorn', 'horse', 'dinosaur', 'princess', 'castle', 'mermaid', 'dragon', 'elephant', 'penguin', 'giraffe'];
const rank = (id) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);

const files = (await readdir('lessons')).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
const lessons = await Promise.all(files.map(async (f) => JSON.parse(await readFile(`lessons/${f}`, 'utf8'))));
lessons.sort((a, b) => a.difficulty - b.difficulty || rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
await mkdir('public', { recursive: true });
await writeFile('public/lessons.json', JSON.stringify(lessons));
console.log(`lessons.json: ${lessons.map((l) => l.id).join(', ')}`);
