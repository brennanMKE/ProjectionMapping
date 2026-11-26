# Infinite corner

| | |
| --- | --- |
| Status | Built |
| Shader | [`infinite.frag`](../../pi-mapper/skyd/infinite.frag) |
| Loop | Loop 2 |
| Duration | 15 s |
| Render resolution | half |
| Frame rate on a Pi Zero 2 W | about 30 fps |
| Correct from anywhere in the room | no, best from the sweet spot |

## Brief

From the corner illusions brief, part 2, section 2.15 ("Infinite corner, 15 s").

**Sees**: a smaller copy of the corner opens at the vertex, with another inside it, receding without end. The camera then seems to fly into it.
**Build**: recursive render (1.9) in a portal at the vertex, each level scaled and slightly rotated. Animate a zoom so each level grows to replace its parent, which loops seamlessly.
**Note**: the zoom loop makes a good transition since it can end at any state.

## As built

A smaller copy of the corner opens at the vertex, with another inside it, each a little turned; each level grows to replace its parent, looping seamlessly. Done analytically (each level is the room turned and scaled, ray-traced directly) instead of rendering into a texture. The outer edge stays as a dim frame; the grid of the level that has grown past it keeps moving, clipped at the frame, and the frame flashes as each new level reaches it.

## Viewing notes

> "Cool but I don't like how the outer edge just disappears. I'd like the outer edge to light up when the first inside edge touches it and keep the web lines. Then let each new shape come forward to the edge."

Added the dim outer frame, the clipped web lines and the flash.
