# Liquid metal

| | |
| --- | --- |
| Status | Built |
| Shader | [`metal.frag`](../../pi-mapper/skyd/metal.frag) |
| Loop | Loop 2 |
| Duration | 20 s |
| Render resolution | half |
| Frame rate on a Pi Zero 2 W | about 25 fps |
| Correct from anywhere in the room | no, best from the sweet spot |

## Brief

From the corner illusions brief, part 2, section 2.22 ("Liquid metal drip, 20 s").

**Sees**: a chrome bead forms on the ceiling near the vertex, stretches, drips onto a ledge, pools, then flows along the seam and drips again.
**Build**: metaballs evaluated in a small 3D grid near the drip path, shaded with a fake environment map (a blurred gradient, no image assets) plus one sharp highlight from the light rig. Drops follow 1.7 physics, and pools are flattened metaballs on ledges.
**Note**: the most expensive scene here. Render the metaball pass at half resolution and upscale.

## As built

A chrome pool seeps out of the vertex and spreads over most of the ceiling, spills over both ceiling seams and runs down the walls in thick rivulets with heavy beads; big drops swell, neck and fall, then it all drains back. The chrome reflects the room grid. Only the falling drop is ray-marched.

## Viewing notes

> "Did not appear to be doing much. I saw very small sparks or metal drops. It needs to be more significant."

Rewritten at a much larger scale.
