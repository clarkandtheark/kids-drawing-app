// TEMPORARY lesson picker (the real home screen replaces it): one big card per lesson.
import type { Lesson } from './lesson';

const SVG = 'http://www.w3.org/2000/svg';
const picker = document.querySelector<HTMLElement>('#picker')!;

/** `open` runs inside the tap so the lesson's first spoken line counts as user-initiated (iOS). */
export function showPicker(lessons: Lesson[], open: (l: Lesson) => void) {
  if (!picker.childElementCount) picker.append(...lessons.map((l) => {
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
    a.addEventListener('click', (e) => { e.preventDefault(); open(l); });
    return a;
  }));
  picker.hidden = false;
}

export const hidePicker = () => { picker.hidden = true; };
