// Hash routing: #lesson/<id> shows that lesson, anything else the picker.
import { suppressGestures } from './engine/surface';
import { closeLesson, openLesson, type Lesson } from './lesson';
import { hidePicker, showPicker } from './picker';
import { loadSpeechSettings } from './speech';
import './sw-register'; // registers the offline service worker (production builds only)

suppressGestures();

// Settings load before the first screen so muted() is right from the first spoken line.
Promise.all([fetch('./lessons.json').then((r) => r.json()), loadSpeechSettings()]).then(([lessons]: [Lesson[], void]) => {
  const route = () => {
    const id = location.hash.match(/^#lesson\/(.+)$/)?.[1];
    const l = lessons.find((l) => l.id === id);
    if (l) { hidePicker(); openLesson(l); } // openLesson ignores a repeat for the open lesson
    else { closeLesson(); showPicker(lessons, open); }
  };
  // Open synchronously inside the tap (speech needs the gesture), then let hashchange catch up.
  const open = (l: Lesson) => { location.hash = `#lesson/${l.id}`; route(); };
  addEventListener('hashchange', route);
  route();
});
