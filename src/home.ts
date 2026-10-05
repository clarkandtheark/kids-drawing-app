// Home screen: the lesson cards grouped by level (the header with logo and entry buttons is static in index.html).
import type { Lesson } from './lesson';
import { CRAYON, star } from './grade';
import { getCompleted, getScores } from './store';

const SVG = 'http://www.w3.org/2000/svg';
// Icon-only header of the characters section; unlike the crayons it is a heart.
const HEART = '<svg viewBox="0 0 24 24"><path d="M12 21C5 15.5 2.5 12 2.5 8.5A4.8 4.8 0 0 1 12 6.6a4.8 4.8 0 0 1 9.5 1.9C21.5 12 19 15.5 12 21Z" fill="#ff5d8f"/><path d="M6 8.5a2.6 2.6 0 0 1 2.6-2" fill="none" stroke="#fff8ea" stroke-opacity=".8" stroke-width="1.5" stroke-linecap="round"/></svg>';
const home = document.querySelector<HTMLElement>('#menu')!;

function card(l: Lesson) {
  const a = document.createElement('a');
  a.className = 'card';
  a.href = `#lesson/${l.id}`;
  a.dataset.id = l.id;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 1000 1000');
  for (const d of l.steps.flatMap((s) => s.strokes)) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  const t = document.createElement('span');
  t.textContent = l.title;
  a.append(svg, t);
  return a;
}

/** `open` runs inside the tap so the lesson's first spoken line counts as user-initiated (iOS). */
export function showHome(lessons: Lesson[], open: (l: Lesson) => void) {
  if (!home.querySelector('.level')) {
    const section = (key: string, value: string, label: string, icon: string, list: Lesson[]) => {
      const s = document.createElement('section');
      s.className = 'level';
      s.dataset[key] = value;
      s.innerHTML = `<h2 class="lvl" aria-label="${label}">${icon}</h2><div class="cards"></div>`;
      s.querySelector('.cards')!.append(...list.map((l) => {
        const a = card(l);
        a.addEventListener('click', (e) => { e.preventDefault(); open(l); });
        return a;
      }));
      return s;
    };
    const chars = lessons.filter((l) => l.category === 'characters');
    home.append(...[1, 2, 3].map((n) => section('level', String(n), `Level ${n}`, CRAYON.repeat(n),
      lessons.filter((l) => l.difficulty === n && !l.category))));
    if (chars.length) home.append(section('category', 'characters', 'Characters', HEART, chars)); // ponytail: one category, no registry
  }
  home.hidden = false;
  refreshStars();
}

export const hideHome = () => { home.hidden = true; };

/** Her best on each card: three stars (earned ones gold) and the percent. A lesson completed before scores
 *  existed has no percent, so it shows one gold star: nothing she earned disappears. */
export const refreshStars = () => Promise.all([getCompleted(), getScores()]).then(([done, scores]) => {
  for (const c of home.querySelectorAll<HTMLElement>('.card')) {
    const id = c.dataset.id!, best = scores[id] ?? (done.includes(id) ? { stars: 1 } : null);
    c.classList.toggle('done', !!best);
    c.querySelector('.score')?.remove();
    if (!best) continue;
    const row = document.createElement('div');
    row.className = 'score';
    row.innerHTML = [1, 2, 3].map((i) => star(i <= best.stars)).join('') + ('percent' in best ? `<b>${best.percent}%</b>` : '');
    c.append(row);
  }
});
