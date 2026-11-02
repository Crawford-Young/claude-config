"""xfade.py <out> <in0> [<in1>...] -- <seg>... ; seg = "input_index:start:end:fade"
fade = crossfade seconds INTO this segment (ignored on the first). Output 60 fps, x264 crf 18, aac 192k."""
import pathlib, subprocess, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))  # python -I drops the script dir
from common import ffmpeg

a = sys.argv[1:]
if "--" not in a or len(a) < 4:
    raise SystemExit(__doc__)
out = a[0]; k = a.index("--"); ins = a[1:k]; segs = [tuple(map(float, s.split(":"))) for s in a[k + 1:]]
fc = []
for n, (i, s, e, _) in enumerate(segs):
    i = int(i)
    fc.append(f"[{i}:v]trim=start={s}:end={e},setpts=PTS-STARTPTS,fps=60,format=yuv420p,settb=AVTB[v{n}]")
    fc.append(f"[{i}:a]atrim=start={s}:end={e},asetpts=PTS-STARTPTS,aresample=48000[a{n}]")
L = segs[0][2] - segs[0][1]; pv, pa = "v0", "a0"
for n in range(1, len(segs)):
    d = segs[n][3]; off = L - d
    fc.append(f"[{pv}][v{n}]xfade=transition=fade:duration={d}:offset={off:.4f}[x{n}]")
    fc.append(f"[{pa}][a{n}]acrossfade=d={d}:c1=tri:c2=tri[y{n}]")
    pv, pa = f"x{n}", f"y{n}"; L += segs[n][2] - segs[n][1] - d
cmd = [ffmpeg(), "-v", "error", "-y"] + sum([["-i", p] for p in ins], []) + ["-filter_complex", ";".join(fc), "-map", f"[{pv}]", "-map", f"[{pa}]",
       "-c:v", "libx264", "-crf", "18", "-preset", "slow", "-pix_fmt", "yuv420p", "-r", "60", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]
subprocess.run(cmd, check=True); print(f"{out}: expected {L:.2f}s")
