"""capswitch.py <src> <t0> <t1> [--crop W:H:X:Y] — find the frames where a baked-in caption changes, from the
white-text and purple-box (#7C4DF7) pixel extents inside the crop band (default 972:110:0:580 = the seam
captions of a 972x1728 export). Prints a line per change: time, white x-range, purple x-range, white y-range."""
import argparse, pathlib, subprocess, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))  # python -I drops the script dir
import numpy as np
from common import ffmpeg, fps

p = argparse.ArgumentParser(); p.add_argument("src"); p.add_argument("t0", type=float); p.add_argument("t1", type=float)
p.add_argument("--crop", default="972:110:0:580"); a = p.parse_args()
W, H, X0, Y0 = map(int, a.crop.split(":"))
rate = fps(a.src)
raw = subprocess.check_output([ffmpeg(), "-v", "error", "-ss", str(a.t0), "-i", a.src, "-t", str(a.t1 - a.t0),
                               "-vf", f"crop={W}:{H}:{X0}:{Y0}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
fr = np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3).astype(int)
print("fps", rate, "frames", len(fr))
ext = lambda idx, base: f"{base + idx.min()}-{base + idx.max()}" if len(idx) else "none"
prev = None
for i, f in enumerate(fr):
    white = f.min(axis=2) > 225
    purple = (abs(f[..., 0] - 124) < 30) & (abs(f[..., 1] - 77) < 30) & (abs(f[..., 2] - 247) < 30)
    cols = np.where(white.any(axis=0))[0]; pc = np.where(purple.sum(axis=0) > 20)[0]
    sig = (cols.min() if len(cols) else -1, cols.max() if len(cols) else -1, pc.min() if len(pc) else -1, pc.max() if len(pc) else -1)
    if prev is None or any(abs(x - y) > 6 for x, y in zip(sig, prev)):
        rows = np.where(white.any(axis=1))[0]
        print(f"t={a.t0 + i / rate:.3f} white_x={ext(cols, X0)} purple_x={ext(pc, X0)} white_y={ext(rows, Y0)}")
    prev = sig
