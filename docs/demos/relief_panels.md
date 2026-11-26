# Relief panels

| | |
| --- | --- |
| Status | Built |
| Shader | [`relief.frag`](../../pi-mapper/skyd/relief.frag) |
| Loop | Loop 1 |
| Duration | 15 s |
| Render resolution | half |
| Frame rate on a Pi Zero 2 W | about 27 fps |
| Correct from anywhere in the room | partly |

## Brief

From the corner illusions brief, part 1, section 2.6 ("Relief panels with moving light, 15 s").

**Sees**: the flat walls become raised and recessed panels (wainscoting, hex tiles or extruded blocks), then a light sweeps across and the shadows move.
**Build**: `on` zone geometry with fake depth. Render a heightmap per face, shade it from the viewer camera with the light rig, and draw cast shadows within each panel. Animate `light_dir` in a slow arc.
**Note**: subtle but very convincing. Keep overall brightness low (rule 7.1).

## As built

Raised and recessed panels with bevels, sized so whole panels end exactly at the shape's edges. Panels press in and out in waves across all three surfaces (a ripple from the vertex, a checkerboard on the beat, then one by one), lit by a coloured light that circles in front of the corner, with shadows between panels.

## Viewing notes

> "Has potential. It just seems a bit boring. I also think the blocks should better align with the bottom edge."

Aligned the grid to the edges, and added the moving panels and the coloured light.
