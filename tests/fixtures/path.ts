// A fixed learning path for the player tests, served instead of the built path.json (usePath in ../helpers.ts), so
// the tests never depend on the curriculum in path/. Stops `straight` and `zigzag` are the original two-stop sample
// unit (git show fd77bde:path/01-lines.json); stop `own` adds a shape with accepted alternatives and open finishes.
const ZIGZAG3 = 'M 200 600 L 300 400 L 400 600 L 500 400 L 600 600 L 700 400 L 800 600';
export const ZIGZAG2 = 'M 200 600 L 350 400 L 500 600 L 650 400 L 800 600';
export const ZIGZAG4 = 'M 200 600 L 275 400 L 350 600 L 425 400 L 500 600 L 575 400 L 650 600 L 725 400 L 800 600';
export const FACE = ['M 360 450 A 40 40 0 1 0 440 450 A 40 40 0 1 0 360 450', 'M 560 450 A 40 40 0 1 0 640 450 A 40 40 0 1 0 560 450', 'M 400 620 Q 500 700 600 620'];

export const SAMPLE = [{
  id: 'lines',
  title: 'Lines',
  emoji: '〰️',
  stops: [
    {
      id: 'straight',
      title: 'Straight lines',
      sticker: '🌟',
      exercises: [
        { type: 'trace', say: 'Trace the line, all the way across.', strokes: ['M 200 500 L 800 500'] },
        { type: 'trace', say: 'Now trace the line from the top to the bottom.', strokes: ['M 500 200 L 500 800'] },
        { type: 'shape', say: 'Now draw your own straight line, anywhere you like!', strokes: ['M 200 500 L 800 500'], rotations: [45, 90, 135], closed: false },
        { type: 'memory', say: 'Look at these two lines. Now they will hide. Can you draw them?', strokes: ['M 500 250 L 500 750', 'M 250 500 L 750 500'] },
        { type: 'finish', say: 'Finish the ladder. Draw three steps across.', given: ['M 350 150 L 350 850', 'M 650 150 L 650 850'], strokes: ['M 350 300 L 650 300', 'M 350 500 L 650 500', 'M 350 700 L 650 700'], hint: true },
        { type: 'lesson', lesson: 'sun', say: "Let's draw a sunny sun with lots of straight rays!" },
      ],
    },
    {
      id: 'zigzag',
      title: 'Zigzags and waves',
      sticker: '⚡',
      exercises: [
        { type: 'trace', say: 'Trace the zigzag. Up, down, up, down!', strokes: ['M 200 600 L 320 400 L 440 600 L 560 400 L 680 600 L 800 400'] },
        { type: 'shape', say: 'Now draw your own zigzag, anywhere you like!', strokes: ['M 200 600 L 320 400 L 440 600 L 560 400 L 680 600 L 800 400'] },
        { type: 'trace', say: 'Trace the wavy line, like the sea.', strokes: ['M 150 500 Q 237.5 350 325 500 T 500 500 T 675 500 T 850 500'] },
        { type: 'memory', say: 'Look at this wave. Now it will hide. Can you draw it?', strokes: ['M 150 500 Q 237.5 350 325 500 T 500 500 T 675 500 T 850 500'] },
        { type: 'finish', say: 'Finish the crown with a zigzag on top.', given: ['M 250 450 L 250 750 L 750 750 L 750 450'], strokes: ['M 250 450 L 375 280 L 500 450 L 625 280 L 750 450'] },
        { type: 'create', say: 'Draw a mountain range with lots of pointy mountains!' },
      ],
    },
    {
      id: 'own',
      title: 'Your own way',
      sticker: '🎈',
      exercises: [
        { type: 'shape', say: 'Draw a zigzag with three pointy tops.', strokes: [ZIGZAG3], also: [[ZIGZAG2], [ZIGZAG4]] },
        { type: 'finish', say: 'Give it a face, any way you like.', given: ['M 250 500 A 250 250 0 1 0 750 500 A 250 250 0 1 0 250 500'], strokes: FACE, open: true },
        { type: 'finish', say: 'Give it this face.', given: ['M 250 500 A 250 250 0 1 0 750 500 A 250 250 0 1 0 250 500'], strokes: FACE },
      ],
    },
  ],
}];
