"""Shared helpers for the clip-edit scripts: ffmpeg lookup, audio decode, karaoke caption drawing.

Scripts run with `python -I` (isolated), so each one adds this folder to sys.path itself.
"""
import glob, json, os, pathlib, shutil, subprocess

FONT_BOLD = "C:/Windows/Fonts/arialbd.ttf"
PURPLE = (124, 77, 247, 255)   # #7C4DF7 active-word box
BLACK = (12, 12, 14, 255)


def ffmpeg(tool="ffmpeg"):
    """Path to ffmpeg/ffprobe: $FFMPEG_BIN, then PATH, then the WinGet Gyan build."""
    exe = tool + (".exe" if os.name == "nt" else "")
    if os.environ.get("FFMPEG_BIN"):
        return str(pathlib.Path(os.environ["FFMPEG_BIN"]) / exe)
    hit = shutil.which(tool)
    if hit:
        return hit
    pat = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft/WinGet/Packages/Gyan.FFmpeg_*/ffmpeg-*/bin", exe)
    found = sorted(glob.glob(pat))
    if not found:
        raise SystemExit(f"{tool} not found: set FFMPEG_BIN or `winget install Gyan.FFmpeg`")
    return found[-1]


def duration(src):
    out = subprocess.check_output([ffmpeg("ffprobe"), "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src])
    return float(out.decode().strip())


def fps(src):
    out = subprocess.check_output([ffmpeg("ffprobe"), "-v", "error", "-select_streams", "v", "-show_entries",
                                   "stream=r_frame_rate", "-of", "csv=p=0", src]).decode().strip()
    n, d = map(int, out.split("/"))
    return n / d


def audio16k(src, start=None, end=None):
    """Mono 16 kHz float32 samples of any media file (optionally a start/end window), via ffmpeg."""
    import numpy as np
    cmd =[ffmpeg(), "-v", "error"]
    if start is not None:
        cmd += ["-ss", str(start)]
    if end is not None:
        cmd += ["-to", str(end)]
    cmd += ["-i", src, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"]
    return np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, np.float32)


def load_spec(path):
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))


def caption_states(lines, shift=0.0):
    """[{words, times, end}] -> [(t0, t1, words, active_index)], one state per highlighted word."""
    states = []
    for ln in lines:
        words, times, end = ln["words"], ln["times"], ln["end"]
        if len(words) != len(times):
            raise SystemExit(f"words/times length mismatch: {words}")
        for i, t in enumerate(times):
            t1 = times[i + 1] if i + 1 < len(times) else end
            states.append((t - shift, t1 - shift, words, i))
    return states


def draw_caption(size, words, active, center_y, font_size=66, stroke=None):
    """Transparent RGBA frame: white words with black stroke, purple box behind the active word.
    Padding scales with font size (66px -> 4px side, 8px top, 12px bottom)."""
    from PIL import Image, ImageDraw, ImageFont
    font = ImageFont.truetype(FONT_BOLD, font_size)
    stroke = round(font_size / 11) if stroke is None else stroke
    W, H = size
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    space = font.getlength(" ")
    ascent, descent = font.getmetrics()
    widths = [font.getlength(w) for w in words]
    x = (W - sum(widths) - space * (len(words) - 1)) / 2
    top = center_y - (ascent + descent) / 2
    ax = x + sum(widths[:active]) + space * active
    core = words[active].rstrip("!?.,") or words[active]   # box the letters, not trailing punctuation
    side, pt, pb = round(font_size * 0.06), round(font_size * 0.12), round(font_size * 0.18)
    d.rectangle([ax - side, top + pt, ax + font.getlength(core) + side, top + ascent + pb], fill=PURPLE)
    for i, w in enumerate(words):
        d.text((x, top), w, font=font, fill="white", stroke_width=stroke, stroke_fill="black")
        x += widths[i] + space
    return img


def render_captions(spec, out, prefix="cap"):
    """Write cap_NN.png per state; return overlay lines "png start end"."""
    size = tuple(spec.get("size", [972, 1728]))
    lines = []
    for n, (t0, t1, words, active) in enumerate(caption_states(spec["lines"], spec.get("shift", 0.0))):
        img = draw_caption(size, words, active, spec.get("center_y", 632), spec.get("font_size", 66), spec.get("stroke"))
        name = f"{prefix}_{n:02d}.png"
        img.save(out / name)
        lines.append(f"{name} {t0:.3f} {t1:.3f}")
    return lines
