#!/usr/bin/env bash
# burn.sh <input.mp4> <overlay_dir> <output.mp4> — overlays every PNG listed in <overlay_dir>/overlays.txt
# ("png start end", one per line, full-frame transparent PNGs from captions.py / mask.py / call_screen.py).
set -e
. "$(dirname "$0")/_ff.sh"
in="$1"; caps="$2"; out="$3"
args=(); fc=""; prev="0:v"; i=1
while read -r png s e; do
  [ -z "$png" ] && continue
  args+=(-i "$caps/$png"); fc+="[$prev][$i:v]overlay=0:0:enable='between(t,$s,$e)'[v$i];"; prev="v$i"; i=$((i+1))
done < "$(cygpath -u "$caps")/overlays.txt"
"$FF" -v error -y -i "$in" "${args[@]}" -filter_complex "${fc%;}" -map "[$prev]" -map 0:a \
  -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -r 60 -c:a copy -movflags +faststart "$out"
"$FP" -v error -show_entries format=duration -of csv=p=0 "$out"
