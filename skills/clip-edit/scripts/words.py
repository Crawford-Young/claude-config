"""words.py <media>... [--start S] [--end E] — loudness dB per 0.5 s (spots dead air) + word-level timestamps.
Use the word times for caption timing and bleep/mask windows; times are on the source timeline."""
import argparse, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))  # python -I drops the script dir
import numpy as np
from common import audio16k

p = argparse.ArgumentParser(); p.add_argument("media", nargs="+")
p.add_argument("--start", type=float); p.add_argument("--end", type=float)
a = p.parse_args()
from faster_whisper import WhisperModel
model = WhisperModel("small.en", device="cpu", compute_type="int8")
off = a.start or 0.0
for m in a.media:
    audio = audio16k(m, a.start, a.end)
    step = 8000  # 0.5 s at 16 kHz
    rms = [20 * np.log10(np.sqrt(np.mean(audio[i:i + step] ** 2)) + 1e-9) for i in range(0, len(audio), step)]
    print(f"## {pathlib.Path(m).name} loudness dB per 0.5s:")
    print(" ".join(f"{off + i / 2:.1f}:{v:.0f}" for i, v in enumerate(rms)))
    segs, _ = model.transcribe(audio, word_timestamps=True, vad_filter=False)
    print("words:")
    print(" ".join(f"{w.word.strip()}[{w.start + off:.2f}-{w.end + off:.2f}]" for s in segs for w in s.words))
    print()
