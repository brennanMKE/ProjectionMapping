# Designing corner scenes: what made them work

Lessons from building about 30 live scenes for a projector aimed at a room
corner (two walls and the ceiling), and from watching them in the room.
The best scenes came out of viewing notes like "this breaks the illusion" or
"this one uses the three planes well". This captures why, so new scenes start
from there.

## The scenes that worked best

- **Membrane push**: the surfaces bulge like fabric pushed from behind. The
  grid bends and the shading follows one light.
- **Water fill**: one waterline rises on all three surfaces at once, with
  ripples, caustics and a drain. It's playful.
- **Vortex**: the room grid spirals into the vertex and snaps back.
- **Scanning planes**: thin planes of light cut through the room. The lines
  they draw stay continuous across the seams. Very Tron and Max Headroom.

What they share: the effect lives **on the real surfaces** and **runs across
the seams**, so the corner itself becomes the subject.

## Principles

### 1. Use all three planes and the seams
An effect that crosses a seam without a break is what convinces the eye that
the three surfaces are one space: a waterline, a scan line, a bending grid.
Treat the seams as features, with lines that run along them, streaks pulled
into them, and panels that wrap around them, not as boundaries to avoid.

### 2. Prefer view-independent cues
Anything painted where it really is on a surface looks right from anywhere
in the room: lines, waterlines, contact rings, shadows, bricks. Anamorphic 3D
(objects floating in front of the corner) is only correct from one spot.
- When a scene needs a floating object, keep it **over a single surface,
  clear of the seams and edges**. Near a seam, a small viewing error folds
  the object across two surfaces, and the illusion breaks (the first cube
  break-out).
- Back it up with cues that hold from anywhere: a shadow on the wall, a
  glowing hatch where it came out, darkening where it touches.

### 3. Respect the frame
The picture is masked to a room-aligned shape, with edges parallel to the
seams. Treat that edge as part of the design.
- Nothing appears outside it.
- Don't let things get **cut off** by it. Fade snow out before the edge, and
  shrink falling drops before they reach the bottom.
- Make the edge an event. In the infinite corner, the outer frame stays as
  a dim line, the web lines keep moving and are clipped at it, and the frame
  flashes as each new level reaches it. That fixed "the edge just disappears".
- Align any grid to the frame, so whole panels end exactly at the edges
  (relief panels).

### 4. Obey the room's physics
The viewer knows which way is up. Snow drawn on the ceiling broke the
illusion, so the ceiling became the overcast sky the snow falls from. Things
fall down the walls, pool on ledges and drip from the ceiling.

### 5. Make it big enough to read
Small details vanish at projector brightness and viewing distance. The first
liquid metal ("very small sparks") and the first crawlers and bouncing balls
read as specks. Make objects several centimetres across, give them a bright
rim or highlight, and give each moment one clear subject.

### 6. Change tempo and colour
Steady, even motion gets boring, as the first corner flip and window did.
What worked:
- A **slow, subdued** phase, then a **fast, vibrant** phase on the beat
  (120 BPM, the `beat()` helper).
- When a shape appears, **flood it with colour, flare bright, then fade
  quickly** to just its border lines.
- A new colour on each beat or bar during the fast phase.

### 7. Style families make a show
Scenes in a shared style, such as the 80s neon set (laser grids, wire tunnels,
a turning line lattice, an equaliser), play well back to back and suit music.

### 8. Changes from the controls should ease in
Turning the snow up or down affects only flakes that appear after the change,
and the fall speed eases toward its new value. Nothing on the wall should jump.

## Technical lessons (Pi Zero 2 W, VideoCore IV)

- **Compute shared state once per frame on the CPU.** Physics and animation
  that are the same for every pixel belong in skyd (`sims.c`), passed in as
  uniforms. In the fragment shader the balls ran at 6 fps, and the vertex
  shader was no better.
- **At most about 6 objects per loop.** The GPU compiler silently draws
  nothing when a loop over a uniform array gets bigger. The carousel's 12
  bodies were invisible; 6 bigger ones work.
- **Avoid `continue` and long ternary chains**; the compiler has been fragile
  with both.
- **Reject pixels outside the shape first**, before any object or shadow work.
- **Render heavy scenes at a third to half resolution.** The projected shape
  covers only part of the frame, so it barely shows.
- **Test shadows only near each object**, not for every object at every pixel.
- **Video:** read the decoder's frames in their own thread. The pipe holds
  less than one frame, so reading from the render loop played videos in slow
  motion.
- **Check on the hardware.** The WebGL preview harness, which renders the
  viewer's view on the Mac, catches compile errors and layout. Frame rate,
  and whether objects appear at all, only show on the Pi.

## How we worked

1. Build from a written brief (one per scene in [`docs/demos/`](../demos/)).
2. Check every scene with a webcam snapshot and a frame-rate reading on the Pi.
   The agent fetches these itself, so it can loop until a scene works before
   anyone looks (see [webcam capture](webcam_capture.md#close-the-loop-for-the-ai-agent)).
3. **Watch the scenes in the room and write short notes per scene.** This
   step produced most of the improvements.
4. Keep the favourites in a "top 12" playlist and the rest behind "Show more".
