# pi-mapper

Browser-based projection mapping for a Raspberry Pi 5 driving a projector.
Chromium runs fullscreen in kiosk mode, [maptastic](https://github.com/austince/maptasticjs)
corner-pins each surface, and `mapd`, a small Go server, stores layouts,
serves media, and sends cues. A phone-friendly control page lets you drag
corners, assign content, and fire cues. Two Pis can run cues together.

```
 phone / laptop ──http──▶ /control ─┐
                                    │ WebSocket
 Chromium kiosk ──http──▶ /  ◀──────┤ (cues, layout edits, reports)
   (HDMI → projector)               │
                                  mapd ──ws──▶ mapd on the other Pi (follower)
                                    │
                         layouts/*.json, media/*
```

## Quick start (on the Mac, no Pi needed)

```sh
make test-clips   # generates media/test.mp4 and media/face-{a,b,c}.mp4 with ffmpeg
make run          # mapd on :8080
open http://localhost:8080/          # projector page
open http://localhost:8080/control   # control page
```

## Put it on a Pi

1. Flash **Raspberry Pi OS 64-bit (Trixie, desktop)**. In Raspberry Pi Imager set a
   hostname (e.g. `pi-a`), user, Wi-Fi, and enable SSH with your key.
2. Connect the projector to **HDMI 0** (the port nearest USB-C power).
3. From the Mac:

   ```sh
   make check PI=pi-a.local    # optional: shows OS, Chromium, compositor, decoders
   make setup PI=pi-a.local    # build, copy, install service + kiosk, autologin, no blanking
   ssh pi-a.local sudo reboot
   ```

4. After boot the projector shows the active layout. Open
   `http://pi-a.local:8080/control` on your phone.

Later code changes: `make deploy PI=pi-a.local`. mapd restarts, and the
projector page reloads itself when it sees the new server.

### Two Pis

```sh
make setup PI=pi-a.local ROLE=leader
make setup PI=pi-b.local ROLE=follower LEADER=pi-a.local
```

Each Pi keeps its own layouts (each projector sees the object from a different
angle). Cues from either control page go to the leader, which picks a start
time `cueDelayMs` (200 ms) ahead and sends it to both Pis. Both pages start at
that wall-clock time. This depends on NTP: `timedatectl` must show
`NTPSynchronized=yes` on both (setup turns NTP on). The follower's control
page shows its measured clock offset against the leader.

## Using it

**Control page** (`/control`):

- **Cues**: Play (all videos seek to 0 and start at the shared time), Pause,
  Next (each video surface steps to its next clip), Black (blackout toggle).
- **Edit mode**: shows maptastic's outlines and handles on the projector.
  Turn the pattern to **corners** to see numbered corners on each surface.
  The numbers match the editor on the phone.
- **Corners**: a scaled copy of the projector's screen. Drag a corner to move
  it, or drag inside a surface to move the whole thing. Use the arrow pad for
  fine moves; the middle button cycles the step size (1, 10, 0.5 px). Changes
  appear live on the projector and save to disk 0.4 s after you stop.
- **Content**: video (multi-select clips for Next), image, canvas sketch, or
  solid color. **Shape** sets the surface's source aspect ratio.
- **Layout**: switch the active layout, Save as, Delete.
- **Status**: CPU temperature, load, connected clients, and per-projector
  fps, dropped frames, and drift.

**On the projector itself** (keyboard and mouse on the Pi): Shift+Space toggles
edit mode, and maptastic's own keys work: drag corners, arrows to nudge,
Shift for 10x, Alt+drag rotates/scales, `s` solo, `c` crosshairs,
`b` bounds, `r` rotate, `h`/`v` flip. Edits made this way save to the server too.

**HTTP**, for scripts: `curl -X POST pi-a.local:8080/api/cue/play`.
Other endpoints: `GET /api/status`, `GET /api/media`,
`GET|PUT|DELETE /api/layouts/{name}`, `GET|PUT /api/active`.

## Media

Put files in `media/`. `make deploy` copies them to the Pi (it never deletes
files on the Pi). Encode with:

```sh
scripts/encode.sh h264     clip.mov   # 1080p30 H.264, no audio, faststart
scripts/encode.sh hevc     clip.mov   # same in HEVC (Pi 5 hardware decoder)
scripts/encode.sh h264-720 clip.mov   # 720p for low-res projectors
scripts/encode.sh all      clip.mov
```

The Pi 5 has no H.264 hardware decoder; 1080p H.264 decodes in software.
Most cheap projectors are 720p native or lower, so 720p clips are worth trying
first when CPU is tight.

## Layout format

`layouts/<name>.json`, see `layouts/example.json`:

```json
{
  "screen": {"w": 1920, "h": 1080},
  "surfaces": [{
    "id": "left", "w": 640, "h": 360,
    "content": {"type": "video", "src": ["face-a.mp4", "test.mp4"], "fit": "cover"},
    "targetPoints": [[x,y] ×4],     // on-screen corners: TL, TR, BR, BL
    "sourcePoints": [[x,y] ×4]      // maptastic's source rect (flips/rotations)
  }]
}
```

Content types: `video` (`src`: file or list), `image` (`src`), `canvas`
(`sketch`: a name from `web/js/sketches.js`), `color` (`color`). Sketches get
server time, so the same sketch runs in step on both Pis. The `sync` sketch
flashes on every whole second, which helps when comparing the two Pis.

## Acceptance tests

| # | Test | How |
|---|------|-----|
| 1 | Boots to the layout with no input | `make setup`, reboot, wait. Nothing but the layout should be visible. |
| 2 | Map from a phone; survives reboot | Control page → Edit on, pattern corners → drag corners onto a box face → wait for "Saved" → reboot. |
| 3 | Three faces, three clips, smooth | `make test-clips && make deploy`, activate `example`, map it to the box. Then `make stats PI=…` records 10 min of temperature, CPU, clock, and throttling to `logs/stats-*.csv` and prints a summary. Check fps and dropped frames in Status. |
| 4 | Two-Pi play | Both Pis on the `sync` sketch or a clip, press Play. Status on the leader shows each projector's drift and the Pi-to-Pi offset. `make drift PI=…` tails `logs/drift.csv`. |

Drift is the video's `currentTime` minus the time since the shared play cue,
sampled every 2 s. v1 does no correction. Each Pi's `loop` restarts on its own,
so drift can grow across loops. If it does, the next step is nudging
`playbackRate` when drift passes a threshold.

## Decisions (made without asking; easy to change)

- **WebSocket library:** `github.com/coder/websocket`, the only dependency.
- **Corner editing from a phone** happens on a scaled editor in the control page,
  not by dragging on the projector page, which isn't reachable from a phone.
  maptastic still does all the warping and keeps its own mouse/keyboard editing.
- **maptastic** 3.3.1 is vendored from npm as `web/js/maptastic.min.js` with
  `autoSave`/`autoLoad` off, so nothing goes to localStorage. Its license is
  next to it.
- **Install location:** the deploy target `~/pi-mapper` is also the install
  directory. Deploy never touches the Pi's `layouts/` (except `example.json`),
  `mapd.json`, or `logs/`.
- **Kiosk autostart:** the user-level `~/.config/labwc/autostart`. labwc runs
  only the first autostart file it finds, so this replaces the system one and
  the panel/desktop never start. To get the desktop back, delete the
  `pi-mapper` block from that file.
- **Chromium profile** lives in `~/.config/pi-mapper-chromium` (separate from
  the desktop user's profile). Crash flags are cleared before each launch so
  no "restore pages" bubble appears, and Chromium restarts if it exits.
- **`mapd` runs as a system service** under the desktop user, so it starts
  before login and doesn't depend on the desktop session.
- **Play always restarts from 0** (per the brief). There is no resume.
- **Layout edits apply to the active layout only.** Use Save as to branch.
- **No authentication.** Anyone on the LAN can control the Pi. Keep it on a
  trusted network.

## Still unverified (check on real hardware)

`make check PI=…` prints most of these.

- Chromium package/binary name on Trixie. Setup tries `chromium`, then
  `chromium-browser`, and the kiosk script uses whichever exists.
- That the compositor is labwc on Wayland and that a user autostart file
  replaces the system one. If the panel still shows, the system file is also
  being run. Check `/etc/xdg/labwc/autostart`.
- `raspi-config nonint do_blanking 1` disabling blanking under labwc.
- Whether Chromium uses the HEVC hardware decoder for `<video>`. Compare
  `face-a.mp4` against `face-a.hevc.mp4` with `make stats` (chromium CPU %),
  and look at `chrome://media-internals` (open it with a keyboard attached:
  Shift+Space, then Ctrl+L). Extra Chromium flags for experiments go in
  `~/pi-mapper/kiosk.flags`, one per line. Restart with `pkill chromium`.

## Layout of this repo

```
cmd/mapd/     Go server: main.go (config), hub.go (WebSocket + cues),
              peer.go (follower→leader link), store.go (layouts), routes.go (HTTP, status)
web/          index.html (projector), control.html, js/ (app, control, link, sketches, patterns, maptastic)
media/        clips (gitignored except test.mp4)
layouts/      saved layouts (gitignored except example.json)
scripts/      setup-pi.sh, kiosk.sh, encode.sh, make-test-clips.sh, record-stats.sh, check-pi.sh
../docs/     project documentation (ofxPiMapper runbook in guides/)
```
