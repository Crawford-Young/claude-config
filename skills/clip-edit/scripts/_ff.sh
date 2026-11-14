# _ff.sh — sourced by the .sh scripts: sets FF/FP and stops Git-bash from mangling ffmpeg args.
# Pass Windows paths to the scripts as C:/forward/slashes, never /c/... or backslashes.
export MSYS2_ARG_CONV_EXCL="*"
if [ -n "$FFMPEG_BIN" ]; then B="$FFMPEG_BIN"
elif command -v ffmpeg >/dev/null 2>&1; then B="$(dirname "$(command -v ffmpeg)")"
else B="$(ls -d "$(cygpath -u "$LOCALAPPDATA")"/Microsoft/WinGet/Packages/Gyan.FFmpeg_*/ffmpeg-*/bin 2>/dev/null | tail -1)"
fi
[ -n "$B" ] || { echo "ffmpeg not found: set FFMPEG_BIN or winget install Gyan.FFmpeg" >&2; exit 1; }
FF="$B/ffmpeg"; FP="$B/ffprobe"
