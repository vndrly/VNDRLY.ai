#!/usr/bin/env bash
# Mux the British female voiceover into an exported (silent) MP4.
#
# Usage:
#   bash artifacts/vndrly-commercial/scripts/mux-voiceover.sh <input.mp4> [output.mp4]
#
# Default output is <input>-with-audio.mp4 next to the input file.
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <input.mp4> [output.mp4]" >&2
  exit 1
fi

INPUT="$1"
OUTPUT="${2:-${INPUT%.mp4}-with-audio.mp4}"
AUDIO="$(cd "$(dirname "$0")/../../.." && pwd)/attached_assets/vndrly-voiceover.mp3"

if [ ! -f "$INPUT" ]; then echo "Input video not found: $INPUT" >&2; exit 1; fi
if [ ! -f "$AUDIO" ]; then echo "Voiceover not found: $AUDIO" >&2; exit 1; fi

ffmpeg -y -i "$INPUT" -i "$AUDIO" \
  -map 0:v:0 -map 1:a:0 \
  -c:v copy -c:a aac -b:a 192k \
  -shortest "$OUTPUT"

echo "Wrote: $OUTPUT"
