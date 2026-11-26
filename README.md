# ProjectionMapping

Experiments with projection mapping on Raspberry Pis, each driving a low-cost
projector over HDMI: video and images warped onto boxes, wall corners and other
objects, adjusted from a phone or laptop.

## What's here

| Path | What it is |
| --- | --- |
| [`pi-mapper/`](pi-mapper/) | Browser-based mapper for the Raspberry Pi 5: a Go server (`mapd`), a fullscreen Chromium projector page warped with maptastic.js, and a phone-friendly control page. Supports two Pis with synced cues. See its [README](pi-mapper/README.md). |
| [`pi-mapper/headless/`](pi-mapper/headless/) | Browser-free approach: mpv plays straight to HDMI from Raspberry Pi OS Lite, and `cornerpin.py` warps the picture onto four corners. |
| [`pi-mapper/corner/`](pi-mapper/corner/) | Test videos for a wall-wall-ceiling corner, rendered in 3D for the projector's measured position by `cmd/cornergen`. |
| [`pi-mapper/docs/pi-zero-headless-guide.md`](pi-mapper/docs/pi-zero-headless-guide.md) | Step-by-step test guide for the headless approach on a Pi Zero 2 W. |
| [`pi-mapper/docs/ofxpimapper-pi5.md`](pi-mapper/docs/ofxpimapper-pi5.md) | Runbook for trying ofxPiMapper (openFrameworks) on a Pi 5. |
| [`pi5-projection-mapping-handoff.md`](pi5-projection-mapping-handoff.md) | The original brief: goals, constraints and options. |

## Status

- **Headless (Pi Zero 2 W, no browser):** the direction being pursued. The warp
  math is tested; playback and the shader still need a run on real hardware.
- **Browser mapper (Pi 5):** built and tested on macOS; not yet run on a Pi.
- **ofxPiMapper:** not started.

## Requirements

- Raspberry Pi Zero 2 W or Pi 5, a projector, and a microSD card
- On the Mac: Go 1.23+, ffmpeg, and Raspberry Pi Imager

## License

MIT. See [LICENSE](LICENSE).
