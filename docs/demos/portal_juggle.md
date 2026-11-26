# Portal juggle

| | |
| --- | --- |
| Status | Built |
| Shader | [`juggle.frag`](../../pi-mapper/skyd/juggle.frag) + [`sims.c`](../../pi-mapper/skyd/sims.c) |
| Loop | Loop 3 |
| Duration | 20 s |
| Render resolution | half |
| Frame rate on a Pi Zero 2 W | about 20 fps |
| Correct from anywhere in the room | partly |

## Brief

From the corner illusions brief, part 3, section 2.24 ("Portal juggle, 20 s").

**Sees**: a ball shoots out of a portal on the left wall, arcs through the space in front of the corner and drops into a portal on the ceiling, comes out of a portal on the right wall, and so on. More balls join until three or more are cycling in a juggling pattern among the three faces.
**Build**: 1.11 portals, one per face. Solve launch velocities so each arc lands in the target portal (ballistic solve with the current gravity). Balls are `front` zone while in flight, with shadows on whichever face they're closest to. Add balls on downbeats and drop them on the last bars.
**Note**: the arc through open space between two real walls is the strongest 3D moment in this set. Keep arcs well in front of the walls so they read from the sweet spot.

## As built

A portal on each face. Balls shoot out of one, arc through the space in front of the corner and drop into the next, then come out of the linked portal. Ballistic arcs are solved in closed form, so there are no misses. Portals flash as balls pass.
