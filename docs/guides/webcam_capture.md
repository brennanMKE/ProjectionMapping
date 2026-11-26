# Capturing the wall with a webcam, and closing the loop

A webcam on the Mac, aimed at the corner from roughly where a viewer stands,
lets you (or an AI agent working for you) see what the projector actually puts
on the wall. It was used throughout this project:

- **Calibration:** structured-light patterns are projected and photographed to
  map projector pixels to camera pixels, and to find the three surfaces.
- **Checking scenes:** a snapshot of every scene after each change, often
  combined into a contact sheet, with no need to stand in the room.
- **Before and after shots** for the docs (see [`../images/`](../images/)).

## Close the loop for the AI agent

This project was built with Claude Code, and the single most useful thing was
giving it **feedback it can fetch on its own**. Without it, the agent writes a
shader, deploys it, and has to ask "does it look right?" every time, so each
fix costs a round trip through a person. With it, the agent can loop by
itself, changing, deploying, looking and changing again, until the result is
actually right, and only then hand it back.

The loop, and the tool that closes each step:

| Step | Feedback the agent fetches itself |
| --- | --- |
| Did it compile, and does the layout look right? | The WebGL preview renders the viewer's view on the Mac ([`pi-mapper/tools/preview/`](../../pi-mapper/tools/preview/)) |
| What's really on the wall? | A CamSnap photo of the corner |
| Is it fast enough? | skyd's frame-rate lines in the Pi's log (`journalctl -u projd \| grep fps`) |
| Did the control work? | projd's `/api/state` and `/api/status` |

Problems this caught without anyone pointing them out:

- **Scenes that drew nothing on the Pi.** Bouncing balls and the gravity
  carousel looked right in the preview but were blank on the wall. The photo
  showed it, and testing variants pinned it on a GPU compiler limit.
- **Frame rates** of 6–8 fps in the first physics scenes, which led to moving
  the physics onto the CPU.
- **A video playing in slow motion**, found by timing a short clip from start to end.
- **Calibration accuracy**, by photographing the markers against the real seams.

How to set it up so the agent can use it freely:

- **Make each check a single command** that returns an image or a number:
  `curl` for a photo, one `ssh ... journalctl` for frame rates. The agent can
  then call it after every change.
- **Allow those commands** in Claude Code's permission settings (`curl` to
  `127.0.0.1:8999`, `ssh` to the Pi), so the loop doesn't stop to ask each time.
- **Fix the camera at the viewer's spot** so every photo is comparable.

What it can't replace is a person watching in the room. Taste ("this is a bit
boring"), how the motion feels, and whether the illusion holds from the sweet
spot came from viewing notes, and those notes drove the biggest improvements
(see the [scene design lessons](scene_design_lessons.md)). The automatic loop
makes sure that when a person looks, the scene already works.

**Share the projector politely.** The agent's checks switch scenes and restart
the renderer. Have it say when it's taking the projector, avoid stopping the
renderer while someone is watching or recording, and put back what was
playing when it's done.

## Why it needs an app: CamSnap

On macOS, a process only gets the camera if the app that launched it declares
`NSCameraUsageDescription` and the person allows it. Terminal tools (`ffmpeg`,
scripts, an agent's shell) inherit the terminal's identity, which usually has
no camera entitlement, so the capture silently fails or is denied.

[CamSnap](../../pi-mapper/tools/camsnap/) solves this with a tiny background
app that has its own bundle ID and usage string. macOS asks once for CamSnap
itself, and everything else asks CamSnap for frames over HTTP on `127.0.0.1`.

- `CamSnap.swift`: about 350 lines of Swift (AVFoundation capture, a minimal
  HTTP server). The capture session stays open between requests, so a snapshot
  is a fresh frame without the ~0.8 s auto-exposure warm-up each time.
- `build.sh`: builds `CamSnap.app` with `swiftc` and an ad-hoc signature. No Xcode project.
- `camsnap`: a wrapper that starts the app if needed, waits for the permission
  prompt on first run, and writes a JPEG.

## Setup

```sh
cd pi-mapper/tools/camsnap
./build.sh
./camsnap test.jpg Logitech      # first run: allow camera access when macOS asks
```

Then grab frames from anything:

```sh
curl -s "http://127.0.0.1:8999/snap.jpg?camera=Logitech" -o wall.jpg
curl -s http://127.0.0.1:8999/cameras         # list cameras
```

The full API and troubleshooting (including resetting the permission) are in
the [tool's README](../../pi-mapper/tools/camsnap/README.md).

## Placing the camera

- Put it **where the viewer will stand**, on the line out from the corner,
  about 2.5 m back here. The viewer-correct scenes are drawn for that point.
- **Fix it in place.** Calibration from structured light is only valid for that
  exact camera position; if the camera moves, recalibrate.
- The room should be dark for calibration and for judging scenes.

## Structured-light calibration

Scripts in [`pi-mapper/corner/structured-light/`](../../pi-mapper/corner/structured-light/):

1. `genpat.py` makes Gray-code stripe patterns in both directions.
2. `capture.sh` has projd show each pattern on the projector and photographs it through CamSnap.
3. `viewmap.py` decodes the photos into a projector-pixel → camera-pixel map.
4. `planefit.py` fits a homography per surface (ceiling, left, right) with
   RANSAC, which removes decoding noise, and writes the mesh skyd renders with.
5. `rect.py` finds the rectangle of the camera image the projection covers.
6. `camsolve.py` solves the camera's position and orientation in room
   coordinates (DLT), which is the viewer position the scenes are drawn for.

The four-dot calibration in the web UI's Corner tab is the quicker alternative
and needs no camera. The webcam is still handy to check the result.

## Checking scenes

Snapshot each scene after switching to it, then tile them with ffmpeg:

```sh
for s in scan water vortex; do
  curl -s -X POST -d "{\"clip\":\"$s\"}" http://mizar.local:8080/api/scene >/dev/null
  sleep 8   # past the fade, into the scene
  curl -s "http://127.0.0.1:8999/snap.jpg?camera=Logitech" -o "$s.jpg"
done
ffmpeg -i scan.jpg -i water.jpg -i vortex.jpg -filter_complex hstack=3 sheet.jpg
```

A snapshot shows layout and visibility. It doesn't show frame rate (read
that from the Pi's log) or how the motion feels, which still needs a person
watching in the room.
