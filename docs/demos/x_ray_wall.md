# X-ray wall

| | |
| --- | --- |
| Status | Built |
| Shader | [`xray.frag`](../../pi-mapper/skyd/xray.frag) |
| Loop | Loop 2 |
| Duration | 20 s |
| Render resolution | half |
| Frame rate on a Pi Zero 2 W | about 29 fps |
| Correct from anywhere in the room | yes |

## Brief

From the corner illusions brief, part 2, section 2.16 ("X-ray wall, 20 s").

**Sees**: a scan band sweeps across the walls and ceiling and shows what is "inside" them: studs, ceiling joists, electrical conduit, a junction box, pipes, with a slight blueprint look.
**Build**: a `behind` scene with a simple procedural wall cavity layout (studs at 16 in centers, joists along the ceiling, one or two conduit runs that turn across seams). Seen through a moving portal shaped as the scan band. Blueprint or thermal palette, configurable.
**Note**: the conduit runs crossing the seams and the studs lining up across a wall sell it. Keep the layout believable rather than busy.

## As built

A scan band sweeps across the walls and ceiling and shows what is inside them: studs at 16 in centres, ceiling joists, conduit that turns across the seams, a junction box. Blueprint palette by default; `set u_thermal 1` switches to a thermal look.
