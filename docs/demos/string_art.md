# String art

| | |
| --- | --- |
| Status | Built |
| Shader | [`strings.frag`](../../pi-mapper/skyd/strings.frag) |
| Loop | Loop 2 |
| Duration | 20 s |
| Render resolution | half |
| Frame rate on a Pi Zero 2 W | about 21 fps |
| Correct from anywhere in the room | partly |

## Brief

From the corner illusions brief, part 2, section 2.20 ("String art, 20 s").

**Sees**: taut colored threads stretch across the space between points on the walls and ceiling, forming curved 3D surfaces (hyperboloids, twisted sheets) that rotate slowly and change color on beats.
**Build**: line segments in room space between anchor points on the three faces (`front` zone), rendered from the viewer camera. Anchor points slide along the seams and edges over time, which makes the ruled surfaces twist. Small bright dots at the anchors on the walls.
**Note**: very cheap, very 3D from the sweet spot, and the anchors on the walls stay correct from anywhere.

## As built

Two families of taut threads between anchors on the walls and ceiling form ruled surfaces that twist slowly and change colour on beats. The anchor dots on the surfaces are correct from anywhere.
