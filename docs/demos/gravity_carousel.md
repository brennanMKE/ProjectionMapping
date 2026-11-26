# Gravity carousel

| | |
| --- | --- |
| Status | Built |
| Shader | [`carousel.frag`](../../pi-mapper/skyd/carousel.frag) + [`sims.c`](../../pi-mapper/skyd/sims.c) |
| Loop | Loop 3 |
| Duration | 25 s |
| Render resolution | about a third |
| Frame rate on a Pi Zero 2 W | about 30 fps |
| Correct from anywhere in the room | no, best from the sweet spot |

## Brief

From the corner illusions brief, part 3, section 2.23 ("Gravity carousel, 25 s").

**Sees**: a pile of balls and blocks rests on the left wall as if it were the floor. Gravity swings, and everything slides and tumbles across the seam onto the ceiling, then onto the right wall, then back. Each face takes a turn as the floor.
**Build**: 1.10 gravity tween between the three inward face normals, 2 to 3 s per swing with a short hold. 30 to 60 mixed bodies. Shadows (1.2) cast in the gravity direction so the current "floor" is clear. Tilt the room grid slightly with each swing to hint at rotation.
**Note**: the moment bodies pour over a seam is the payoff. Make the swing ease in so they start sliding slowly, then fall.

## As built

Balls and blocks rest on one face as if it were the floor. Gravity swings (easing in) to the ceiling, then the right wall, then back; they slide, tumble over the seams and settle. 120 Hz deterministic physics on the CPU. Six bodies: the Pi's GPU silently drew nothing with twelve.
