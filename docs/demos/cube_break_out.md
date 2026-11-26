# Cube break-out

| | |
| --- | --- |
| Status | Built |
| Shader | [`cube.frag`](../../pi-mapper/skyd/cube.frag) + [`cube.vert`](../../pi-mapper/skyd/cube.vert) |
| Loop | Loop 1 |
| Duration | 24 s |
| Render resolution | half |
| Frame rate on a Pi Zero 2 W | about 26 fps |
| Correct from anywhere in the room | partly |

## Brief

From the corner illusions brief, part 1, section 2.5 ("Sphere break-out (existing), 20 s").

Keep as is. Make sure it uses 1.1 and 1.2, so the sphere casts a shadow on the walls after it crosses into the `front` zone.

## As built

The brief's sphere became a cube. Three 8 s acts, one per surface: a square hatch opens in the middle of the surface, a cube about 12 cm across pushes out, floats and turns, slides back in and the hatch closes. It stays over one surface, clear of the seams, and the hatch outline and soft shadow are drawn where they really are. The animation state is computed in the vertex shader.

## Viewing notes

> "Does not seem to work well along the edges. Maybe it is because my viewpoint is not exactly where it needs to see it accurately. But it just does not work well. It breaks the illusion."

Rewritten. The first version grew the cube out of the vertex and across the seams, where a small viewing error folds it across two surfaces. Now one surface at a time, away from the seams, with view-independent cues.
