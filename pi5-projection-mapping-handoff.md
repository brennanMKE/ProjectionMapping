# Handoff: Projection Mapping on Raspberry Pi 5

## Goal

Get projection mapping working on two Raspberry Pi 5s, each driving its own low-cost projector, for experiments with physical projects (boxes, wall corners, objects at the makerspace). First get one Pi mapping video onto a simple object. Then sync both Pis. Later, explore generative and music-reactive content.

The work happens in two tracks:

- **Track A (primary):** A browser-based mapper. Chromium runs in kiosk mode on the Pi, maptastic.js handles corner-pin warping, and a small Go server stores layouts and sends cues.
- **Track B (exploratory):** Build ofxPiMapper from source on a Pi 5 with 64-bit openFrameworks.

Do Track A first. Track B is a time-boxed experiment on the second Pi.

## Background and constraints (verified)

- **PocketVJ is not an option.** Its repo (github.com/magdesign/PocketVJ-CP-v3) supports only the Pi 2 and Pi 3 on Raspbian Jessie. The last commit was in 2018, and it depends on 32-bit armhf packages. Don't try to port it.
- **The ofxPiMapper prebuilt image works only up to the Pi 3B+.** The README says Pi 4/5 support is still being worked on. The addon itself is plain openFrameworks C++ (github.com/kr15h/ofxPiMapper).
- **openFrameworks supports the Pi 5** on Raspberry Pi OS 64-bit (Trixie), using the `linuxaarch64` package. The install guide is at openframeworks.cc/setup/raspberrypi/raspberry-pi-getting-started/. Known issue: on Trixie, `install_dependencies.sh` asks for `libgconf-2-4`, which was removed. Delete it from the script's apt-get line (oF issue #8480).
- **The Pi 5 has no hardware H.264 decode.** HEVC is hardware-decoded. 1080p H.264 decodes in software and should be fine, but measure it.
- **Splash** (splashmapper.xyz) runs on the Pi 5 "for testing purposes" only. It's out of scope here but noted for multi-projector blending later.

## Things to verify before relying on them (unverified)

- The Chromium package and binary name on Raspberry Pi OS Trixie (`chromium` vs `chromium-browser`).
- The desktop compositor on current Pi OS (expected: labwc on Wayland) and where kiosk autostart goes (expected: `~/.config/labwc/autostart`).
- Whether Chromium on the Pi 5 uses hardware HEVC decode for `<video>`. If it doesn't, use H.264 or VP9 at 1080p and check CPU load.
- maptastic.js's current API and key bindings. Read the README in github.com/austince/maptasticjs (the maintained fork, also on npm as `maptastic`). Confirm how edit mode is toggled and whether it persists to localStorage by default.

## Track A: Browser mapper

### Architecture

Each Pi runs:

1. **`mapd`**, a small Go server (single binary) that:
   - serves the static mapping page and the media files
   - stores layouts as JSON on disk (`layouts/<name>.json`)
   - exposes a WebSocket for cues and layout updates
   - serves a control page at `/control` that works from a phone or laptop
2. **Chromium in kiosk mode** pointed at `http://localhost:8080/`, fullscreen on the HDMI output that feeds the projector.

### Mapping page (`/`)

- Fullscreen black background, no cursor except in edit mode.
- Each surface is a DOM element, warped by maptastic. Supported surface content:
  - `video`: looping, muted, autoplay, from `/media/`
  - `image`
  - `canvas`: a generative JS sketch (start with a simple test pattern and a color cycle)
  - `color`: a solid fill, for masking and testing
- Pass the layout to maptastic via its `onchange` handler. Save the layout to the server (debounced), not just to localStorage, so it survives browser profile resets and can be edited remotely.
- Load the active layout from the server on startup.
- Built-in test patterns: grid, crosshair, and corner numbers per surface, for alignment.

### Control page (`/control`)

- Toggle edit mode on the projector page.
- Add or remove surfaces and assign content per surface.
- Pick the active layout, and save as a new layout.
- Send cues: play, pause, next clip, blackout.
- Show the Pi's status: CPU temperature, load, and the current layout.
- Plain HTML/JS, no framework needed. Must work on a phone browser.

### Two-Pi sync

- Either Pi can be configured as the leader (config flag). The follower connects to the leader's WebSocket.
- Cues from the control page go to the leader, which forwards them to the follower with a target timestamp a short delay ahead (for example 200 ms). Both pages run the cue at that time.
- Video sync: on `play`, both seek to 0 and start at the shared timestamp. Don't aim for frame-accurate sync in v1. Log measured drift.
- Use NTP time on both Pis (check `timedatectl` shows sync on).

### Pi setup script (`scripts/setup-pi.sh`)

- Assumes a fresh Raspberry Pi OS 64-bit (Trixie, desktop) image.
- Installs Chromium if needed and copies the `mapd` binary and media folder.
- Creates a systemd user or system service for `mapd`.
- Configures Chromium kiosk autostart with flags for kiosk mode, no first-run prompts, no "restore session" bubble, and autoplay without a user gesture.
- Disables screen blanking.
- Idempotent: running it twice must be safe.

Cross-compile `mapd` on the Mac (`GOOS=linux GOARCH=arm64`) and deploy with `rsync` over SSH. Provide a `make deploy PI=<host>` target.

### Repo layout

```
pi-mapper/
  cmd/mapd/          Go server
  web/
    index.html       mapping page
    control.html     control page
    js/              maptastic (vendored), app code, sketches
  media/             sample clips (gitignored except a tiny test clip)
  layouts/           saved layouts (gitignored except example.json)
  scripts/
    setup-pi.sh
    encode.sh        ffmpeg presets for Pi playback
  Makefile
  README.md
```

### `scripts/encode.sh`

ffmpeg presets that turn source clips into Pi-friendly files:

- `h264`: 1920x1080 max, 30fps, yuv420p, no audio, `+faststart`
- `hevc`: same constraints, for testing hardware decode
- A small 720p variant for low-end projectors (most cheap projectors are 720p native or lower even when they accept 1080p)

### Track A acceptance criteria

1. On boot, the Pi shows the active layout fullscreen with no desktop visible and no human input.
2. From a phone, I can enter edit mode, drag the four corners of a surface onto a box face, and save. After a reboot, the layout is unchanged.
3. Three surfaces mapped onto three faces of a box, each playing a different looping clip, at a smooth framerate. Record CPU load and temperature while it runs for 10 minutes.
4. With both Pis running, one `play` cue starts video on both within a visibly acceptable offset. Log the measured drift.

## Track B: ofxPiMapper on the Pi 5 (time-boxed)

Goal: find out whether ofxPiMapper builds and runs usefully on a Pi 5 with current openFrameworks. Stop after a reasonable effort and write down what failed.

Steps:

1. Fresh Raspberry Pi OS 64-bit (Trixie) card.
2. Install openFrameworks for `linuxaarch64` following the official Pi guide. Apply the `libgconf-2-4` workaround.
3. Build and run an oF example (for example `examples/graphics/polygonExample`) to confirm GL works.
4. Clone `kr15h/ofxPiMapper` into `openFrameworks/addons/`. Build `example_basic`.
5. Expected trouble spots: legacy Pi-specific code paths (OMX player, `TARGET_RASPBERRY_PI` ifdefs written for the old Broadcom GL stack), and the addon having been tested against oF 0.11.0. Prefer the standard Linux desktop code path (oF's GStreamer video player) over the old Pi-specific one.
6. If it runs, test: a quad surface with a video source, a grid warp surface, and an FBO source.

Deliverable for Track B: `docs/ofxpimapper-pi5.md` with the exact commands, any patches (as a diff or a fork branch), and an assessment of video performance compared to Track A.

## Out of scope for now

- Edge blending across the two projectors (look at Splash later)
- Mesh or bezier warping in the browser mapper (v2 idea: replace maptastic with a WebGL grid warp)
- Music-reactive content or hooks into the LED projects (v2: add an OSC or WebSocket input that sketches can subscribe to)
- Audio playback

## Notes for Claude Code

- Ask before choosing anything that's hard to undo. Otherwise make reasonable calls and note them in the README.
- Keep dependencies minimal: Go standard library plus a WebSocket package; vendored maptastic; no frontend build step.
- Don't put any organization names or branding in the UI or docs.
