# Membrane push

| | |
| --- | --- |
| Status | Built |
| Shader | [`membrane.frag`](../../pi-mapper/skyd/membrane.frag) |
| Loop | Loop 1 |
| Duration | 15 s |
| Render resolution | half |
| Frame rate on a Pi Zero 2 W | about 30 fps |
| Correct from anywhere in the room | no, best from the sweet spot |

## Brief

From the corner illusions brief, part 1, section 2.4 ("Membrane push, 15 s").

**Sees**: the walls look like stretched fabric. Something presses from behind and bulges the surface toward the viewer, moving around, then pushes through near the vertex.
**Build**: room grid as a deformable mesh. Displace vertices toward the viewer with a moving Gaussian bump. Shade with normals from the displaced mesh using the light rig. The grid lines bending is what sells it.
**Note**: a good lead-in to the sphere scene. The bump becomes the sphere breaking out.

## As built

The surfaces look like stretched fabric with a grid. Something presses from behind and bulges it toward the viewer, wandering around, then pushes hard near the corner. The grid bends with the bulge (parallax), shaded from one light.

## Viewing notes

> "One of the best illusions. It uses the 3 planes very well."

Unchanged.
