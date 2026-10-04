// Home screen: the lesson cards grouped by level (the header with logo and entry buttons is static in index.html).
import type { Lesson } from './lesson';
import { CRAYON, star } from './grade';
import { getCompleted, getScores } from './store';

const SVG = 'http://www.w3.org/2000/svg';
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
    home.append(...[1, 2, 3].map((n) => {
      const s = document.createElement('section');
      s.className = 'level';
      s.dataset.level = String(n);
      s.innerHTML = `<h2 class="lvl" aria-label="Level ${n}">${CRAYON.repeat(n)}</h2><div class="cards"></div>`;
      s.querySelector('.cards')!.append(...lessons.filter((l) => l.difficulty === n).map((l) => {
        const a = card(l);
        a.addEventListener('click', (e) => { e.preventDefault(); open(l); });
        return a;
      }));
      return s;
    }));
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
