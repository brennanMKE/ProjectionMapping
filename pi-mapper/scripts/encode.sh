#!/usr/bin/env bash
# Turn source clips into Pi-friendly files.
#
#   scripts/encode.sh <preset> <input> [output]
#
# Presets:
#   h264      1920x1080 max, 30 fps, yuv420p, no audio, +faststart (software decode on the Pi 5)
#   hevc      same constraints in HEVC (the Pi 5 has a hardware HEVC decoder)
#   h264-720  1280x720 max H.264, for cheap projectors that are 720p native or lower
#   all       all three
#
# Output defaults to media/<name>.<preset>.mp4. Keyframes every 2 s keep seeks
# to 0 (used by sync play cues) fast.

set -euo pipefail

usage() { sed -n '2,13p' "$0"; exit 1; }
[[ $# -ge 2 ]] || usage
PRESET="$1"; IN="$2"; OUT="${3:-}"
[[ -f "$IN" ]] || { echo "no such file: $IN" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="$(basename "${IN%.*}")"

# scale down only, keep aspect, force even dimensions
scale() { echo "scale='min($1,iw)':'min($2,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30,format=yuv420p"; }

encode() {
  local preset="$1" out="$2"
  local common=(-hide_banner -y -i "$IN" -an -movflags +faststart -g 60 -keyint_min 60)
  case "$preset" in
    h264)
      ffmpeg "${common[@]}" -vf "$(scale 1920 1080)" -c:v libx264 -profile:v high -level 4.1 -preset slow -crf 20 "$out" ;;
    h264-720)
      ffmpeg "${common[@]}" -vf "$(scale 1280 720)" -c:v libx264 -profile:v high -level 4.0 -preset slow -crf 21 "$out" ;;
    hevc)
      ffmpeg "${common[@]}" -vf "$(scale 1920 1080)" -c:v libx265 -profile:v main -preset medium -crf 23 -tag:v hvc1 \
        -x265-params "keyint=60:min-keyint=60:log-level=error" "$out" ;;
    *) usage ;;
  esac
  echo "wrote $out ($(du -h "$out" | cut -f1))"
}

if [[ "$PRESET" == "all" ]]; then
  [[ -z "$OUT" ]] || { echo "output path not allowed with 'all'" >&2; exit 1; }
  for p in h264 hevc h264-720; do encode "$p" "$ROOT/media/$BASE.$p.mp4"; done
else
  encode "$PRESET" "${OUT:-$ROOT/media/$BASE.$PRESET.mp4}"
fi
