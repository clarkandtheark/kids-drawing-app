// Path home screen: the learning path (path.json) as a winding trail of big round stops, a banner per unit, a trophy
// at the end. Stops unlock in order; the first finished run of a stop plays a short payoff on the way back here.
// The header (logo, Library, Sticker book, Free draw, My Drawings) is static in index.html.
import { star, tones } from './grade';
import { takeEarned, type Unit } from './stop';
import { getPathProgress, getSetting, type PathProgress } from './store';

type State = 'done' | 'current' | 'open' | 'locked';

/** Unit banner colours, cycled (the sticker book uses the same per unit). */
export const TINTS = ['#d8f0c4', '#cfe8ff', '#f0dcff', '#ffe0e8', '#fff1b8', '#d4f4ee'];
const WIND = [0, 1, 0, -1]; // stop offsets along the trail: centre, right, centre, left
const svg = (body: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const LOCK = svg('<rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>').replace('<svg', '<svg class="lock"');
const PLAY = '<svg class="play" viewBox="0 0 24 24"><path d="M8.5 5v14l11-7Z" fill="currentColor" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/></svg>';
const ARROW = '<svg class="arrow" viewBox="0 0 24 24"><path d="M8 2.5h8v9h4.5L12 21 3.5 11.5H8Z" fill="#ff5a36" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>';
const UNLOCK = [523.25, 783.99, 1046.5]; // C5 G5 C6: a door opening
const SPARKLE = [784, 1046.5, 1318.5, 1568];

const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const root = $('#path'), trail = $('#trail'), road = $('#road');
const line = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
line.id = 'roadline';
const trophy = document.createElement('div');
trophy.className = 'trophy emoji';
trophy.role = 'img';
trophy.ariaLabel = 'Trophy';
trophy.textContent = '🏆';

let units: Unit[] = [];
let go: (hash: string) => void;
let token = 0; // bumps on hide so a slow load can't paint into a closed screen
let skip: (() => void) | null = null; // set while the payoff plays: jump to its end

const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const nodes = () => [...road.querySelectorAll<HTMLElement>('.stop')];

/**
 * Every stop's state, in path order. A stop is open when it is the first, the one before it is done, or `all` (the
 * parent's unlock-everything switch) is on; the current stop is the first open one not done yet.
 */
export function states(order: string[], done: PathProgress, all: boolean): State[] {
  let current = false;
  return order.map((k, i) => {
    if (done[k]) return 'done';
    if (!all && i > 0 && !done[order[i - 1]]) return 'locked';
    if (current) return 'open';
    current = true;
    return 'current';
  });
}

/** A node's look: done shows its sticker and stars; the sticker is only in the DOM once earned. */
function setState(a: HTMLElement, s: State, p: PathProgress) {
  a.dataset.state = s;
  const stars = p[a.dataset.key!]?.stars ?? 0;
  a.querySelector('.sticker')!.textContent = s === 'done' ? a.dataset.sticker! : '';
  a.querySelector('.stars')!.innerHTML = s === 'done' ? [1, 2, 3].map((i) => star(i <= stars)).join('') : '';
}

function render(p: PathProgress, all: boolean) {
  const order = units.flatMap((u) => u.stops.map((s) => `${u.id}/${s.id}`)), st = states(order, p, all);
  let i = 0;
  road.replaceChildren(line, ...units.flatMap((u, n) => {
    const b = document.createElement('div');
    b.className = 'unit emoji';
    b.role = 'img';
    b.ariaLabel = u.title;
    b.style.setProperty('--tint', TINTS[n % TINTS.length]);
    b.textContent = u.emoji;
    return [b, ...u.stops.map((s) => {
      const a = document.createElement('a'), k = `${u.id}/${s.id}`;
      a.className = 'stop';
      a.href = `#stop/${k}`;
      a.ariaLabel = s.title;
      Object.assign(a.dataset, { key: k, sticker: s.sticker });
      a.style.setProperty('--k', String(WIND[i % WIND.length]));
      a.innerHTML = `<b class="sticker emoji"></b>${LOCK}${PLAY}${ARROW}<span class="stars"></span>`;
      setState(a, st[i++], p);
      return a;
    })];
  }), trophy);
  trophy.style.setProperty('--k', String(WIND[i % WIND.length]));
  trophy.classList.toggle('won', st.every((s) => s === 'done'));
  drawLine();
}

/** The trail: a dotted road through every stop's centre to the trophy, solid up to the first stop not done yet. */
function drawLine() {
  const o = road.getBoundingClientRect();
  const all = [...nodes(), trophy], pts = all.map((e) => {
    const r = e.getBoundingClientRect();
    return [r.left + r.width / 2 - o.left, r.top + r.height / 2 - o.top];
  });
  const d = (ps: number[][]) => ps.map(([x, y], i) => {
    if (!i) return `M ${x} ${y}`;
    const [px, py] = ps[i - 1], my = (py + y) / 2;
    return `C ${px} ${my} ${x} ${my} ${x} ${y}`; // leaves and arrives vertically: a gentle S between offsets
  }).join(' ');
  const walked = all.findIndex((e) => e.dataset.state !== 'done'); // the trophy has no state: all done walks to it
  line.innerHTML = `<path class="all" d="${d(pts)}"/><path class="walked" d="${d(pts.slice(0, walked + 1))}"/>`;
}
new ResizeObserver(() => { if (!root.hidden) drawLine(); }).observe(road);

/** Scroll the trail so `el` sits a little above the middle: comfortably in view, never at the very edge. */
function show(el: Element, smooth = false) {
  const r = el.getBoundingClientRect(), t = trail.getBoundingClientRect();
  trail.scrollBy({ top: r.top - t.top - (t.height - r.height) * 0.4, behavior: smooth ? 'smooth' : 'auto' });
}
const focus = () => road.querySelector('.stop[data-state=current]') ?? (trophy.classList.contains('won') ? trophy : road.querySelector('.stop'));

/** `go` routes at once, so the stop's first spoken line starts inside the tap (iOS). */
export function showPath(all: Unit[], goTo: (hash: string) => void) {
  units = all;
  go = goTo;
  if (!root.hidden) return;
  root.hidden = false;
  refreshPath();
}

export function hidePath() {
  if (root.hidden) return;
  skip?.();
  token++;
  root.hidden = true;
}

/** Draw the path from stored progress (also after the parent area changes it); plays the payoff for a stop just earned. */
export async function refreshPath() {
  if (root.hidden) return;
  const me = ++token;
  const [p, all] = await Promise.all([getPathProgress(), getSetting('unlockAll', false)]);
  if (me !== token) return;
  skip?.();
  const earned = takeEarned();
  const a = earned && p[earned] ? `[data-key="${earned}"]` : '';
  if (!a || calm()) {
    render(p, all);
    const f = focus();
    if (f) show(f);
    if (a) tones(UNLOCK, { gap: 0.07, len: 0.35, vol: 0.12 });
    return;
  }
  const before = { ...p };
  delete before[earned!];
  render(before, all);
  if (!road.querySelector(a)) return render(p, all); // ponytail: a stop no longer in path.json; no payoff
  payoff(road.querySelector<HTMLElement>(a)!, p, all);
}

/**
 * About 1.5 s: the stop flips to done with its sticker and stars, the sticker flies to the sticker-book button (which
 * bumps), then whatever this unlocked pops open (the next stop becomes current) and scrolls into view. A tap skips it.
 */
function payoff(a: HTMLElement, p: PathProgress, all: boolean) {
  const ns = nodes(), after = states(ns.map((n) => n.dataset.key!), p, all);
  const changed = ns.filter((n, i) => n !== a && n.dataset.state !== after[i]);
  const book = $('#tostickers'), timers: number[] = [];
  let fly: HTMLElement | null = null;
  const at = (ms: number, f: () => void) => timers.push(window.setTimeout(f, ms));
  const unlock = () => {
    ns.forEach((n, i) => setState(n, after[i], p));
    trophy.classList.toggle('won', after.every((s) => s === 'done'));
    drawLine();
  };
  const end = () => {
    timers.forEach(clearTimeout);
    fly?.remove();
    for (const e of [...ns, trophy, book]) e.classList.remove('flip', 'pop', 'bump');
    delete root.dataset.payoff;
    skip = null;
  };
  skip = () => { end(); unlock(); const f = focus(); if (f) show(f); };
  root.dataset.payoff = '';
  show(a);
  a.classList.add('flip');
  at(250, () => setState(a, 'done', p));
  at(400, () => {
    const r = a.getBoundingClientRect(), t = book.getBoundingClientRect();
    const f = fly = document.createElement('b');
    f.className = 'flying emoji';
    f.textContent = a.dataset.sticker!;
    f.style.left = `${r.left + r.width / 2}px`;
    f.style.top = `${r.top + r.height / 2}px`;
    document.body.append(f);
    f.animate([{ transform: 'none' }, { transform: `translate(${t.left + t.width / 2 - r.left - r.width / 2}px, ${t.top + t.height / 2 - r.top - r.height / 2}px) scale(0.4)` }],
      { duration: 600, easing: 'cubic-bezier(.45, -0.3, .7, 1)', fill: 'forwards' });
  });
  at(1000, () => {
    fly?.remove();
    book.classList.add('bump');
    tones(SPARKLE, { gap: 0.06, len: 0.4, vol: 0.08 });
    unlock();
    for (const e of [...changed, ...(trophy.classList.contains('won') ? [trophy] : [])]) e.classList.add('pop');
    if (changed.length) tones(UNLOCK, { at: 0.25, gap: 0.07, len: 0.35, vol: 0.12 });
    const f = focus();
    if (f && f !== a) show(f, true);
  });
  at(1600, end);
}

// One listener for every stop. Locked: a tiny shake, nothing else. During the payoff a tap only skips it.
root.addEventListener('click', (e) => {
  if (!skip) return;
  e.preventDefault();
  e.stopPropagation();
  skip();
}, true);
road.addEventListener('click', (e) => {
  const a = (e.target as Element).closest<HTMLElement>('.stop');
  if (!a) return;
  e.preventDefault();
  if (a.dataset.state !== 'locked') return go(`#stop/${a.dataset.key}`);
  a.classList.remove('shake');
  void a.offsetWidth;
  a.classList.add('shake');
});
road.addEventListener('animationend', (e) => (e.target as Element).classList.remove('shake'));
