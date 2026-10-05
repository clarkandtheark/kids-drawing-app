#!/usr/bin/env python3
"""Synthesise one line with Kokoro-82M: say.py --voice af_heart --speed 0.9 --out x.wav "text"."""
import argparse
import numpy as np
import soundfile as sf

# Graded voices from the Kokoro-82M VOICES.md (overall grade); American 'a', British 'b'.
VOICES = {"af_heart": "A", "af_bella": "A-", "af_nicole": "B-", "bf_emma": "B-",
          "af_aoede": "C+", "af_sarah": "C+", "am_michael": "C+", "am_fenrir": "C+"}
_pipes = {}

def synth(text, voice, speed=0.9):
    from kokoro import KPipeline
    lang = voice[0]  # 'a' American, 'b' British
    pipe = _pipes.setdefault(lang, KPipeline(lang_code=lang, repo_id="hexgrad/Kokoro-82M"))
    return np.concatenate([np.asarray(a) for _, _, a in pipe(text, voice=voice, speed=speed)])

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--voice", default="af_heart")
    p.add_argument("--speed", type=float, default=0.9)
    p.add_argument("--out")
    p.add_argument("--list", action="store_true")
    p.add_argument("text", nargs="?")
    a = p.parse_args()
    if a.list:
        for v, g in VOICES.items():
            print(v, g)
    else:
        sf.write(a.out, synth(a.text, a.voice, a.speed), 24000)
