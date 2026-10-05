# Narration TTS (Kokoro-82M, local)

Pre-generates a narration clip for every line the app speaks with the open-weight Kokoro-82M model. The generated
audio (`public/voice/`) is committed to the repo, because the deploy workflow has no Python; the Python environment
and the model are not.

## Setup (once per machine, outside the repo)
```
uv venv ~/.cache/kids-drawing-tts/venv --python 3.11
uv pip install --python ~/.cache/kids-drawing-tts/venv/bin/python kokoro soundfile pip "transformers>=4.40"
```
(`transformers>=4.40` stops uv backtracking to an ancient transformers that needs a Rust build; `pip` lets misaki fetch the spaCy `en_core_web_sm` model on first run. espeak-ng is bundled via `espeakng-loader`, no brew install needed.)
Also needs `ffmpeg` and `ffprobe` on the PATH (`brew install ffmpeg`).

## After changing any spoken text: `npm run voice`
Runs `generate.py`, which:
- collects every line from `node scripts/voice.mjs --list` (each `say` in `lessons/` and `path/`, plus `src/lines.ts`);
- names each clip by a hash of (voice, speed, exact text), so unchanged lines are reused, never regenerated;
- synthesises new lines with `af_heart` at speed 0.9, trims silence to a short pad (50 ms before, 150 ms after),
  normalises loudness (ffmpeg `loudnorm`, two-pass linear, -16 LUFS, mono) and encodes AAC-LC mono 32 kbps in `.m4a`
  (Apple's `aac_at` encoder on macOS; ffmpeg's own `aac` elsewhere);
- writes `public/voice/index.json` (exact app text -> file and duration), deletes clips no longer referenced, prints a
  summary, and exits non-zero if any line failed.

Then commit `public/voice/`. `npm run build` runs `node scripts/voice.mjs`, which fails listing any line without a clip.

Only the text sent to the model is adjusted (the manifest key stays the app's exact text): words in capitals
("VERY") are lowercased, emoji and symbols dropped, and names the lexicon gets wrong get their phonemes (`PRONOUNCE`
in `generate.py`: Lilo, Moana, Rapunzel). Check a new character name with `say.py` and add it there if needed.

Why 32 kbps: measured on decoded clips, `aac_at` at 24 kbps cuts everything above ~6 kHz (dull), 32 kbps keeps speech
up to ~8.5 kHz with the same waveform error as ffmpeg's `aac` at 32 kbps (which keeps the full band by spreading the
bits thin), and 48 kbps adds ~50% size for detail above 8 kHz.

## Other tools
```
PY=~/.cache/kids-drawing-tts/venv/bin/python
$PY tools/tts/say.py --list
$PY tools/tts/say.py --voice af_heart --speed 0.9 --out /tmp/x.wav "Draw a big circle for the head."
$PY tools/tts/samples.py review/voices 0.9   # four sample lines for every listed voice
```

## Where things are cached
Venv: `~/.cache/kids-drawing-tts/venv`. Model weights and voices: default Hugging Face cache (`~/.cache/huggingface`).

## Licences
Kokoro-82M weights: Apache-2.0. The model card's VOICES.md lists no per-voice licence terms for the English voices used here (only the Japanese voices carry CC BY attributions). Re-check the card if you add voices.
