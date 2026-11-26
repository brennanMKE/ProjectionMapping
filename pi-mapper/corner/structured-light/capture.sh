#!/usr/bin/env bash
# Capture Gray-code structured light with the webcam (CamSnap) and build the
# projector->camera map used by `cornergen -view`.
#
#   corner/structured-light/capture.sh <work-dir> [projd-url]
#
# Needs: CamSnap running (tools/camsnap), projd on the Pi, ffmpeg, python3.
# Patterns play as short videos: mpv on the Pi Zero doesn't refresh the
# screen when one still image replaces another.
set -euo pipefail
W="${1:?usage: capture.sh <work-dir> [projd-url]}"; P="${2:-http://mizar.local:8080}"
HOST="${P#http://}"; HOST="${HOST%%:*}"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$W/pat" "$W/cap"
python3 -I "$HERE/genpat.py" "$W/pat"
for f in "$W"/pat/*.ppm; do
  ffmpeg -v error -y -loop 1 -i "$f" -t 2 -r 10 -c:v libx264 -preset veryfast -tune stillimage \
    -pix_fmt yuv420p -crf 12 -g 10 "${f%.ppm}.mp4" && rm "$f"
done
rsync -az "$W"/pat/*.mp4 "pi@$HOST:media/"
for f in "$W"/pat/sl-*.mp4; do
  n=$(basename "${f%.mp4}")
  curl -s -m5 -X POST -d "{\"clip\":\"media/$n.mp4\"}" "$P/api/play" -o /dev/null
  sleep 3   # player + projector latency
  curl -s -m8 "http://127.0.0.1:8999/snap.jpg?camera=Logitech" -o "$W/cap/$n.jpg"
done
ssh "pi@$HOST" 'rm -f ~/media/sl-*'
for f in "$W"/cap/*.jpg; do ffmpeg -v error -y -i "$f" -vf format=gray -f rawvideo "${f%.jpg}.gray"; done
python3 -I "$HERE/viewmap.py" "$W/cap" "$W"
python3 -I "$HERE/rect.py" "$W"
echo "map ready: go run ./cmd/cornergen -config corner/corner.json -view $W -out media/view"
