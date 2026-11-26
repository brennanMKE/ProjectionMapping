# Corner spin

| | |
| --- | --- |
| Status | Built |
| Shader | [`spin.frag`](../../pi-mapper/skyd/spin.frag) |
| Loop | Loop 1 |
| Duration | 15 s |
| Render resolution | half |
| Frame rate on a Pi Zero 2 W | not measured |
| Correct from anywhere in the room | no, best from the sweet spot |

## Brief

From the corner illusions brief, part 1, section 2.12 ("Corner spin, 15 s").

**Sees**: the whole corner seems to rotate around the vertex axis, with the walls and ceiling swapping places.
**Build**: render a virtual copy of the room box (grid plus face tint) rotating about the axis from the vertex toward the viewer, in the `on` zone so it is painted onto the real faces. Hold the real seams as faint lines so the conflict between real and virtual corner is visible.
**Note**: disorienting in a good way. Keep it short.

## As built

A virtual copy of the corner (tinted faces and grid) turns about the axis from the vertex toward the viewer, painted onto the real surfaces, so the walls and ceiling seem to trade places. The real seams stay as faint lines.

## Viewing notes

> "Basic but it's a good one."

Unchanged.
