// My Drawings: a grid of saved drawings, and a full-screen view with back / delete / share.
import { deleteDrawing, drawingName, listDrawings, type Drawing } from './store';
import { confirmTrash, ICON } from './tools';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const root = $('#gallery'), grid = $('#grid'), empty = $('#empty'), view = $('#view'), vimg = $<HTMLImageElement>('#vimg'), bar = $('#vbar');
const SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="m7.5 7.5 4.5-4.5 4.5 4.5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
const PALETTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18c1.6 0 2.2-1 1.7-2.1-.6-1.3.2-2.7 1.7-2.7H17a4 4 0 0 0 4-4c0-4.4-4-9.2-9-9.2Z" fill="#fff4e0"/><circle cx="7.5" cy="12" r="1.6" fill="#e8402a" stroke="none"/><circle cx="10" cy="7.5" r="1.6" fill="#ffd21f" stroke="none"/><circle cx="15" cy="7.5" r="1.6" fill="#43c04f" stroke="none"/><circle cx="17.5" cy="11.5" r="1.6" fill="#2f5bea" stroke="none"/></svg>';
bar.innerHTML = `<button class="back" aria-label="Back">${ICON.back}</button><button class="color" aria-label="Colour it">${PALETTE}</button><button class="del" aria-label="Delete">${ICON.trash}</button><button class="share" aria-label="Save or share">${SHARE}</button>`;

let urls: string[] = []; // object URLs for the current grid; revoked on leaving
let token = 0; // bumps on close so a slow load can't paint into a closed screen
let current: { tile: HTMLElement; url: string; d: Drawing; file: File } | null = null; // file is made ahead: share needs the tap's user activation

export async function openGallery() {
  if (!root.hidden) return;
  root.hidden = false;
  const me = ++token;
  const list = await listDrawings();
  if (me !== token) return;
  grid.replaceChildren(...list.map((d) => {
    const url = URL.createObjectURL(d.png);
    urls.push(url);
    const b = document.createElement('button');
    b.className = 'pic';
    b.innerHTML = `<img src="${url}" alt="">`;
    b.addEventListener('click', () => {
      current = { tile: b, url, d, file: new File([d.png], drawingName(d), { type: 'image/png' }) };
      vimg.src = url;
      view.hidden = false;
    });
    return b;
  }));
  syncEmpty();
}

export function closeGallery() {
  if (root.hidden) return;
  token++;
  root.hidden = true;
  view.hidden = true;
  current = null;
  grid.replaceChildren();
  vimg.removeAttribute('src');
  urls.forEach(URL.revokeObjectURL);
  urls = [];
}

const syncEmpty = () => { empty.hidden = grid.childElementCount > 0; grid.hidden = !empty.hidden; };

/** Share a file (iPad: the share sheet with "Save Image"); where file sharing isn't available, download it. */
export async function shareFile(f: File) {
  if (navigator.canShare?.({ files: [f] })) {
    try { await navigator.share({ files: [f] }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(f);
  a.download = f.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

bar.addEventListener('click', async (e) => {
  const b = (e.target as Element).closest('button');
  if (!b || !current) return;
  if (b.classList.contains('share')) shareFile(current.file); // straight from the tap, nothing awaited first
  else if (b.classList.contains('color')) location.hash = `#color/${current.d.id}`;
  else if (b.classList.contains('back')) view.hidden = true;
  else if (await confirmTrash('Delete it')) {
    const c = current;
    await deleteDrawing(c.d.id);
    c.tile.remove();
    URL.revokeObjectURL(c.url);
    view.hidden = true;
    syncEmpty();
  }
});
$('#ghome').addEventListener('click', () => { location.hash = ''; });
