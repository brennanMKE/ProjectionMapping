# Snowfall with build-up

| | |
| --- | --- |
| Status | Built |
| Shader | [`snowfall.frag`](../../pi-mapper/skyd/snowfall.frag) |
| Loop | Loop 2 |
| Duration | 25 s |
| Render resolution | half |
| Frame rate on a Pi Zero 2 W | about 20 fps |
| Correct from anywhere in the room | no, best from the sweet spot |

## Brief

From the corner illusions brief, part 2, section 2.21 ("Snowfall with build-up, 25 s").

**Sees**: snow falls in the space in front of the corner, drifting and catching light. It settles on the ledges and on the tops of relief panels, building up visible white ridges, then melts away.
**Build**: point particles (1.7) with wind noise, depth-sorted, size and blur by distance from the viewer. Particles that hit a ledge add to a per-ledge height buffer drawn as a soft white bump. Melt by decaying the buffers.
**Note**: fits a December show. Limit particle count on Pi 5 (start at 1500).

## As built

Snow falls in the space in front of the corner on layers facing the viewer (nearer flakes bigger and softer) and piles up on the ledges as white ridges, then melts. No snow over the ceiling, which is a dim drifting overcast sky the snow falls from; flakes fade out before the seams and edges.

## Viewing notes

> "Snowfall should not have snow on the ceiling. When it hits the edge with the walls it does not look right. It breaks the illusion."

Removed snow from the ceiling and faded flakes out before the seams.
