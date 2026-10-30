"""captions.py <spec.json> <out_dir> — karaoke caption PNG states + overlays.txt for burn.sh.
spec: {"size":[972,1728], "center_y":632, "font_size":66, "stroke":6?, "shift":0?,
       "extra_overlays":["pfp.png 17.10 99"]?, "lines":[{"words":["Holy","****"],"times":[0.0,0.55],"end":1.6}]}
One state per word: the whole line shows, the active word gets the purple box. See ../examples/."""
import pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))  # python -I drops the script dir
from common import load_spec, render_captions

if len(sys.argv) != 3:
    raise SystemExit(__doc__)
spec, out = load_spec(sys.argv[1]), pathlib.Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
lines = spec.get("extra_overlays", []) + render_captions(spec, out)
(out / "overlays.txt").write_text("\n".join(lines) + "\n")
print("\n".join(lines))
