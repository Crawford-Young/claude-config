---
name: clip-edit
description: CarsickYak stream clips — cut, crossfade, karaoke-caption, bleep, caption-mask and safe-zone-check vertical (9x16) clips from Twitch/VOD exports with ffmpeg + faster-whisper. Video mechanics only; caption and title wording goes through yak-voice.
disable-model-invocation: true
---

# clip-edit — vertical stream clip mechanics

Built from the 8 Storebound clips (2026-10). Wording (captions, titles, posts) is `yak-voice`'s job; this skill is the pixels and audio.

Base directory: `~/code/claude-config/skills/clip-edit/` — `scripts/` (run in place), `examples/` (real Storebound specs, copy and edit).

## Environment traps (each one bit a session)

- **Git-bash mangles ffmpeg args** (`-vf` expressions, `C:` paths): `export MSYS2_ARG_CONV_EXCL="*"` (the `.sh` scripts set it) and pass every path, the script path included, as `C:/forward/slashes`. Under that export `/c/...` is not converted and fails as `C:\c\...`. Backslashes break too.
- **ffmpeg** is not on PATH: `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_*\ffmpeg-9.0.2-full_build\bin`. The scripts find it themselves (`$FFMPEG_BIN` overrides). For ad-hoc calls: `. scripts/_ff.sh` gives `$FF` / `$FP`.
- **No system Python.** Run every script through uv, isolated (`-I`, plus `-B` so no `__pycache__` lands in the skill), never from inside the download folder:
  - Pillow/numpy scripts: `uv run --no-project --with pillow --with numpy python -B -I C:/.../scripts/<x>.py ...`
  - Whisper (`transcribe.py`, `words.py`): `uv run --no-project --python 3.12 --with faster-whisper python -B -I ...` (faster-whisper has no wheels past 3.12). The first run downloads `small.en`.
- **Whisper mishears** names, slang and swears. The user's own lines win. Use Whisper for timing, not for wording.
- **Twitch portrait exports often have captions baked in.** Censoring a word then needs BOTH `bleep.sh` (audio) AND `mask.py` (the baked caption word). Doing only one leaves the word in.

## Scripts

| Script | Does |
|---|---|
| `transcribe.py <media>... [--start --end --out]` | Segment transcript on the source timeline |
| `words.py <media>... [--start --end]` | Loudness dB per 0.5 s (dead air, spikes) + word timestamps |
| `cut.sh <in> <out> s:e [s:e...]` | Hard joins with 20 ms audio fades |
| `xfade.py <out> <in0> [in1..] -- idx:s:e:fade ...` | Crossfaded rebuild across one or more inputs |
| `findcuts.py <orig> <trim>` | Recovers which original ranges an already-cut clip kept |
| `captions.py <spec> <dir>` | Karaoke PNG states + `overlays.txt` (spec: `examples/captions_storebound.json`) |
| `burn.sh <in> <dir> <out>` | Overlays everything in `<dir>/overlays.txt` |
| `bleep.sh <in> <out> s e [s e...]` | Mutes each window + 1 kHz tone (0.22, `amix normalize=0`) |
| `capswitch.py <src> t0 t1 [--crop W:H:X:Y]` | Frame times + x-extents where a baked caption changes |
| `mask.py <spec> <dir>` | `****` boxes over baked words, purple/black per highlight state |
| `call_screen.py <pfp> <dir> <spec>` | Discord-style call screen, 610x1080, ring + captions |
| `still.py <img> <out> --crop x0,y0,x1,y1 [--size WxH]` | Crops a screenshot into a full-frame overlay |
| `sheet.py <src> <out.png> [--times ...]` | Contact sheet with TikTok safe-zone guides |

Caption house style (in `common.py`): Arial Bold 66 on 972x1728, white with a 6 px black stroke, purple `#7C4DF7` box behind the active word. The whole line stays visible and the highlight walks word by word. Centre y=632 sits on the face-cam/gameplay seam. Stroke and padding scale with `font_size` (41 for the 610-wide intro halves).

## Pipeline

1. **Transcribe.** `transcribe.py` for the whole clip, then `words.py` on the part you're keeping, to get word times and dead air (loudness well below the clip's speaking level for 1 s or more).
2. **Pick ranges with the user.** Propose `start:end` ranges with the transcript lines they contain. The user decides what's funny.
3. **Cut.** Use `xfade.py` (0.2–0.3 s fades) when a hard cut would jump. Use `cut.sh` for quick trims. Re-run `words.py` on the cut, because every later time is on the cut timeline.
4. **Captions.** Get the wording from the user or `yak-voice`, and timing from `words.py`. Write a spec, run `captions.py`, then `burn.sh`. When the export already has baked captions, skip this step and keep theirs.
5. **Censor.** `bleep.sh` over the word's window, padded about 0.05 s each side. If the captions are baked, `capswitch.py` across the window gives the frame-exact switch times and the word's x-range. Then `mask.py` (purple while the word is highlighted, black otherwise), then `burn.sh`.
6. **Upscale** for posting if the export is below 1080x1920: `$FF -i in.mp4 -vf scale=1080:1920:flags=lanczos -c:v libx264 -crf 18 -preset slow -c:a copy out.mp4`.
7. **Sheet check.** `sheet.py` on the final file and Read the PNG. Check that the captions sit clear of the red safe zones and that no frame is black at the joins.
8. **User playback QA** before calling a clip done. Frames can't show audio pops, bleep timing or crossfade feel. Hand over the file path and the timestamps worth checking.

Work in a scratch or output folder, never in `%TEMP%` long-term (Storage Sense wipes it). Finished clips go to the user's folder (e.g. `Downloads/<game>_post/`).

## VOD triage (next capability, not built)

Goal: from a full VOD, rank candidate moments so the user reviews 10 picks, not 4 hours. Planned signals, combined into a ranked `start-end — why` list:

- **Loudness spikes:** `words.py`-style RMS over the whole VOD (use `--start/--end` chunks), flagging jumps well above the rolling median.
- **Laughter:** transcript tokens like `haha`, `[laughter]`, and runs of short loud segments.
- **Transcript keywords:** swears, "no way", "clip that", teammate names, death and win callouts.
- **Twitch chat-rate spikes:** messages per 10 s from the VOD chat replay (e.g. TwitchDownloader chat JSON). Spikes of LUL/KEKW/emote spam lag the moment by about 5–10 s.
- **Existing viewer clips** on the channel: proven moments, already timestamped.

Output feeds Pipeline step 2. Build it when the user brings the next VOD.
