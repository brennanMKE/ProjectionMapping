# Corner crawlers

| | |
| --- | --- |
| Status | Built |
| Shader | [`crawlers.frag`](../../pi-mapper/skyd/crawlers.frag) + [`sims.c`](../../pi-mapper/skyd/sims.c) |
| Loop | Loop 3 |
| Duration | 20 s |
| Render resolution | 40% |
| Frame rate on a Pi Zero 2 W | about 26 fps |
| Correct from anywhere in the room | yes |

## Brief

From the corner illusions brief, part 3, section 2.27 ("Corner crawlers, 20 s").

**Sees**: small geometric bugs (a few segments and legs, abstract, not any known character) walk across a wall, turn the seam onto the other wall without stopping, climb onto the ceiling and walk upside down. One drops from the ceiling on a thread, swings, and lands on a wall.
**Build**: crawlers with simple procedural leg animation, moving on face surfaces with their up vector set to the face normal. At a seam, rotate the body 90 degrees around the seam axis over a few frames so they wrap the edge. Thread: a line segment from a ceiling anchor, the crawler as a pendulum (1.10). Shadows on the face they're walking on. 5 to 12 crawlers, wandering with steering toward seams so transitions happen often.
**Note**: walking over a seam onto the ceiling is the effect, so steer them there constantly. Keep them small relative to the faces.

## As built

Small geometric bugs walk loops that cross the seams constantly, wrapping from wall to wall and onto the ceiling. One drops from the ceiling on a thread, swings and lands on a wall.
