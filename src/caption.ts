// On-screen instruction (#50): the spoken line as big text with a speaker icon, on every screen that gives one (the
// stop player, the lesson). The markup is in index.html (`.caption` with a <span>); the screen wires the tap to its replay.
const SHRINK = [1, 0.92, 0.85, 0.78, 0.72]; // font steps when a long line does not fit the box (never an ellipsis)

const fit = (el: HTMLElement) => {
  const span = el.querySelector('span')!;
  for (const k of SHRINK) {
    span.style.fontSize = k === 1 ? '' : `${k}em`;
    if (el.scrollHeight <= el.clientHeight) break;
  }
  // Phone landscape with colour tools: the caption sits over the canvas's cell, which moves down by this (index.html).
  el.parentElement!.style.setProperty('--caph', `${el.offsetHeight}px`);
};
// The box gets its size from the screen's layout (rotation, Color mode, Copy mode): fit again whenever it changes.
const ro = new ResizeObserver((es) => es.forEach((e) => fit(e.target as HTMLElement)));

/** Show `text` in caption `el`; a changed line flashes so she notices it. */
export function caption(el: HTMLElement, text: string) {
  const span = el.querySelector('span')!;
  if (span.textContent !== text) {
    span.textContent = text;
    el.classList.remove('new');
    void el.offsetWidth; // restart the flash
    el.classList.add('new');
  }
  ro.observe(el);
  fit(el);
}
