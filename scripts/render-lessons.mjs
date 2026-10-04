// Dev tool: validate lessons/*.json and render review PNGs. Usage: npm run render -- [id ...]
import { readdir, readFile, writeFile, mkdir, rm, access } from 'node:fs/promises';
import { chromium } from 'playwright';

const GRAY = '#9aa0a6', HI = '#ff5a36', INK = '#2b2b2b', W = 14, LO = 40, HIGH = 960;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const path = (d, c) => `<path d="${esc(d)}" fill="none" stroke="${c}" stroke-width="${W}" stroke-linecap="round" stroke-linejoin="round"/>`;
const svg = (size, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1000 1000" style="display:block;background:#fff">${body}</svg>`;
const page_ = (body, css = '') => `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#fff}${css}</style>${body}`;

const SHEET_CSS = 'body{font-family:system-ui,-apple-system,sans-serif;color:#222;padding:24px;width:2150px;box-sizing:border-box}h1{margin:0 0 16px;font-size:36px}.g{display:grid;grid-template-columns:repeat(5,400px);gap:24px 24px}.t{width:400px}.i{border:1px solid #ccc;box-sizing:border-box;width:400px;height:400px;overflow:hidden}.i svg{width:100%;height:100%}.b{position:absolute;margin:8px;width:32px;height:32px;line-height:32px;text-align:center;border-radius:50%;background:#222;color:#fff;font-weight:700;font-size:18px}.t{position:relative}.t p{margin:8px 0 0;font-size:18px;line-height:1.3;min-height:48px}';

// ponytail: static checks only look at command letters; malformed numbers are caught only by getBBox weirdness
function validate(id, l, file) {
  const errs = [], e = (m) => errs.push(`${id}: ${m}`);
  if (l.id !== file) e(`id "${l.id}" does not match filename "${file}"`);
  if (typeof l.title !== 'string' || !l.title.trim()) e('title must be a non-empty string');
  if (![1, 2, 3].includes(l.difficulty)) e('difficulty must be 1, 2 or 3');
  if (typeof l.emoji !== 'string' || !l.emoji.trim()) e('emoji must be a non-empty string');
  if (!Array.isArray(l.steps) || l.steps.length < 4 || l.steps.length > 10) { e('must have 4 to 10 steps'); return errs; }
  l.steps.forEach((s, i) => {
    const n = `step ${i + 1}`;
    if (typeof s?.say !== 'string' || !s.say.trim()) e(`${n}: say must be a non-empty string`);
    if (!Array.isArray(s?.strokes) || s.strokes.length < 1 || s.strokes.length > 3) return e(`${n}: must have 1 to 3 strokes`);
    s.strokes.forEach((d, j) => {
      const m = `${n} stroke ${j + 1}`;
      if (typeof d !== 'string') return e(`${m}: must be a string`);
      if (!d.trim().startsWith('M')) e(`${m}: must start with M`);
      const bad = d.match(/[^MLHVCSQTAZ0-9\s,.+\-eE]/);
      if (bad) e(`${m}: illegal character "${bad[0]}" (only absolute commands M L H V C S Q T A Z)`);
    });
  });
  return errs;
}

const only = process.argv.slice(2);
const files = (await readdir('lessons')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
for (const id of only) if (!files.includes(id)) { console.error(`${id}: no such lesson file`); process.exit(1); }
const targets = only.length ? only : files;

const browser = await chromium.launch();
let failed = false;
try {
  const page = await browser.newPage();
  const shot = async (html, w, h, out, css = "") => {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(page_(html, css));
    await page.screenshot({ path: out, fullPage: true });
  };
  const bboxes = (strokes) => page.evaluate((ds) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.append(s);
    const r = ds.map((d) => {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d); s.append(p);
      try { const b = p.getBBox(); return [b.x, b.y, b.x + b.width, b.y + b.height]; } catch { return null; }
    });
    s.remove(); return r;
  }, strokes);

  for (const id of targets) {
    let l;
    try { l = JSON.parse(await readFile(`lessons/${id}.json`, 'utf8')); }
    catch (err) { console.error(`${id}: invalid JSON (${err.message})`); failed = true; continue; }
    const errs = validate(id, l, id);
    const all = Array.isArray(l.steps) ? l.steps.flatMap((s) => s?.strokes ?? []) : [];
    if (!errs.length) {
      const boxes = await bboxes(all);
      let u = [Infinity, Infinity, -Infinity, -Infinity];
      boxes.forEach((b, i) => {
        if (!b) return errs.push(`${id}: stroke "${all[i].slice(0, 40)}" is not a parseable path`);
        const [x0, y0, x1, y1] = b.map((v) => Math.round(v * 10) / 10);
        if (x0 < LO || y0 < LO || x1 > HIGH || y1 > HIGH) errs.push(`${id}: stroke "${all[i].slice(0, 40)}" bbox x ${x0}..${x1}, y ${y0}..${y1} is outside ${LO}..${HIGH}`);
        u = [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])];
      });
      if (!errs.length && u[2] - u[0] < 600 && u[3] - u[1] < 600)
        console.warn(`${id}: WARNING drawing is small (${Math.round(u[2] - u[0])}x${Math.round(u[3] - u[1])}, want >=600 in some axis)`);
    }
    errs.forEach((m) => console.error(m));
    if (errs.length) { failed = true; continue; }

    const dir = `review/${id}`;
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const stepSvg = (size, n) => svg(size, l.steps.slice(0, n).map((s, i) => s.strokes.map((d) => path(d, i === n - 1 ? HI : GRAY)).join('')).join(''));
    const finalSvg = (size) => svg(size, all.map((d) => path(d, INK)).join(''));
    const N = l.steps.length;
    for (let n = 1; n <= N; n++) await shot(stepSvg(800, n), 800, 800, `${dir}/step-${n}.png`);
    await shot(finalSvg(1000), 1000, 1000, `${dir}/final.png`);

    const tile = (inner, label, text) => `<div class="t"><div class="b">${esc(label)}</div><div class="i">${inner}</div><p>${esc(text)}</p></div>`;
    const tiles = l.steps.map((s, i) => tile(stepSvg(400, i + 1), i + 1, s.say)).join('') + tile(finalSvg(400), '✓', 'All done!');
    await shot(`<h1>${esc(l.emoji)} ${esc(l.title)}</h1><div class="g">${tiles}</div>`, 2150, 200, `${dir}/sheet.png`, SHEET_CSS);
  }
} finally {
  await browser.close();
}

// index lists every lesson that has a sheet (not just this run's), difficulty then id
const rows = [];
for (const id of files) {
  try {
    await access(`review/${id}/sheet.png`);
    const l = JSON.parse(await readFile(`lessons/${id}.json`, 'utf8'));
    rows.push({ id, title: l.title, difficulty: l.difficulty });
  } catch { /* not rendered */ }
}
rows.sort((a, b) => a.difficulty - b.difficulty || a.id.localeCompare(b.id));
await mkdir('review', { recursive: true });
await writeFile('review/index.html', `<!doctype html><meta charset="utf-8"><title>Lesson review</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;background:#fafafa}img{max-width:100%;border:1px solid #ddd;background:#fff}h2{margin:32px 0 8px}</style>
<h1>Lesson review</h1>${rows.map((r) => `<h2>${esc(r.title)} <small>(${esc(r.id)}, difficulty ${r.difficulty})</small></h2><img src="${esc(r.id)}/sheet.png">`).join('\n')}`);
process.exit(failed ? 1 : 0);
