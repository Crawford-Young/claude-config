"""call_screen.py <pfp_image> <out_dir> <spec.json> — Discord-style call screen (610x1080, one half of a
split-screen intro): avatar tile, name tag, control bar, green speaking ring, plus karaoke captions.
spec: {"name":"Gabe", "crop":[x0,y0,x1,y1] (square face crop of the photo), "ring":[start,end],
       "captions":{"center_y":790, "font_size":41, "lines":[...captions.py lines...]}}
Writes bg_off.png (base, use as the segment's video), ring.png, cap_NN.png, overlays.txt (segment-local times)."""
import pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))  # python -I drops the script dir
from PIL import Image, ImageDraw, ImageFont
from common import load_spec, render_captions

if len(sys.argv) != 4:
    raise SystemExit(__doc__)
pfp_src, out, spec = sys.argv[1], pathlib.Path(sys.argv[2]), load_spec(sys.argv[3]); out.mkdir(parents=True, exist_ok=True)
W, H = 610, 1080
BG, TILE, BTN = (17, 18, 20), (43, 45, 49), (54, 57, 63)
GREEN, RED, WHITE = (35, 165, 90), (218, 55, 60), (255, 255, 255)
S = 3  # supersample for smooth circles
def big(): return Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
def down(im): return im.resize((W, H), Image.LANCZOS)

AV_C, AV_R = (305, 410), 150            # avatar centre / radius
base = big(); d = ImageDraw.Draw(base)
d.rectangle([0, 0, W * S, H * S], fill=BG)
d.rounded_rectangle([24 * S, 150 * S, 586 * S, 690 * S], radius=18 * S, fill=TILE)
face = Image.open(pfp_src).convert("RGB").crop(tuple(spec["crop"])).resize((2 * AV_R * S,) * 2, Image.LANCZOS)
mask = Image.new("L", face.size, 0); ImageDraw.Draw(mask).ellipse([0, 0, *face.size], fill=255)
base.paste(face, ((AV_C[0] - AV_R) * S, (AV_C[1] - AV_R) * S), mask)
# name tag, bottom-left of tile
fn = ImageFont.truetype("C:/Windows/Fonts/seguisb.ttf", 26 * S)
tw = d.textlength(spec["name"], font=fn)
d.rounded_rectangle([40 * S, 630 * S, 40 * S + tw + 28 * S, 672 * S], radius=10 * S, fill=(0, 0, 0, 150))
d.text((54 * S, 634 * S), spec["name"], font=fn, fill=WHITE)
# control bar: camera, mic, screen share, leave
cy, r = 985, 34
for i, cx in enumerate([155, 255, 355, 455]):
    d.ellipse([(cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S], fill=RED if i == 3 else BTN)
    x, y = cx * S, cy * S; u = S
    if i == 0:   # camera
        d.rounded_rectangle([x - 16*u, y - 10*u, x + 6*u, y + 10*u], radius=3*u, fill=WHITE)
        d.polygon([(x + 6*u, y - 2*u), (x + 16*u, y - 9*u), (x + 16*u, y + 9*u), (x + 6*u, y + 2*u)], fill=WHITE)
    elif i == 1: # mic
        d.rounded_rectangle([x - 6*u, y - 17*u, x + 6*u, y + 4*u], radius=6*u, fill=WHITE)
        d.arc([x - 12*u, y - 10*u, x + 12*u, y + 11*u], 0, 180, fill=WHITE, width=3*u)
        d.line([x, y + 11*u, x, y + 17*u], fill=WHITE, width=3*u)
    elif i == 2: # screen share
        d.rounded_rectangle([x - 16*u, y - 12*u, x + 16*u, y + 10*u], radius=3*u, outline=WHITE, width=3*u)
        d.polygon([(x, y - 7*u), (x + 7*u, y + 1*u), (x - 7*u, y + 1*u)], fill=WHITE)
        d.line([x, y, x, y + 6*u], fill=WHITE, width=3*u)
    else:        # leave call: handset
        d.arc([x - 17*u, y - 8*u, x + 17*u, y + 22*u], 200, 340, fill=WHITE, width=7*u)
down(base).convert("RGB").save(out / "bg_off.png")

ring = big(); dr = ImageDraw.Draw(ring); g = AV_R + 9
dr.ellipse([(AV_C[0] - g) * S, (AV_C[1] - g) * S, (AV_C[0] + g) * S, (AV_C[1] + g) * S], outline=GREEN, width=6 * S)
dr.rounded_rectangle([24 * S, 150 * S, 586 * S, 690 * S], radius=18 * S, outline=GREEN, width=3 * S)
down(ring).save(out / "ring.png")

caps = dict(spec.get("captions", {}), size=[W, H])
lines = [f"ring.png {spec['ring'][0]:.2f} {spec['ring'][1]:.2f}"] + (render_captions(caps, out) if caps.get("lines") else [])
(out / "overlays.txt").write_text("\n".join(lines) + "\n"); print("\n".join(lines))
