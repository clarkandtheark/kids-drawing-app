// Parent area: long-press the logo for 3 seconds. Voice toggle, reset stars, export / import the gallery as a zip.
import { unzipSync, zipSync } from 'fflate';
import { shareFile } from './gallery';
import { refreshStars } from './home';
import { muted, setMuted } from './speech';
import { drawingName, listDrawings, parseDrawingName, resetProgress, saveDrawing } from './store';
import { confirmTrash } from './tools';

const HOLD_MS = 3000, SLOP = 24; // px a finger may wobble before the hold is cancelled
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const logo = $('#logo'), panel = $('#parent'), voice = $('#pvoice'), status = $('#pstatus');
let zip: Promise<File>; // built ahead so Export can share straight from the tap (iOS user activation)

async function buildZip() {
  const files: Record<string, Uint8Array> = {};
  for (const d of await listDrawings()) files[drawingName(d)] = new Uint8Array(await d.png.arrayBuffer());
  // ponytail: whole gallery in memory; fine for a child's gallery, stream it if it ever reaches thousands
  return new File([zipSync(files, { level: 0 }) as BlobPart], `drawings-${new Date().toLocaleDateString('en-CA')}.zip`, { type: 'application/zip' }); // PNGs are already compressed: level 0
}

const showVoice = () => { voice.ariaChecked = String(!muted()); voice.querySelector('b')!.textContent = muted() ? 'Off' : 'On'; };

function open() {
  showVoice();
  status.textContent = '';
  zip = buildZip();
  panel.hidden = false;
}

const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

async function importZip(file: File) {
  try {
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (f) => /\.png$/i.test(f.name) });
    const pngs = Object.entries(entries)
      .filter(([, b]) => isPng(b))
      .map(([path, b]) => ({ ...parseDrawingName(path.split('/').pop()!), png: new Blob([b as BlobPart], { type: 'image/png' }) }))
      .sort((a, b) => a.createdAt - b.createdAt); // oldest first so the newest ends up on top
    for (const p of pngs) await saveDrawing(p.png, p.lessonId, p.createdAt);
    status.textContent = pngs.length ? `Added ${pngs.length} drawing${pngs.length > 1 ? 's' : ''}.` : 'No pictures found in that file.';
  } catch {
    status.textContent = 'That file is not a drawings zip.';
  }
  zip = buildZip();
}

export function initParent() {
  let timer = 0, x = 0, y = 0;
  const stop = () => { clearTimeout(timer); logo.classList.remove('holding'); };
  logo.addEventListener('pointerdown', (e) => {
    x = e.clientX; y = e.clientY;
    logo.classList.add('holding');
    timer = window.setTimeout(() => { stop(); open(); }, HOLD_MS);
  });
  logo.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - x, e.clientY - y) > SLOP) stop(); });
  for (const t of ['pointerup', 'pointerleave', 'pointercancel']) logo.addEventListener(t, stop);

  voice.addEventListener('click', () => { setMuted(!muted()); showVoice(); });
  $('#preset').addEventListener('click', async () => {
    if (!await confirmTrash('Reset stars')) return;
    await resetProgress();
    refreshStars();
    status.textContent = 'Stars removed. Drawings are kept.';
  });
  $('#pexport').addEventListener('click', async () => { await shareFile(await zip); }); // the zip is already built, so the tap's activation is intact
  $<HTMLInputElement>('#pimport').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement, f = input.files?.[0];
    input.value = '';
    if (f) importZip(f);
  });
  $('#pclose').addEventListener('click', () => { panel.hidden = true; });
  addEventListener('hashchange', () => { panel.hidden = true; });
}
