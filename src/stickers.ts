// Sticker book, #stickers: a slot per path stop, grouped by unit in path order. Earned ones show the stop's sticker
// (tap: a wobble and a happy tone); the rest are empty dashed outlines, so she can see how many are left.
import { tones } from './grade';
import { TINTS } from './path';
import type { Unit } from './stop';
import { getPathProgress } from './store';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const root = $('#stickers'), book = $('#skbook'), count = $('#skcount');
const TILT = [-6, 4, -3, 7, -5, 3, -2, 5]; // degrees: stuck on by hand, not in a grid
let token = 0;

export async function openStickers(units: Unit[]) {
  if (!root.hidden) return;
  root.hidden = false;
  const me = ++token;
  const p = await getPathProgress();
  if (me !== token) return;
  let got = 0, all = 0;
  book.replaceChildren(...units.map((u, n) => {
    const s = document.createElement('section');
    s.className = 'skunit';
    s.style.setProperty('--tint', TINTS[n % TINTS.length]);
    s.innerHTML = '<h2 class="emoji" role="img"></h2><div class="sks"></div>';
    Object.assign(s.firstElementChild!, { ariaLabel: u.title, textContent: u.emoji });
    s.lastElementChild!.append(...u.stops.map((st) => {
      const earned = !!p[`${u.id}/${st.id}`], el = document.createElement(earned ? 'button' : 'i');
      el.className = earned ? 'slot got' : 'slot';
      if (earned) {
        el.ariaLabel = st.title;
        el.style.setProperty('--r', `${TILT[all % TILT.length]}deg`);
        el.innerHTML = `<b class="emoji">${st.sticker}</b>`;
      } else el.textContent = '?';
      all++;
      got += +earned;
      return el;
    }));
    return s;
  }));
  count.innerHTML = `<svg viewBox="0 0 24 24"><path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.4 6.3-.9Z" fill="#ffd21f" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg><b>${got}</b><span>/</span><b>${all}</b>`;
  count.ariaLabel = `${got} of ${all} stickers`;
  book.scrollTop = 0;
}

export function closeStickers() {
  if (root.hidden) return;
  token++;
  root.hidden = true;
  book.replaceChildren();
}

book.addEventListener('click', (e) => {
  const b = (e.target as Element).closest('.got');
  if (!b) return;
  b.classList.remove('wobble');
  void (b as HTMLElement).offsetWidth;
  b.classList.add('wobble');
  tones([1046.5, 1318.5, 1568]); // the happy arpeggio of a great step
});
book.addEventListener('animationend', (e) => (e.target as Element).classList.remove('wobble'));
$('#skhome').addEventListener('click', () => { location.hash = ''; });
