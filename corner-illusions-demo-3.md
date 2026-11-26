# Corner Illusions, Part 3: Three-Face Physics Scenes

Handoff doc for Claude Code. Extends Parts 1 and 2. These five scenes build on what made the bouncing balls (2.14) work: objects that move between the ceiling and both walls, so the corner's three faces read as a real box people are looking into. Numbering continues at 2.23.

## 1. Shared additions

### 1.10 Physics upgrades (extend 1.7)
- **Gravity vector** as an animatable uniform, not a constant. Scenes can tween it between face normals.
- **Face planes as colliders by default**: ceiling, left wall, right wall, with per-face restitution and friction.
- **Box and capsule bodies** in addition to spheres, with simple rotation (no stacking stability beyond "good enough to look right"; settle bodies to sleep when slow).
- **Bounds**: bodies that leave the projected extents of all faces are removed, or wrapped back in by the scene.
- Still deterministic, fixed 120 Hz substeps.

### 1.11 Portal pairs
Two portals on different faces linked so a body entering one comes out the other with its velocity rotated into the exit face's frame. Each portal has a visible rim (thin ring on the face, `on` zone) and a dark interior (`behind` zone).

### 1.12 Contact cues
On each collision with a face: a short bright flash or ring at the contact point on the face (`on` zone), scaled by impact speed. Contact points on the real walls are view-independent, so this cue helps people off the sweet spot follow the motion. Expose an event hook so scenes can trigger sounds or ContentGuard-safe flashes on impact.

## 2. Scenes

### 2.23 Gravity carousel, 25 s
**Sees**: a pile of balls and blocks rests on the left wall as if it were the floor. Gravity swings, and everything slides and tumbles across the seam onto the ceiling, then onto the right wall, then back. Each face takes a turn as the floor.
**Build**: 1.10 gravity tween between the three inward face normals, 2 to 3 s per swing with a short hold. 30 to 60 mixed bodies. Shadows (1.2) cast in the gravity direction so the current "floor" is clear. Tilt the room grid slightly with each swing to hint at rotation.
**Note**: the moment bodies pour over a seam is the payoff. Make the swing ease in so they start sliding slowly, then fall.

### 2.24 Portal juggle, 20 s
**Sees**: a ball shoots out of a portal on the left wall, arcs through the space in front of the corner and drops into a portal on the ceiling, comes out of a portal on the right wall, and so on. More balls join until three or more are cycling in a juggling pattern among the three faces.
**Build**: 1.11 portals, one per face. Solve launch velocities so each arc lands in the target portal (ballistic solve with the current gravity). Balls are `front` zone while in flight, with shadows on whichever face they're closest to. Add balls on downbeats and drop them on the last bars.
**Note**: the arc through open space between two real walls is the strongest 3D moment in this set. Keep arcs well in front of the walls so they read from the sweet spot.

### 2.25 Corner marble run, 30 s
**Sees**: a marble drops from the ceiling onto a ramp on the left wall, zigzags down, jumps the seam onto a ramp on the right wall, drops into a funnel at the vertex, spirals around the vertical seam inside a clear tube, and exits at the bottom. More marbles follow, then the track builds itself piece by piece for the next run.
**Build**: track pieces as `on`/`front` zone geometry attached to faces: ramps (ledges 1.6 with slope), a seam jump (gap between two ramps on different walls), a funnel at the vertex, a helix tube around the seam axis. Marbles follow 1.10 physics constrained to tracks, or follow precomputed spline paths with speed from gravity if physics on tracks is unstable. Contact cues (1.12) on each ramp landing.
**Note**: the track assembling itself is a good chained intro. The helix around the seam is the part that only works in a corner.

### 2.26 Three-wall breakout, 25 s
**Sees**: all three faces are covered with bricks. A bright ball bounces around inside the corner, hitting the ceiling and both walls, and each brick it hits shatters and falls away. A paddle is not needed; the ball keeps going on its own until the faces are cleared, then the bricks rebuild.
**Build**: bricks as `on` zone tiles on all faces. The ball moves in 3D in front of the faces with no gravity (or very low), bouncing off the face planes and an invisible front boundary so it stays in view. On impact, remove the brick at the contact point and spawn 4 to 8 small fragment boxes that fall under gravity. Contact cues (1.12). Rebuild bricks from the vertex outward.
**Note**: bricks cleared from the real walls are view-independent, so the scene stays readable from anywhere even if the ball's depth only reads from the sweet spot.

### 2.27 Corner crawlers, 20 s
**Sees**: small geometric bugs (a few segments and legs, abstract, not any known character) walk across a wall, turn the seam onto the other wall without stopping, climb onto the ceiling and walk upside down. One drops from the ceiling on a thread, swings, and lands on a wall.
**Build**: crawlers with simple procedural leg animation, moving on face surfaces with their up vector set to the face normal. At a seam, rotate the body 90 degrees around the seam axis over a few frames so they wrap the edge. Thread: a line segment from a ceiling anchor, the crawler as a pendulum (1.10). Shadows on the face they're walking on. 5 to 12 crawlers, wandering with steering toward seams so transitions happen often.
**Note**: walking over a seam onto the ceiling is the effect, so steer them there constantly. Keep them small relative to the faces.

## 3. Loop placement

Add these as a third loop, `examples/illusions-demo-3.yaml`, about 2 minutes:

| # | Scene | Into next via |
|---|---|---|
| 1 | Corner marble run (2.25) | last marble exits, track disassembles into bricks |
| 2 | Three-wall breakout (2.26) | final brick fragments land as a pile on the left wall |
| 3 | Gravity carousel (2.23) | bodies fall into three portals |
| 4 | Portal juggle (2.24) | balls drop out, portals close into crawler anchors |
| 5 | Corner crawlers (2.27) | crawlers carry a marble to the ceiling, run restarts |

Also slot the bouncing balls (2.14) into this loop after the marble run if it fits the music. Include all three loops in the playlist option.

## 4. Implementation order

1. Physics upgrades (1.10) and contact cues (1.12).
2. Gravity carousel (2.23): best test of the upgrades.
3. Portal pairs (1.11) and portal juggle (2.24).
4. Three-wall breakout (2.26).
5. Corner marble run (2.25): start with spline paths, try physics on tracks after.
6. Corner crawlers (2.27).
7. Loop 3 and Pi 5 performance pass.

## 5. Acceptance

Same as Parts 1 and 2, plus:
- Gravity carousel: bodies settle on each face within 1.5 s of a swing ending, no jitter.
- Portal juggle: no misses over a 5 minute run.
- Marble run: marbles complete the track every time across 50 consecutive runs in a bake.
- Crawlers cross a seam at least once every 3 s on average across the group.
