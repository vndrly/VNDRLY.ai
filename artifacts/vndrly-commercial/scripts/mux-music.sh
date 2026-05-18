#!/usr/bin/env bash
# Mux the Mixkit corporate background music into an exported (silent) MP4.
#
# Usage:
#   bash artifacts/vndrly-commercial/scripts/mux-music.sh <input.mp4> [output.mp4]
#
# Default output is <input>-with-music.mp4 next to the input file.
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <input.mp4> [output.mp4]" >&2
  exit 1
fi

INPUT="$1"
OUTPUT="${2:-${INPUT%.mp4}-with-music.mp4}"
MUSIC="$(cd "$(dirname "$0")/.." && pwd)/public/audio/background-music.mp3"

if [ ! -f "$INPUT" ]; then echo "Input video not found: $INPUT" >&2; exit 1; fi
if [ ! -f "$MUSIC" ]; then echo "Music not found: $MUSIC" >&2; exit 1; fi

ffmpeg -y -i "$INPUT" -i "$MUSIC" \
  -map 0:v:0 -map 1:a:0 \
  -c:v copy -c:a aac -b:a 192k \
  -filter:a "volume=0.55" \
  -shortest "$OUTPUT"

echo "Wrote: $OUTPUT"
