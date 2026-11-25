#!/usr/bin/env bash
# Generate test clips with ffmpeg's built-in sources (no source footage needed).
#   media/test.mp4          tiny 640x360 clip, committed to the repo
#   media/face-{a,b,c}.mp4  three different 1080p clips for the three-face box test
#   media/face-a.hevc.mp4   HEVC version of face-a for the hardware decode test
set -euo pipefail
cd "$(dirname "$0")/../media"

ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
h264=(-an -c:v libx264 -profile:v high -pix_fmt yuv420p -g 60 -movflags +faststart)

ff -f lavfi -i "testsrc2=size=640x360:rate=30:duration=6" "${h264[@]}" -crf 32 test.mp4
ff -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=20" "${h264[@]}" -crf 22 face-a.mp4
ff -f lavfi -i "smptehdbars=size=1920x1080:rate=30:duration=20,hue=H=2*PI*t/20" "${h264[@]}" -crf 22 face-b.mp4
ff -f lavfi -i "mandelbrot=size=1920x1080:rate=30,trim=duration=20" "${h264[@]}" -crf 22 face-c.mp4
ff -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=20" -an -c:v libx265 -tag:v hvc1 -pix_fmt yuv420p \
   -x265-params "keyint=60:log-level=error" -crf 24 -movflags +faststart face-a.hevc.mp4
ls -lh test.mp4 face-*.mp4
