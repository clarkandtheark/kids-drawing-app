#!/usr/bin/env python3
"""Write review/voices/<voice>/NN.wav (+ concatenated <voice>.wav) for every voice in say.VOICES."""
import sys
from pathlib import Path
import numpy as np
import soundfile as sf
from say import VOICES, synth

LINES = ["Draw a big circle for the head.", "Now draw two pointy ears on top of the circle!",
         "Give your cat two oval eyes.", "Hooray! You did it!"]
out = Path(sys.argv[1] if len(sys.argv) > 1 else "review/voices")
speed = float(sys.argv[2]) if len(sys.argv) > 2 else 0.9
gap = np.zeros(int(24000 * 0.6), dtype=np.float32)
for v in VOICES:
    (out / v).mkdir(parents=True, exist_ok=True)
    parts = []
    for i, t in enumerate(LINES, 1):
        a = synth(t, v, speed)
        sf.write(out / v / f"{i}.wav", a, 24000)
        parts += [a, gap]
    sf.write(out / f"{v}.wav", np.concatenate(parts[:-1]), 24000)
    print(v, "done", flush=True)
