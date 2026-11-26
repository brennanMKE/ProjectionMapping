# Corner flip

| | |
| --- | --- |
| Status | Built |
| Shader | [`flip.frag`](../../pi-mapper/skyd/flip.frag) |
| Loop | Loop 1 |
| Duration | 15 s |
| Render resolution | full |
| Frame rate on a Pi Zero 2 W | about 20 fps |
| Correct from anywhere in the room | mostly |

## Brief

From the corner illusions brief, part 1, section 2.1 ("Corner flip (convex / concave), 15 s").

**Sees**: the corner shaded as a normal inside corner, then the shading inverts and it pops out as a cube corner pointing at the viewer, then flips back.
**Build**: render a cube corner at the vertex in the `front` zone with one light. Crossfade between "inside corner" shading (light falls on faces as real room light would) and "outside cube" shading (ceiling brightest, walls darker). Add edge highlights on the seams for the convex state, edge shadows for the concave state.
**Note**: the flip reads best with a slow light move during the transition.

## As built

The corner is shaded as an inside corner, then the shading inverts so it pops out as a cube corner pointing at the viewer, then flips back. A slow flip in muted slate colours, then six fast flips on the beat with saturated colours that change on every flip.

## Viewing notes

> "Subtle and simple. It's not exciting but it is quite good. It could use more vibrant colors and perhaps have a slow phase and a faster phase. Perhaps the slow phase could use subdued colors while faster phases are more vibrant."

Added the slow subdued phase (0–7 s) and the fast vibrant phase (8–14 s, one flip per second).
