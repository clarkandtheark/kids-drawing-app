// Hash routing: #lesson/<id>, #draw, #gallery, #color/<id>; anything else is home. Every screen but the active one is closed.
import { closeDraw, openDraw } from './draw';
import { suppressGestures } from './engine/surface';
import { closeGallery, openGallery } from './gallery';
import { hideHome, showHome } from './home';
import { closeLesson, openLesson, type Lesson } from './lesson';
import { initParent } from './parent';
import { closeRecolor, openRecolor } from './recolor';
import { loadSpeechSettings } from './speech';
import './sw-register'; // registers the offline service worker (production builds only)

suppressGestures();
initParent();

// Settings load before the first screen so muted() is right from the first spoken line.
Promise.all([fetch('./lessons.json').then((r) => r.json()), loadSpeechSettings()]).then(([lessons]: [Lesson[], void]) => {
  const route = () => {
    const l = lessons.find((l) => l.id === location.hash.match(/^#lesson\/(.+)$/)?.[1]);
    const c = location.hash.match(/^#color\/(\d+)$/)?.[1];
    const screen = l ? 'lesson' : c ? 'color' : location.hash === '#draw' ? 'draw' : location.hash === '#gallery' ? 'gallery' : 'home';
    if (l) openLesson(l); else closeLesson(); // openLesson ignores a repeat for the open lesson
    if (screen === 'draw') openDraw(); else closeDraw();
    if (screen === 'color') openRecolor(Number(c)); else closeRecolor();
    if (screen === 'gallery') openGallery(); else closeGallery();
    if (screen === 'home') showHome(lessons, open); else hideHome();
  };
  // Open synchronously inside the tap (speech needs the gesture), then let hashchange catch up.
  const open = (l: Lesson) => { location.hash = `#lesson/${l.id}`; route(); };
  addEventListener('hashchange', route);
  route();
});
