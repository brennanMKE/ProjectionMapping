# Puzzle cube

| | |
| --- | --- |
| Status | Built |
| Shader | [`puzzle.frag`](../../pi-mapper/skyd/puzzle.frag) |
| Loop | Loop 2 |
| Duration | 20 s |
| Render resolution | half |
| Frame rate on a Pi Zero 2 W | about 28 fps |
| Correct from anywhere in the room | no, best from the sweet spot |

## Brief

From the corner illusions brief, part 2, section 2.18 ("Twisty puzzle cube corner, 20 s").

**Sees**: the corner reads as the outside corner of a big 3x3 puzzle cube, then its layers rotate, and each turn scrambles the colored squares across all three faces.
**Build**: reuse the convex cube from 2.1 split into 27 cubies (only the visible ones need geometry). Animate layer rotations around the three axes, timed to downbeats, with a short ease. Colors: a plain six-color set, no branding, no logo on a center square.
**Note**: needs the sweet spot. Pair it after the corner flip so the "cube" reading is already established.

## As built

A 3×3 cube sits in the corner with its outer corner pointing at the viewer. Layers turn on the beat, scrambling the coloured squares across all three visible faces, then the same moves run backwards and it solves. Plain six-colour set. Sticker colours are found by undoing the moves so far for each pixel.
