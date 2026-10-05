#!/usr/bin/env python3
"""Generate a narration clip for every line the app can speak: npm run voice (from the repo root).

Lines come from `node scripts/voice.mjs --list`. Each clip is public/voice/<hash>.m4a, the hash of (voice, speed,
exact text), so unchanged lines are never regenerated; public/voice/index.json maps each exact app text to its clip
and duration. Clips no longer referenced are deleted. Exits non-zero if any line failed (the rest are kept).
"""
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).parent))
from say import synth  # noqa: E402

VOICE, SPEED, SR = "af_heart", 0.9, 24000
LOUDNESS = "I=-16:TP=-1.5:LRA=11"  # integrated LUFS, true peak: every line at one level
BITRATE = "32k"  # AAC-LC mono; see README for why
LEAD, TAIL = 0.05, 0.15  # seconds of natural pad kept before the first and after the last sound
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "voice"

# Names the default lexicon gets wrong (checked against the phonemes Kokoro produced): word -> Kokoro phonemes.
PRONOUNCE = {"Lilo": "lˈilO", "Moana": "mOˈɑnə", "Rapunzel": "ɹəpˈʌnzᵊl"}


def clip_name(text):
    return hashlib.sha256(f"{VOICE}\n{SPEED}\n{text}".encode()).hexdigest()[:12] + ".m4a"


def spoken(text):
    """What the TTS reads for an app line. The manifest key stays the exact app text."""
    t = re.sub(r"\b[A-Z]{2,}\b", lambda m: m[0].lower(), text)  # "VERY" is emphasis, not an acronym to spell out
    t = "".join(c for c in t if not unicodedata.category(c).startswith(("S", "C")) or c in "+=")  # emoji, symbols
    for word, ph in PRONOUNCE.items():  # possessive too: a custom word's own "'s" would come out as /s/, these all end voiced
        t = re.sub(rf"\b{word}('s)?\b", lambda m: f"[{m[0]}](/{ph}{'z' if m[1] else ''}/)", t)
    return re.sub(r"\s+", " ", t).strip()


def trim(a):
    """Cut leading/trailing silence down to a short natural pad."""
    loud = np.flatnonzero(np.abs(a) > 0.01 * np.abs(a).max())  # -40 dB under the peak
    return a[max(0, loud[0] - int(LEAD * SR)): loud[-1] + int(TAIL * SR)]


def ffmpeg(*args):
    return subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", "-y", *args], check=True, capture_output=True, text=True)


ENCODER = "aac_at" if "aac_at" in ffmpeg("-encoders").stdout else "aac"  # Apple's AAC (macOS) is cleaner at low rates


def encode(a, dest):
    """Two-pass loudnorm (measure, then a linear gain) to AAC in .m4a, mono 24 kHz."""
    with tempfile.TemporaryDirectory() as d:
        wav = Path(d) / "in.wav"
        sf.write(wav, a, SR)
        m = json.loads(re.findall(r"\{[^{}]+\}", ffmpeg("-i", wav, "-af", f"loudnorm={LOUDNESS}:print_format=json", "-f", "null", "-").stderr)[-1])
        ln = (f"loudnorm={LOUDNESS}:linear=true:measured_I={m['input_i']}:measured_TP={m['input_tp']}"
              f":measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}")
        tmp = Path(d) / "out.m4a"
        ffmpeg("-i", wav, "-af", ln, "-ar", str(SR), "-ac", "1", "-c:a", ENCODER, "-b:a", BITRATE,
               "-map_metadata", "-1", "-movflags", "+faststart", tmp)
        shutil.move(tmp, dest)


def duration(f):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f],
                       check=True, capture_output=True, text=True)
    return float(r.stdout)


def main():
    lines = json.loads(subprocess.run(["node", "scripts/voice.mjs", "--list"], cwd=ROOT, check=True,
                                      capture_output=True, text=True).stdout)
    OUT.mkdir(parents=True, exist_ok=True)
    index = OUT / "index.json"
    old = json.loads(index.read_text())["lines"] if index.exists() else {}
    manifest, jobs, failed, reused = {}, {}, [], 0
    with ThreadPoolExecutor(4) as pool:
        for text in lines:
            name = clip_name(text)
            f = OUT / name
            if f.exists() and f.stat().st_size > 0:
                dur = old[text]["dur"] if old.get(text, {}).get("file") == name else round(duration(f), 2)
                manifest[text] = {"file": name, "dur": dur}
                reused += 1
                continue
            try:
                a = trim(synth(spoken(text), VOICE, SPEED))
                manifest[text] = {"file": name, "dur": round(len(a) / SR, 2)}
                jobs[text] = pool.submit(encode, a, f)
                print(f"  new {name} {text}", flush=True)
            except Exception as e:  # noqa: BLE001 - report every failure, keep going
                failed.append((text, e))
        for text, job in jobs.items():
            try:
                job.result()
            except Exception as e:  # noqa: BLE001
                failed.append((text, getattr(e, "stderr", None) or e))
                del manifest[text]
    keep = {c["file"] for c in manifest.values()}
    removed = [f for f in OUT.glob("*.m4a") if f.name not in keep]
    for f in removed:
        f.unlink()
    index.write_text(json.dumps({"voice": VOICE, "speed": SPEED, "lines": manifest}, ensure_ascii=False, indent=1, sort_keys=True) + "\n")

    durs = sorted((c["dur"], t) for t, c in manifest.items())
    size = sum(f.stat().st_size for f in OUT.glob("*.m4a"))
    print(f"voice: {len(lines)} lines, {len(jobs) - len([1 for t, _ in failed if t in jobs])} new, {reused} reused, "
          f"{len(removed)} removed, {len(keep)} clips, {size:,} bytes ({ENCODER} {BITRATE})")
    if durs:
        print(f"  average {sum(d for d, _ in durs) / len(durs):.2f} s, longest {durs[-1][0]} s: {durs[-1][1]}")
    special = [(t, spoken(t)) for t in lines if spoken(t) != t]
    for t, s in special:
        print(f"  spoken as: {s!r}  (app text {t!r})")
    for d, t in durs:
        if d < 0.4 or d > 15:
            print(f"  WARNING implausible duration {d} s: {t}")
    for t, e in failed:
        print(f"FAILED {t!r}: {e}", file=sys.stderr)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
