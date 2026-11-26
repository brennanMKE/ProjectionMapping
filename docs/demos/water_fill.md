# Water fill

| | |
| --- | --- |
| Status | Built |
| Shader | [`water.frag`](../../pi-mapper/skyd/water.frag) |
| Loop | Loop 1 |
| Duration | 20 s |
| Render resolution | half |
| Frame rate on a Pi Zero 2 W | not measured |
| Correct from anywhere in the room | yes |

## Brief

From the corner illusions brief, part 1, section 2.7 ("Water fill, 20 s").

**Sees**: the corner fills with water. A rising waterline appears on all three faces at once, with ripples and caustic light above it.
**Build**: a horizontal plane in room space rising along -Z. Where it meets the walls draws a waterline (view-independent). Below the line, tint blue and add a scrolling caustics texture projected from above. Add a ripple displacement on the waterline. When the water reaches the ceiling, drain it quickly.
**Note**: the waterline is view-independent. Caustics only need to look plausible.

## As built

One waterline rises on all three surfaces at once, with ripples, caustics below and light dancing on the walls above, then drains quickly when it reaches the ceiling.

## Viewing notes

> "Really great. I love how it plays with the illusion and is playful."

Unchanged.
