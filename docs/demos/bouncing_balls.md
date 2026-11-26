# Bouncing balls

| | |
| --- | --- |
| Status | Built |
| Shader | [`balls.frag`](../../pi-mapper/skyd/balls.frag) + [`skyd.c`](../../pi-mapper/skyd/skyd.c) |
| Loop | Loop 2 |
| Duration | 20 s |
| Render resolution | half |
| Frame rate on a Pi Zero 2 W | about 11 fps |
| Correct from anywhere in the room | no, best from the sweet spot |

## Brief

From the corner illusions brief, part 2, section 2.14 ("Bouncing balls, 20 s").

**Sees**: balls drop out of a portal in the ceiling, bounce off ledges on the walls, roll along them, fall off the ends and leave the projected area.
**Build**: physics (1.7) plus ledges (1.6). Balls spawn on beats. Each ball casts a shadow (1.2) that tightens and darkens as it gets close to a ledge or wall, which is the main depth cue. A small squash on impact.
**Note**: the shadow-to-ball distance is what sells the 3D. Tune it before anything else.

## As built

Balls drop out of portals in the ceiling, bounce on ledges with a squash, roll along them, fall off the ends and leave the picture. Closed-form physics, computed once per frame on the CPU. Each ball's shadow tightens and darkens as it nears a surface.

## Viewing notes

First drew nothing on the Pi (a GPU compiler problem), then ran at 6 fps with the physics in the fragment shader. Moving the physics to the CPU and simplifying fixed it; still the slowest scene.
