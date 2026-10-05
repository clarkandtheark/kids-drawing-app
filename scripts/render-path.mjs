// Dev tool: validate path/*.json (everything the build checks, plus geometry bounds) and render one contact sheet
// per stop to review/path/<unitId>/<stopId>.png. Usage: npm run render:path
import { mkdir, rm } from 'node:fs/promises';
import { chromium } from 'playwright';
import { loadPath } from './path-data.mjs';

const LO = 40, HIGH = 960, HI = '#ff5a36', INK = '#2b2b2b', W = 14;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const p = (d, c, extra = '') => `<path d="${esc(d)}" fill="none" stroke="${c}" stroke-width="${W}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
const dotted = (d, c, w = 13) => p(d, c, `stroke-dasharray="0.1 26" style="stroke-width:${w}"`);
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">${body}</svg>`;
const LABEL = { trace: '✏️ trace', shape: '🔷 shape', memory: '👀 memory', finish: '🧩 finish', create: '🎨 create', lesson: '📖 lesson' };

/** [what she sees at the start, the expected finished result] for one exercise. */
function views(x, lessons) {
  const s = x.strokes ?? [], g = x.given ?? [];
  switch (x.type) {
    case 'trace': return [s.map((d) => dotted(d, '#ff9a7a')).join(''), s.map((d) => p(d, HI)).join('')];
    case 'memory': return [s.map((d) => p(d, HI)).join('') + '<text x="500" y="980" text-anchor="middle" font-size="44" fill="#888">shown ~3 s, then hidden</text>', s.map((d) => p(d, HI)).join('')];
    case 'shape': return [`<rect x="620" y="20" width="360" height="360" rx="30" fill="#fff8ea" stroke="#e2c58f" stroke-width="6"/><g transform="translate(640 40) scale(0.32)">${s.map((d) => p(d, HI, 'style="stroke-width:40"')).join('')}</g>`, s.map((d) => p(d, HI)).join('')];
    case 'finish': return [(x.hint ? s.map((d) => dotted(d, '#ffd9cc', 10)).join('') : '') + g.map((d) => p(d, INK)).join(''), g.map((d) => p(d, INK)).join('') + s.map((d) => p(d, HI)).join('')];
    case 'create': return ['', ''];
    case 'lesson': {
      const all = lessons.get(x.lesson).steps.flatMap((st) => st.strokes).map((d) => p(d, INK)).join('');
      return [all, all];
    }
  }
}

const CSS = 'body{margin:0;font-family:system-ui,-apple-system,sans-serif;color:#222;padding:24px;width:1800px;box-sizing:border-box;background:#fff}h1{margin:0 0 16px;font-size:34px}'
  + '.g{display:grid;grid-template-columns:repeat(3,1fr);gap:28px}.t{border:1px solid #ddd;border-radius:12px;padding:12px}.h{font-size:22px;font-weight:700;margin-bottom:8px}'
  + '.v{display:grid;grid-template-columns:1fr 1fr;gap:8px}.v div{border:1px solid #ccc;aspect-ratio:1;background:#fff}.v svg{width:100%;height:100%;display:block}'
  + '.c{font-size:14px;color:#777;display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px}p{margin:8px 0 0;font-size:19px;line-height:1.3}';

const { units, errs, lessons } = await loadPath();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  // Geometry: every stroke's bounding box (measured by the browser) inside LO..HIGH, like the lessons.
  const bboxes = (ds) => page.evaluate((ds) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.append(s);
    return ds.map((d) => {
      const q = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      q.setAttribute('d', d); s.append(q);
      try { const b = q.getBBox(); return [b.x, b.y, b.x + b.width, b.y + b.height]; } catch { return null; }
    });
  }, ds);
  if (!errs.length) {
    for (const u of units) for (const s of u.stops) for (const [j, x] of s.exercises.entries()) {
      const ds = [...(x.strokes ?? []), ...(x.given ?? [])];
      (await bboxes(ds)).forEach((b, k) => {
        const where = `${u.id}: stop "${s.id}" exercise ${j + 1} (${x.type}) stroke "${ds[k].slice(0, 40)}"`;
        if (!b) return errs.push(`${where} is not a parseable path`);
        const [x0, y0, x1, y1] = b.map((v) => Math.round(v * 10) / 10);
        if (x0 < LO || y0 < LO || x1 > HIGH || y1 > HIGH) errs.push(`${where}: bbox x ${x0}..${x1}, y ${y0}..${y1} is outside ${LO}..${HIGH}`);
      });
    }
  }
  if (errs.length) {
    errs.forEach((m) => console.error(m));
    process.exitCode = 1;
  } else {
    for (const u of units) {
      const dir = `review/path/${u.id}`;
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      for (const s of u.stops) {
        const tiles = s.exercises.map((x, j) => {
          const [a, b] = views(x, lessons);
          const head = `${j + 1}. ${LABEL[x.type]}${x.type === 'lesson' ? ` "${x.lesson}"` : ''}${x.rotations?.length ? ` (rotations ${x.rotations.join(', ')})` : ''}${x.closed ? ' (closed)' : ''}${x.hint ? ' (hint)' : ''}`;
          return `<div class="t"><div class="h">${esc(head)}</div><div class="v"><div>${svg(a)}</div><div>${svg(b)}</div></div>
            <div class="c"><span>start</span><span>finished</span></div><p>${esc(x.say ?? '(default: "Let\'s draw a whole picture! Tap the green button.")')}</p></div>`;
        }).join('');
        await page.setViewportSize({ width: 1800, height: 400 });
        await page.setContent(`<!doctype html><meta charset="utf-8"><style>${CSS}</style><h1>${esc(u.emoji)} ${esc(u.title)} / ${esc(s.sticker)} ${esc(s.title)} <small>(${esc(u.id)}/${esc(s.id)})</small></h1><div class="g">${tiles}</div>`);
        await page.screenshot({ path: `${dir}/${s.id}.png`, fullPage: true });
        console.log(`${dir}/${s.id}.png`);
      }
    }
  }
} finally {
  await browser.close();
}
