# Pin screen

| | |
| --- | --- |
| Status | Built |
| Shader | [`pins.frag`](../../pi-mapper/skyd/pins.frag) |
| Loop | Loop 2 |
| Duration | 20 s |
| Render resolution | half |
| Frame rate on a Pi Zero 2 W | about 17 fps |
| Correct from anywhere in the room | no, best from the sweet spot |

## Brief

From the corner illusions brief, part 2, section 2.19 ("Pin screen, 20 s").

**Sees**: the walls become a dense field of pins that push out of the surface in waves, ripples from the vertex, and shapes like a hand pressing from behind.
**Build**: instanced short cylinders on a grid per face (cap counts per config for Pi 5, start at 24x24 per face). Each pin's extrusion comes from a height function: ripples, traveling waves, or a heightmap (a pressed shape). Lit by the light rig with shadows between pins (cheap ambient occlusion from the heightmap is enough).
**Note**: the membrane push (2.4) and this share the height-function interface. Write one.

## As built

The surfaces become a field of pins (24 along each seam) that push out in ripples from the vertex, travelling waves, then a hand pressing into the left wall. A short height-field march toward the viewer.
