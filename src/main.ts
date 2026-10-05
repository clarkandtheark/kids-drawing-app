// Hash routing: #lesson/<id>, #draw, #gallery, #color/<id>, #stop/<unitId>/<stopId>, #library, #stickers; anything else is
// home: the learning path, or the Library when there is no path. Every screen but the active one is closed.
import { closeDraw, openDraw } from './draw';
import { suppressGestures } from './engine/surface';
import { closeGallery, openGallery } from './gallery';
import { closeLesson, openLesson, type Lesson } from './lesson';
import { hideLibrary, showLibrary } from './library';
import { initParent } from './parent';
import { hidePath, showPath } from './path';
import { closeRecolor, openRecolor } from './recolor';
import { closeStickers, openStickers } from './stickers';
import { closeStop, openStop, type Unit } from './stop';
import { loadSpeechSettings } from './speech';
import './sw-register'; // registers the offline service worker (production builds only)

suppressGestures();
initParent();

// Settings load before the first screen so muted() is right from the first spoken line.
// The learning path is optional: without a path.json (or an empty one) the Library is home, as before the path.
const path = fetch('./path.json').then((r) => r.json()).catch(() => []);
Promise.all([fetch('./lessons.json').then((r) => r.json()), loadSpeechSettings(), path]).then(([lessons, , units]: [Lesson[], void, Unit[]]) => {
  if (!Array.isArray(units) || !units.length) {
    units = [];
    document.querySelector('#lbar')!.replaceWith(document.querySelector('#top')!); // the Library gets the home header
    for (const id of ['#tolibrary', '#tostickers']) document.querySelector<HTMLElement>(id)!.hidden = true;
  }
  const home = units.length ? 'path' : 'library';
  const route = () => {
    const l = lessons.find((l) => l.id === location.hash.match(/^#lesson\/(.+)$/)?.[1]);
    const c = location.hash.match(/^#color\/(\d+)$/)?.[1];
    const sm = location.hash.match(/^#stop\/([^/]+)\/([^/]+)$/), unit = units.find((u) => u.id === sm?.[1]), stop = unit?.stops.find((s) => s.id === sm?.[2]);
    const named = ({ '#draw': 'draw', '#gallery': 'gallery', '#library': 'library', '#stickers': units.length ? 'stickers' : home } as Record<string, string>)[location.hash];
    const screen = l ? 'lesson' : c ? 'color' : stop ? 'stop' : named ?? home;
    if (l) openLesson(l); else closeLesson(); // openLesson ignores a repeat for the open lesson
    if (stop) openStop(unit!, stop, lessons, go); else closeStop(); // after the lesson line: a lesson exercise's first words must survive
    if (screen === 'draw') openDraw(); else closeDraw();
    if (screen === 'color') openRecolor(Number(c)); else closeRecolor();
    if (screen === 'gallery') openGallery(); else closeGallery();
    if (screen === 'library') showLibrary(lessons, open); else hideLibrary();
    if (screen === 'stickers') openStickers(units); else closeStickers();
    if (screen === 'path') showPath(units, go); else hidePath();
  };
  // Open synchronously inside the tap (speech needs the gesture), then let hashchange catch up.
  const go = (hash: string) => { location.hash = hash; route(); };
  const open = (l: Lesson) => { location.hash = `#lesson/${l.id}`; route(); };
  addEventListener('hashchange', route);
  route();
});
