"""transcribe.py <media>... [--start S] [--end E] [--out FILE] — faster-whisper small.en (int8 CPU) segments.
Times print on the source timeline even with --start. Whisper mishears names: the user's lines win."""
import argparse, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))  # python -I drops the script dir
from common import audio16k

p = argparse.ArgumentParser(); p.add_argument("media", nargs="+")
p.add_argument("--start", type=float); p.add_argument("--end", type=float); p.add_argument("--out")
a = p.parse_args()
from faster_whisper import WhisperModel
model = WhisperModel("small.en", device="cpu", compute_type="int8")
off = a.start or 0.0
out = []
for m in a.media:
    segs, _ = model.transcribe(audio16k(m, a.start, a.end), vad_filter=False)
    out.append(f"## {pathlib.Path(m).name}")
    out += [f"[{s.start + off:6.1f}-{s.end + off:6.1f}] {s.text.strip()}" for s in segs]
    out.append("")
if a.out:
    pathlib.Path(a.out).write_text("\n".join(out), encoding="utf-8")
print("\n".join(out))
