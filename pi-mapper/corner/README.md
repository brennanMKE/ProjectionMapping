# Corner test videos

Test clips for a projector aimed into a corner where two walls meet the
ceiling. They're rendered for your corner's geometry, not warped afterwards.
`cornergen` works out where the projector sits relative to the three
surfaces, then draws each effect in 3D room coordinates. Light planes, ripples
and shadows land on the walls and ceiling as if they were really there, so the
illusion holds from anywhere in the room.

Play them full screen with no corner-pin warp (`cornerpin.py reset`, or just
don't run cornerpin).

## The clips

All are 1280×720, 30 fps, H.264, 20-second seamless loops.

| File | What it shows |
| --- | --- |
| `corner-measure.mp4` / `.png` | Pixel grid with coordinates, for reading where the corner lands |
| `corner-calibrate.mp4` | Each surface in its own color, a 25 cm grid, yellow seams, LEFT / RIGHT / CEILING labels. Use it to check alignment. |
| `corner-sweep.mp4` | Planes of light sweeping through the room, tracing triangles and lines across all three surfaces |
| `corner-ripples.mp4` | Two wave sources floating in mid-air; the rings interfere across the surfaces |
| `corner-shadows.mp4` | A warm and a cool light; colored shadows of an invisible spinning cube and bouncing ball |
| `corner-cubes.mp4` | Nested cube shells flowing out of the corner (tumbling-blocks illusion) |
| `corner-neon.mp4` | Glowing seams and grid, with pulses running out of the corner |
| `corner-sky-window.mp4` | An opening cut into the corner onto a snowy, moonlit sky, with a string of holiday lights around the rim (30 s) |
| `corner-sky-full.mp4` | The same snowy, moonlit sky filling the whole projection (30 s) |

The two sky clips are drawn for a viewer at the projector's position, or at
`"eye": [below-ceiling, from-right-wall, from-left-wall]` in meters if you set
it in `corner.json`. The snow falls on layers 4 to 15 m "behind" the walls, so
nearer flakes move faster. Render them with a longer loop:
`go run ./cmd/cornergen -config corner/corner.json -out media/corner -only sky-window,sky-full -seconds 30`.

## Steps

### 1. Aim the projector

Point it into the corner so the corner point sits in the upper middle of the
image and all three surfaces get a good share of it. Focus it on the corner.
**Don't move the projector after this**: the clips are rendered for this exact position.

### 2. Try the default clips (optional)

The repo's default layout assumes the corner lands at (640, 302), with the
seams in a symmetric Y. If your aim is close to that, the default clips may
already look right:

```sh
make corner                      # renders all clips into media/corner/ (about 5 minutes)
scp media/corner/*.mp4 <user>@pizero.local:~/corner/
```

### 3. Measure where the corner lands

Play the measuring grid on the Pi:

```sh
mkdir -p ~/corner   # on the Pi, before the first scp
mpv --vo=gpu --gpu-context=drm --drm-connector=HDMI-A-1 --drm-mode=1280x720 \
    --hwdec=v4l2m2m-copy --keepaspect=no --loop --no-audio --no-osc \
    --input-ipc-server=/tmp/mpv.sock ~/corner/corner-measure.mp4
```

The white lines are every 100 px, labeled with yellow X and green Y values.
Blue lines are every 50 px, gray every 10 px. Write down:

- **vertex**: the point where the two walls and the ceiling meet
- **down**: a point on the vertical wall-to-wall seam, as low as possible
- **left**: a point on the left wall / ceiling seam, as far from the vertex as possible
- **right**: a point on the right wall / ceiling seam, as far from the vertex as possible

Points far from the vertex give the most accurate angles. Within 5 px is plenty.

### 4. Render for your corner

```sh
cp corner/corner.example.json corner/corner.json
# edit vertex, down, left, right in corner/corner.json
make corner-quick CORNER=corner/corner.json   # 4 s calibrate clip, under a minute
```

Copy `media/corner/corner-calibrate.mp4` to the Pi and play it. The yellow
lines should sit on the real seams, and the grid should look like square tiles
on each surface.

| What you see | Fix |
| --- | --- |
| Yellow lines off the seams | Re-measure the four points |
| Seams match, but grid squares look stretched | Adjust `throw` (try 1.1 to 1.6), or set `"principal": [640, 720]`. Many projectors throw the image upward from a lens at the bottom edge. |
| Solve fails: "no perpendicular-corner solution" | A point is probably on the wrong seam, or `left` and `right` are swapped |

When it lines up, render everything:

```sh
make corner CORNER=corner/corner.json
scp media/corner/*.mp4 <user>@pizero.local:~/corner/
```

### 5. Play

One clip:

```sh
mpv --vo=gpu --gpu-context=drm --drm-connector=HDMI-A-1 --drm-mode=1280x720 \
    --hwdec=v4l2m2m-copy --keepaspect=no --loop --no-audio --no-osc \
    --input-ipc-server=/tmp/mpv.sock ~/corner/corner-sweep.mp4
```

All of them in turn, each twice, forever: replace `--loop` and the file with
`--loop-playlist=inf --loop-file=1 $(ls ~/corner/corner-*.mp4 | grep -v measure)`.
To skip to the next clip from another SSH session:

```sh
python3 -c 'import socket,sys; s=socket.socket(socket.AF_UNIX); s.connect("/tmp/mpv.sock"); s.send(b"{\"command\":[\"playlist-next\"]}\n")'
```

## Config reference (`corner.json`)

| Key | Meaning |
| --- | --- |
| `width`, `height`, `fps`, `seconds` | Output size, frame rate, and loop length. Match `--drm-mode` to the size. |
| `throw` | Projector throw ratio (distance ÷ image width). Sets the lens angle. |
| `principal` | Optional. The lens's optical center in pixels (default: image center). |
| `distance` | Lens to corner in meters. Only sets the scale of the effects (grid size, ripple spacing). |
| `vertex`, `down`, `left`, `right` | The measured points, in projector pixels |
| `supersample` | Anti-aliasing: 2 gives 4 samples per pixel |
| `crf` | x264 quality (lower is better and bigger; 18 to 23 is sensible) |

Effects live in `cmd/cornergen/main.go`. Each is a function from a point on a
surface (meters from the corner) and the loop phase to a color, so new ones are
short to write.

## Your own videos: `corner_video.py`

From the projector's own position, any normal video already looks flat on the
corner: each surface shows exactly what the lens throws at it. The fold only
bends the picture for people standing somewhere else. `corner_video.py`
pre-distorts a video for a chosen viewing spot, so that from there it looks
like a flat screen floating behind the corner.

```sh
# viewer standing at the projector's spot, eyes at 1.6 m, ceiling 2.6 m
corner/corner_video.py my-clip.mov media/corner/my-clip-corner.mp4 --ceiling 2.6

# viewer somewhere else: meters below the ceiling, from the right wall, from the left wall
corner/corner_video.py my-clip.mov media/corner/my-clip-corner.mp4 --eye 1.0,3.0,1.2

# check the framing on one frame first
corner/corner_video.py my-clip.mov /tmp/check.png --preview
```

It reads `corner/corner.json` (the same measurements cornergen uses). For the
viewing spot to land correctly, set `"distance"` there to the real lens-to-corner
distance, measured with a tape. Other options: `--fit contain` shows the whole
frame instead of filling the corner, `--zoom` scales the video, `--shift x,y`
moves it. Needs only Python 3 and ffmpeg.

Tips for recording: hold the camera steady (a tripod helps). Subjects that
are bright on a dark background project best on a white wall, and the
projector can't show black, so dark scenes look washed out.
