# Three-wall breakout

| | |
| --- | --- |
| Status | Built |
| Shader | [`breakout.frag`](../../pi-mapper/skyd/breakout.frag) + [`sims.c`](../../pi-mapper/skyd/sims.c) |
| Loop | Loop 3 |
| Duration | 25 s |
| Render resolution | about a third |
| Frame rate on a Pi Zero 2 W | about 18 fps |
| Correct from anywhere in the room | yes |

## Brief

From the corner illusions brief, part 3, section 2.26 ("Three-wall breakout, 25 s").

**Sees**: all three faces are covered with bricks. A bright ball bounces around inside the corner, hitting the ceiling and both walls, and each brick it hits shatters and falls away. A paddle is not needed; the ball keeps going on its own until the faces are cleared, then the bricks rebuild.
**Build**: bricks as `on` zone tiles on all faces. The ball moves in 3D in front of the faces with no gravity (or very low), bouncing off the face planes and an invisible front boundary so it stays in view. On impact, remove the brick at the contact point and spawn 4 to 8 small fragment boxes that fall under gravity. Contact cues (1.12). Rebuild bricks from the vertex outward.
**Note**: bricks cleared from the real walls are view-independent, so the scene stays readable from anywhere even if the ball's depth only reads from the sweet spot.

## As built

Bricks cover all three faces. A ball bounces between the faces, aimed at a remaining brick each time; each brick it hits flashes, shatters into falling shards and leaves a ring. Then the bricks rebuild from the vertex outward. Brick state goes to the GPU as a small texture.
