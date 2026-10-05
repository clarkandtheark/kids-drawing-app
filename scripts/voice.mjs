// Every line the app can speak, and the build check that each one has a narration clip.
//   node scripts/voice.mjs [root]          check root's public/voice/index.json (exit 1 listing what's missing)
//   node scripts/voice.mjs --list [root]   print the lines as a JSON array (tools/tts/generate.py reads this)
// The lines: each `say` in lessons/*.json (not _fixtures) and path/*.json, plus every double-quoted string in src/lines.ts.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function voiceLines(root = '.') {
  const out = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) k === 'say' && typeof x === 'string' ? out.add(x) : walk(x);
  };
  for (const d of ['lessons', 'path']) {
    for (const f of readdirSync(join(root, d)).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort()) {
      walk(JSON.parse(readFileSync(join(root, d, f), 'utf8')));
    }
  }
  for (const [s] of readFileSync(join(root, 'src/lines.ts'), 'utf8').matchAll(/"(?:[^"\\\n]|\\.)*"/g)) out.add(JSON.parse(s));
  out.delete('');
  return [...out].sort();
}

/** The lines with no clip in root/public/voice (no manifest entry, or its file missing or empty). */
export function missingClips(root = '.') {
  const dir = join(root, 'public/voice'), m = join(dir, 'index.json');
  const clips = existsSync(m) ? JSON.parse(readFileSync(m, 'utf8')).lines : {};
  return voiceLines(root).filter((t) => {
    const f = clips[t] && join(dir, clips[t].file);
    return !f || !existsSync(f) || statSync(f).size === 0;
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), list = args[0] === '--list', root = (list ? args[1] : args[0]) ?? '.';
  if (list) {
    console.log(JSON.stringify(voiceLines(root)));
  } else {
    const miss = missingClips(root);
    if (miss.length) {
      console.error(`${miss.length} spoken line(s) have no narration clip:\n${miss.map((t) => `  ${JSON.stringify(t)}`).join('\n')}`);
      console.error('Run `npm run voice` (needs the local Kokoro setup, see tools/tts/README.md) and commit public/voice/.');
      process.exit(1);
    }
    console.log(`voice: all ${voiceLines(root).length} spoken lines have a clip`);
  }
}
