"""findcuts.py <original> <trim> — recover the kept ranges of an already-cut clip by matching every
trim frame to its nearest original frame (60 fps, 32x56 grey thumbnails). Prints trim -> orig ranges."""
import pathlib, subprocess, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))  # python -I drops the script dir
import numpy as np
from common import ffmpeg

if len(sys.argv) != 3:
    raise SystemExit(__doc__)
W, H = 32, 56
def frames(p):
    raw = subprocess.run([ffmpeg(), "-v", "error", "-i", p, "-vf", f"fps=60,scale={W}:{H},format=gray", "-f", "rawvideo", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, W * H).astype(np.float32)
O, T = frames(sys.argv[1]), frames(sys.argv[2])
d = (T**2).sum(1)[:, None] - 2 * T @ O.T + (O**2).sum(1)[None, :]
off = d.argmin(1) - np.arange(len(T))
k = 10; sm = np.array([int(np.median(off[max(0, i-k):i+k+1])) for i in range(len(off))])  # 21-frame median
segs = []; s = 0
for i in range(1, len(sm) + 1):
    if i == len(sm) or abs(sm[i] - sm[s]) > 2:
        if i - s >= 6: segs.append((s, i, int(np.median(sm[s:i]))))
        s = i
print(f"orig {len(O)/60:.2f}s  trim {len(T)/60:.2f}s")
for a, b, o in segs:
    print(f"trim {a/60:6.2f}-{b/60:6.2f}  <- orig {(a+o)/60:6.2f}-{(b+o)/60:6.2f}")
