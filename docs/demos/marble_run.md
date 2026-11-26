# Marble run

| | |
| --- | --- |
| Status | Built |
| Shader | [`marble.frag`](../../pi-mapper/skyd/marble.frag) + [`sims.c`](../../pi-mapper/skyd/sims.c) |
| Loop | Loop 3 |
| Duration | 30 s |
| Render resolution | 40% |
| Frame rate on a Pi Zero 2 W | about 14 fps |
| Correct from anywhere in the room | partly |

## Brief

From the corner illusions brief, part 3, section 2.25 ("Corner marble run, 30 s").

**Sees**: a marble drops from the ceiling onto a ramp on the left wall, zigzags down, jumps the seam onto a ramp on the right wall, drops into a funnel at the vertex, spirals around the vertical seam inside a clear tube, and exits at the bottom. More marbles follow, then the track builds itself piece by piece for the next run.
**Build**: track pieces as `on`/`front` zone geometry attached to faces: ramps (ledges 1.6 with slope), a seam jump (gap between two ramps on different walls), a funnel at the vertex, a helix tube around the seam axis. Marbles follow 1.10 physics constrained to tracks, or follow precomputed spline paths with speed from gravity if physics on tracks is unstable. Contact cues (1.12) on each ramp landing.
**Note**: the track assembling itself is a good chained intro. The helix around the seam is the part that only works in a corner.

## As built

The track builds itself, then marbles drop from a hole in the ceiling onto ramps on the left wall, zigzag down, jump the seam onto the right wall, roll into a funnel at the vertical seam and spiral down a clear tube around it. Marbles follow a precomputed path.
