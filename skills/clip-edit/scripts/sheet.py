"""sheet.py <src> <out.png> [--times t ...] — contact sheet of 360x640 frames with TikTok safe-zone guides
(red: top 130, bottom 320, right 120 px of 1080x1920). Default times: 0, 0.7, 1.5, 3.0, middle, end-0.3."""
import argparse, pathlib, subprocess, sys, tempfile
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))  # python -I drops the script dir
from PIL import Image, ImageDraw
from common import duration, ffmpeg

p = argparse.ArgumentParser(); p.add_argument("src"); p.add_argument("out"); p.add_argument("--times", type=float, nargs="+")
a = p.parse_args()
dur = duration(a.src)
times = a.times or [0.0, 0.7, 1.5, 3.0, dur * 0.5, dur - 0.3]
tiles = []
with tempfile.TemporaryDirectory() as td:
    for n, t in enumerate(times):
        tmp = pathlib.Path(td) / f"{n}.png"
        subprocess.run([ffmpeg(), "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", a.src, "-frames:v", "1", "-vf", "scale=360:640", str(tmp)], check=True)
        im = Image.open(tmp).convert("RGB"); d = ImageDraw.Draw(im); s = 360 / 1080
        d.rectangle([0, 640 - int(320 * s), 360, 640], outline=(255, 0, 0), width=2)
        d.rectangle([360 - int(120 * s), 0, 360, 640], outline=(255, 0, 0), width=2)
        d.rectangle([0, 0, 360, int(130 * s)], outline=(255, 0, 0), width=2)
        d.rectangle([0, 0, 70, 22], fill=(0, 0, 0)); d.text((4, 4), f"{t:.1f}s", fill=(255, 255, 0))
        tiles.append(im)
sheet = Image.new("RGB", (360 * len(tiles), 640))
for i, im in enumerate(tiles): sheet.paste(im, (360 * i, 0))
sheet.save(a.out); print(a.out, f"{dur:.2f}s")
