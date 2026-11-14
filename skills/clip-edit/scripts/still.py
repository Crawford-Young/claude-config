"""still.py <image> <out.png> --crop x0,y0,x1,y1 [--size WxH] — crop a screenshot (e.g. a profile photo inside
the phone's Photos app chrome) and resize it to a full-frame overlay. Pair with captions.py extra_overlays."""
import argparse
from PIL import Image

p = argparse.ArgumentParser(); p.add_argument("image"); p.add_argument("out")
p.add_argument("--crop", required=True); p.add_argument("--size", default="610x1080"); a = p.parse_args()
box = tuple(map(int, a.crop.split(","))); size = tuple(map(int, a.size.lower().split("x")))
Image.open(a.image).convert("RGB").crop(box).resize(size, Image.LANCZOS).save(a.out); print(a.out, size)
