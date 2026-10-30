#!/usr/bin/env bash
# bleep.sh <in> <out> <start> <end> [<start> <end> ...] — mutes each window and lays a 1 kHz tone
# (volume 0.22, amix normalize=0 so the rest of the mix keeps its level) over it. Video is stream-copied.
# The sine source starts at 1/8 amplitude, so 0.22 lands near -34 dBFS: audible, not harsh (the accepted Storebound level).
set -e
. "$(dirname "$0")/_ff.sh"
in="$1"; out="$2"; shift 2
[ $# -ge 2 ] && [ $(( $# % 2 )) -eq 0 ] || { echo "usage: bleep.sh <in> <out> <start> <end> [<start> <end> ...]" >&2; exit 2; }
win=""; while [ $# -ge 2 ]; do win+="${win:++}between(t,$1,$2)"; shift 2; done
"$FF" -v error -y -i "$in" -filter_complex \
  "[0:a]volume=0:enable='$win'[m];sine=frequency=1000:sample_rate=48000,volume=0.22,volume=0:enable='not($win)'[b];[m][b]amix=inputs=2:normalize=0:duration=first[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -movflags +faststart "$out"
"$FP" -v error -show_entries format=duration -of csv=p=0 "$out"
