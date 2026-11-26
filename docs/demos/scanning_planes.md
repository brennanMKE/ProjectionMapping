# Scanning planes

| | |
| --- | --- |
| Status | Built |
| Shader | [`scan.frag`](../../pi-mapper/skyd/scan.frag) |
| Loop | Loop 1 |
| Duration | 15 s |
| Render resolution | full |
| Frame rate on a Pi Zero 2 W | about 28 fps |
| Correct from anywhere in the room | yes |

## Brief

From the corner illusions brief, part 1, section 2.8 ("Scanning plane, 15 s").

**Sees**: thin bright planes of light sweep through the room. Each one draws a line where it cuts each face, and the lines stay connected across the seams.
**Build**: intersect animated 3D planes (horizontal, vertical, then tilted and rotating) with the three face planes and draw the lines. Several planes at once, tempo-driven.
**Note**: `view_independent = True`. Strong on beats, cheap to render, good as a reset between heavy scenes.

## As built

Thin planes of light sweep through the room: one falling from the ceiling, one turning about the vertical seam, and one tilted plane moving out from the corner. Each draws a line on every surface it cuts, continuous across the seams.

## Viewing notes

> "Very cool. We could have a few more like this one. Perhaps a set of them to match which could go with a sort of 80's music video vibe. It is very Tron and Max Headroom."

Led to the Neon set: neon grid, wire tunnel, rotor grid and equalizer.
