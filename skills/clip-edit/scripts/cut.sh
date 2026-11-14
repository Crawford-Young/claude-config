#!/usr/bin/env bash
# cut.sh <input> <output> <start:end> [<start:end> ...] — keeps the listed ranges, hard-joined in order
# (20 ms audio fades at each joint). For crossfaded joins use xfade.py.
set -e
. "$(dirname "$0")/_ff.sh"
in="$1"; out="$2"; shift 2
fc=""; cat=""; i=0
for r in "$@"; do
  s="${r%%:*}"; e="${r##*:}"
  fc+="[0:v]trim=start=$s:end=$e,setpts=PTS-STARTPTS[v$i];[0:a]atrim=start=$s:end=$e,asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st=$(awk "BEGIN{print $e-$s-0.02}"):d=0.02[a$i];"
  cat+="[v$i][a$i]"; i=$((i+1))
done
fc+="${cat}concat=n=$i:v=1:a=1[v][a]"
"$FF" -v error -y -i "$in" -filter_complex "$fc" -map "[v]" -map "[a]" \
  -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -r 60 -c:a aac -b:a 192k -movflags +faststart "$out"
"$FP" -v error -show_entries format=duration -of csv=p=0 "$out"
