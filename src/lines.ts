// Every spoken line that lives in the code (lesson and path lines live in lessons/ and path/). Narration clips are
// generated for each of them (npm run voice), so keep this file to plain double-quoted string literals: the voice
// scripts collect every double-quoted string here without running it (so no double quotes in comments). A line built
// from runtime values would have no clip and fall back to the browser's own voice.

/** The last lesson step is checked: Color mode starts. */
export const COLOR_TIME = "Time to color! Pick a crayon.";
/** The tracing result card, by stars (index 1..3). */
export const RESULT_CHEER = ["", "Nice try! Let's color it!", "Two stars! Great job!", "Wow, three stars! Amazing!"];
/** Done in Color mode, Free draw or a path `create`: one picked at random with the confetti. */
export const PARTY_CHEERS = ["Hooray! You did it!", "Wow, what a beautiful picture!", "Amazing! Great job!"];
/** A path `lesson` exercise with no `say` of its own. */
export const LESSON_SAY = "Let's draw a whole picture! Tap the green button.";
/** A path stop's result card, by stars (index 1..3). */
export const STOP_CHEER = ["", "You did it! Here is your sticker!", "Great job! Here is your sticker!", "Wow, three stars! Here is your sticker!"];
