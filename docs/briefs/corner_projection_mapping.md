# Corner Projection Mapping: Build Spec

Handoff doc for Claude Code. Build a tool that maps generated content onto a room corner where two walls meet the ceiling, runs live on a Raspberry Pi 5, and can bake the same show to video for Pi Zero players.

## 1. Goal

A trihedral corner (three planes meeting at one vertex) is projected on by a single projector aimed at the vertex. The software must:

1. Calibrate the three faces quickly with a keyboard-driven 7-point tool.
2. Render two kinds of content:
   - **Surface scenes**: content designed per face that plays with the seams and the vertex. Viewable from anywhere.
   - **Anamorphic scenes**: a 3D scene rendered from one viewer position and re-projected onto the corner so the corner disappears (convex cube, tunnel, floating object).
3. Sequence scenes into a show timed to an audio track.
4. Output either live to HDMI (Pi 5) or to an H.264 file with mapping baked in (Pi Zero playback).

## 2. Hardware and constraints

- **Projectors**: Android mini projectors (XBJ, HY300-style). Assume native 1280x720, low brightness, weak black level. Output resolution is 1280x720 by default, configurable.
- **Live renderer**: Raspberry Pi 5, Raspberry Pi OS (Bookworm, 64-bit), OpenGL ES 3.1 via Mesa V3D.
- **Playback-only nodes**: Pi Zero (assume Pi Zero 2 W). These do not render; they play baked H.264 files at 1280x720, 30 fps, with `mpv` fullscreen in a loop.
- **Development**: macOS (Apple Silicon). Everything must run windowed on the Mac for authoring and calibration preview.

## 3. Tech stack

- Python 3.11+
- `moderngl` + `moderngl-window` for rendering (GLES 3.1 compatible shaders only: `#version 310 es` path on Pi, `#version 330` path on desktop, generated from one source with a small preamble swap)
- `numpy` for geometry, `opencv-python-headless` for homography (`cv2.getPerspectiveTransform`) only
- `PyYAML` for config
- `ffmpeg` (system binary) for baking, piped raw RGB frames from the renderer
- `librosa` optional, only in the offline beat-analysis command
- Manage deps with `uv`. Pin versions in `pyproject.toml`.

Keep the dependency list short. No web UI.

## 4. Geometry model

### 4.1 Projector space (calibration)

Seven points in projector pixel coordinates define the three faces:

```
          C_LR (ceiling far corner)
         /          \
   E_L  /  CEILING   \  E_R        E_L, E_R: where the wall/ceiling seams leave the image
       \             /             E_D: where the vertical wall/wall seam leaves the image
        \           /              V: the vertex
         \    V    /               C_LD, C_RD: lower outer corners of each wall
   LEFT   |       |   RIGHT
   WALL   |  E_D  |   WALL
  C_LD ---+       +--- C_RD
```

Faces as quads (order: V, then counter-clockwise):

- `ceiling`: V, E_R, C_LR, E_L
- `left`: V, E_L, C_LD, E_D
- `right`: V, E_D, C_RD, E_R

Each face has a local UV space where (0,0) is the vertex and the two seam edges run along the U and V axes. This makes "radiate from the vertex" and "cross the seam" easy to write: the seam between two faces is u=0 on one and v=0 on the other.

Seam continuity rule: the shared edge between two faces must use the same parameterization on both sides (distance from vertex along the seam, normalized by seam length) so content crossing a seam has no jump.

Store per-face homographies (UV to projector pixels) computed from the 7 points. Recompute on every calibration change.

### 4.2 Room space (for anamorphic scenes)

Config holds physical measurements in meters, origin at the vertex:

- `+X` along the left wall/ceiling seam, `+Y` along the right wall/ceiling seam, `-Z` down the vertical seam
- Face extents: how far each seam is covered by the projection (measured with a tape after calibration)
- `viewer.position`: the sweet spot in room coordinates (x, y, z), eye height included
- `viewer.fov_deg`: default 60

Because each face is a plane, the mapping from the viewer camera image to each face's UV is also a homography. Compute it by projecting the four 3D corners of each face through the viewer camera.

## 5. Rendering pipeline

Every frame:

1. **Scene render** into offscreen textures:
   - Surface scenes render one texture per face (default 1024x1024 each), or one shader that receives `face_id` and `uv` and draws all three.
   - Anamorphic scenes render one texture from the viewer camera (default 1280x1280).
2. **Mapping pass** into the output framebuffer: draw each face quad in projector space. The fragment shader inverts the homography to get face UV, then either samples the face texture (surface) or maps UV to viewer image coordinates with the second homography (anamorphic).
3. **Compensation pass** (same shader, uniforms):
   - Per-face gain (0.0 to 2.0), set in calibration, to even out brightness between faces
   - Optional distance falloff compensation per face: brighten toward the far edge, linear ramp with configurable strength
   - Global gamma
4. **Mask**: everything outside the three quads is pure black. A per-face edge feather (0 to 8 px, default 0) is available but off by default because crisp seams matter more.

Target 30 fps at 1280x720 on Pi 5. Log frame time. If a scene misses budget, it should lower its internal texture resolution, not drop frames.

## 6. Scenes

Each scene is a Python class with `setup(ctx, config)`, `update(t, dt, audio)`, `render()`, and declares `kind = "surface"` or `"anamorphic"`. Scenes read beat and energy data through the `audio` object (Section 8). Build these first:

### Surface scenes

1. **seam_trace**: thin bright lines start at the vertex and race out along all three seams, then along the outer edges, outlining the faces. Line width in projector pixels (default 3) must stay constant regardless of face foreshortening, so compute width in screen space.
2. **radiate**: concentric rings or rays emitted from the vertex across all faces, continuous across seams. Ring spacing and speed tied to tempo.
3. **fold_wave**: a band of light rolls down the left wall, folds onto the ceiling, and leaves via the right wall. Demonstrates seam continuity.
4. **face_pulse**: faces light one at a time on beats. Never two adjacent faces at full brightness at once (see rule 7.2).
5. **unfold_box**: the three faces start dark, edges draw in, then each face "opens" by sweeping a fill from the vertex outward with a shading change, like a box unfolding.

### Anamorphic scenes

6. **convex_cube**: a cube that appears to protrude from the corner toward the viewer. Shade its three visible faces from a single virtual light (ceiling face brightest, left mid, right darkest). Add an option to animate the cube growing out of the vertex, and to rotate the light.
7. **tunnel**: a receding square tunnel or shaft behind the vertex, with moving rings, so the corner looks like an opening.
8. **floating_object**: a simple lit object (icosahedron) hovering in front of the corner, slowly rotating, with a fake drop shadow rendered onto the walls.

Anamorphic scenes must include a `debug_viewer` mode that renders a checkerboard and a wireframe of the room box, so the illusion can be checked from the sweet spot during setup.

## 7. Design rules enforced in code

These are what make the effect work on dim mini projectors. Implement them as runtime checks in a `ContentGuard` that measures each face's mean luminance every frame (downsampled reads are fine, every 4th frame).

1. **Dark-dominant frames**: warn (log, and show a red corner indicator in preview mode) if the mean luminance across all faces stays above 0.5 for more than 2 seconds. Large bright fields wash out the illusion and the room.
2. **Bounce light**: in a concave corner, light reflects between adjacent faces and kills contrast. Warn if two adjacent faces both exceed mean luminance 0.6 at the same time for more than 0.5 seconds. Every face pair is adjacent here, so effectively: at most one face fully bright at a time.
3. **One light source**: anamorphic scenes declare a single `light_dir`, and the shared shading helper uses only that. No per-face hand-tuned brightness in anamorphic scenes.
4. **Crisp seams**: seam lines are drawn in the mapping pass in projector space (not in face textures) when a scene requests `seam_lines=True`, so they land exactly on the calibrated seams.
5. **Hold and release**: the show timeline supports `hold` segments (static or near-static frames) so scenes can build contrast in time.

Warnings never stop playback.

## 8. Audio and show timeline

### 8.1 Beat analysis (offline)

`corner analyze song.wav` writes `song.beats.json`:

```json
{ "tempo": 122.0, "beats": [0.48, 0.97, ...], "downbeats": [0.48, 2.45, ...], "energy": { "hop": 0.0232, "values": [ ... ] } }
```

Use `librosa.beat.beat_track` and RMS energy. Downbeats: every 4th beat starting at the first strong onset is acceptable for v1.

### 8.2 Show file

`show.yaml`:

```yaml
audio: media/song.wav
beats: media/song.beats.json
segments:
  - { scene: seam_trace, start: 0.0, end: 8.0 }
  - { scene: radiate, start: 8.0, end: 24.0, params: { color: "#66ccff" } }
  - { hold: true, start: 24.0, end: 26.0 }
  - { scene: convex_cube, start: 26.0, end: 40.0, params: { grow: true } }
  - { scene: fold_wave, start: 40.0, end: 56.0 }
transitions:
  default: { type: crossfade, duration: 0.5 }
```

Times are seconds. Allow `start_beat` / `end_beat` as an alternative to seconds. Transitions: `cut`, `crossfade`, `black` (fade to black and back).

### 8.3 Live audio playback

Live mode plays the audio file and drives the clock from audio playback position, not wall time, so lights stay in sync. Use `mpv` via its JSON IPC socket for playback and position, which avoids adding a Python audio dependency. If no audio is given, use wall clock.

## 9. Output modes

- `corner live show.yaml`: fullscreen on HDMI on Pi 5 (windowed on macOS). Use KMS/DRM fullscreen on the Pi without a desktop if moderngl-window's backend supports it; otherwise document the minimal desktop session needed.
- `corner bake show.yaml -o show.mp4`: render offline at fixed 30 fps (deterministic time, not real time), pipe frames to `ffmpeg`, mux the audio. Encode H.264 High profile, `-preset veryfast`, `-crf 18`, yuv420p, 1280x720. Mapping and compensation are baked in, so the file is specific to one calibration.
- `corner preview show.yaml`: windowed, shows the projector output plus an inset of each face texture and ContentGuard indicators.

Baking must work on macOS so shows can be built on the Mac and copied to the Pi Zeros.

## 10. Calibration tool

`corner calibrate --config room.yaml`

- Fullscreen on the projector. Shows the 7 points as numbered crosshairs and the three face outlines, with a test pattern per face (grid with face name and UV axes).
- Keys: `1`-`7` select a point (or Tab to cycle), arrow keys move 1 px, Shift+arrow 10 px, `g` toggles grid / solid white / solid black test, `[` and `]` adjust selected face gain, `s` saves, `q` quits.
- Mouse dragging works too when a mouse is attached.
- Saves to `room.yaml` under `calibration:` as pixel coordinates plus per-face gain and falloff.
- Also supports `--ssh` friendly mode: same tool driven from a terminal on another machine over stdin, since the Pi may be headless. Keys read from the terminal, output still on HDMI.

## 11. Config file

`room.yaml`:

```yaml
output: { width: 1280, height: 720, fps: 30 }
calibration:
  V: [640, 300]
  E_L: [120, 40]
  E_R: [1160, 40]
  E_D: [640, 719]
  C_LR: [640, 0]
  C_LD: [0, 719]
  C_RD: [1279, 719]
  gain: { ceiling: 1.0, left: 1.0, right: 1.0 }
  falloff: { ceiling: 0.0, left: 0.0, right: 0.0 }
room:
  extent_m: { x: 1.6, y: 1.6, z: 1.4 }
viewer:
  position_m: [2.5, 2.5, -1.25]
  fov_deg: 60
```

Validate on load (points inside the frame, quads convex, non-degenerate). Fail with a clear message naming the bad point.

## 12. Repo layout

```
corner-mapper/
  pyproject.toml
  README.md
  corner/
    cli.py
    config.py
    geometry.py        # homographies, room model, viewer camera
    renderer.py        # offscreen targets, mapping pass, compensation
    guard.py           # ContentGuard
    timeline.py        # show parsing, transitions, clock
    audio.py           # mpv IPC clock, beats.json loader
    calibrate.py
    bake.py
    shaders/
      mapping.frag
      mapping.vert
      common.glsl
    scenes/
      base.py
      seam_trace.py
      radiate.py
      fold_wave.py
      face_pulse.py
      unfold_box.py
      convex_cube.py
      tunnel.py
      floating_object.py
  examples/
    room.yaml
    show.yaml
  tests/
    test_geometry.py
    test_timeline.py
    test_guard.py
  deploy/
    pi5-setup.md
    pizero-player.service   # systemd unit: mpv --fs --loop show.mp4
```

## 13. Milestones

1. **Geometry and mapping**: config load and validation, homographies, mapping pass drawing a UV test pattern on all three faces. Unit tests confirm seam continuity (a point on the shared seam maps to the same projector pixel from both faces, within 0.5 px).
2. **Calibration tool** working on macOS and Pi 5.
3. **Surface scenes** 1 to 5 and the preview mode.
4. **Timeline and audio**: show file, transitions, mpv clock, beat analysis.
5. **Anamorphic pipeline**: viewer camera, second homography, debug_viewer, then scenes 6 to 8.
6. **ContentGuard** rules and warnings.
7. **Bake** to mp4 and the Pi Zero systemd player.
8. **Pi 5 performance pass**: hit 30 fps at 1280x720 for every scene, document the frame times.

## 14. Acceptance criteria

- With a real corner, calibration takes under 5 minutes and seam lines land on the physical seams within 2 px.
- `fold_wave` crosses both seams with no visible jump or speed change.
- `convex_cube` reads as a protruding cube from the configured sweet spot.
- Live mode on Pi 5 holds 30 fps at 1280x720 with audio drift under 1 frame over a 5 minute show.
- A baked mp4 plays in a loop on a Pi Zero 2 W with `mpv` without dropped frames.
- `pytest` passes on macOS.

## 15. Out of scope for v1

- Camera-based auto calibration
- Multiple projectors on one corner or edge blending
- Live audio input (microphone) reactivity
- Remote control over the network
- Projector power control (handled separately)

## 16. Open questions to raise with me

- Exact Pi Zero model on the playback nodes (assumed Zero 2 W).
- Whether the projectors accept 1280x720 natively over HDMI or scale from 1080p.
- Whether the show should loop with or without a gap between runs.
