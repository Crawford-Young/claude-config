"""mask.py <spec.json> <out_dir> — boxes that cover baked-in caption words with "****", timed frame-exact.
spec: {"size":[972,1728], "font_size":66, "stroke":6, "y0":600, "y1":675, "ink_cy":628,
       "masks":[{"name":"w_on", "x0":254, "x1":560, "color":"purple"|"black"|[r,g,b], "start":9.825, "end":10.142}]}
Purple while the baked caption highlights that word, black otherwise; x-ranges and switch times from capswitch.py."""
import pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))  # python -I drops the script dir
from PIL import Image, ImageDraw, ImageFont
from common import BLACK, FONT_BOLD, PURPLE, load_spec

if len(sys.argv) != 3:
    raise SystemExit(__doc__)
spec, out = load_spec(sys.argv[1]), pathlib.Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
W, H = spec.get("size", [972, 1728]); fs = spec.get("font_size", 66); st = spec.get("stroke", round(fs / 11))
font = ImageFont.truetype(FONT_BOLD, fs)
colors = {"purple": PURPLE, "black": BLACK}
lines = []
for m in spec["masks"]:
    col = colors[m["color"]] if isinstance(m["color"], str) else tuple(m["color"]) + (255,)
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.rectangle([m["x0"], spec["y0"], m["x1"], spec["y1"]], fill=col)
    l, t, r, b = d.textbbox((0, 0), "****", font=font, stroke_width=st)
    d.text(((m["x0"] + m["x1"]) / 2 - (l + r) / 2, spec["ink_cy"] - (t + b) / 2), "****", font=font, fill="white", stroke_width=st, stroke_fill="black")
    img.save(out / f"{m['name']}.png"); lines.append(f"{m['name']}.png {m['start']:.3f} {m['end']:.3f}")
(out / "overlays.txt").write_text("\n".join(lines) + "\n"); print("\n".join(lines))
