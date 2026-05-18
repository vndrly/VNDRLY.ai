#!/usr/bin/env bash
# Bake the final commercial audio (voiceover + ducked background music)
# into a silent exported MP4.
#
# - Music ducks to 0.22 while VO is playing, swells to 0.55 after VO ends.
# - Output is the same length as the input video (-shortest on video stream).
#
# Usage:
#   bash artifacts/vndrly-commercial/scripts/mux-final.sh <input.mp4> [output.mp4]
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <input.mp4> [output.mp4]" >&2
  exit 1
fi

INPUT="$1"
OUTPUT="${2:-${INPUT%.mp4}-final.mp4}"
PUBDIR="$(cd "$(dirname "$0")/.." && pwd)/public/audio"
MUSIC="$PUBDIR/background-music.mp3"
VO="$PUBDIR/voiceover.mp3"

for f in "$INPUT" "$MUSIC" "$VO"; do
  if [ ! -f "$f" ]; then echo "Missing: $f" >&2; exit 1; fi
done

# Sidechain compress music against VO so music ducks under speech automatically.
# Falls back gracefully even if VO is shorter than music/video.
ffmpeg -y -i "$INPUT" -i "$MUSIC" -i "$VO" \
  -filter_complex "
    [1:a]volume=0.55[music];
    [2:a]volume=1.0,asplit=2[vo1][vo2];
    [music][vo1]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=600[ducked];
    [ducked][vo2]amix=inputs=2:duration=first:dropout_transition=0,alimiter=limit=0.95[outa]
  " \
  -map 0:v:0 -map "[outa]" \
  -c:v copy -c:a aac -b:a 192k \
  -shortest "$OUTPUT"

echo "Wrote: $OUTPUT"
