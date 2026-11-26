# Building blocks

Shared techniques the scenes are built from, from the three corner illusions briefs. Each block notes how it was realised in `skyd` (GLSL ES 1.00 on a Pi Zero 2 W), where scenes are ray-traced from the viewer's eye onto the three real surfaces instead of rendered as meshes.

Room coordinates are metres from the corner: x down the vertical seam, y along the left wall/ceiling seam, z along the right one. The ceiling is x = 0, the left wall z = 0, the right wall y = 0. Shared helpers live in [`pi-mapper/skyd/common.glsl`](../../pi-mapper/skyd/common.glsl).

## 1.1 Depth zones

Each object or surface in an anamorphic scene belongs to one zone:

- **behind**: beyond the wall planes. Visible only through a **portal** (a cutout region drawn on a face). Outside the portal the real wall shows instead.
- **on**: lies on the wall planes (paint, shadows, cracks, panels).
- **front**: between the walls and the viewer. Always drawn on top, never clipped by portals.

Implement this as render order plus a portal stencil: draw `behind` objects masked by the portal stencil, then `on` content, then `front` objects. This is the core of the "breaks out of the box" effect: an object moves from `behind` to `front` as it crosses the portal plane, and switches from clipped to unclipped at that moment. Generalize the logic the sphere scene already uses into `corner/scenes/zones.py`.

**In skyd:** `roomHit()` finds the real surface; `maskOut()` masks to the room-aligned shape. "Behind" content is reached by continuing the ray past the surface (window, X-ray wall); "front" objects are ray-traced before the room (cube, balls).

## 1.2 Projected shadows

`cast_shadow(mesh, light, faces)`: project a mesh along the light direction onto each face plane and render the result as a soft dark shape in the `on` zone. Shadows on the walls are what sell objects in the `front` zone. Without them, front objects look flat. Use a fixed blur (shadow texture rendered at quarter resolution and blurred).

**In skyd:** `sphereShadow()`: a soft shadow that tightens and darkens as the object nears the surface; boxes are tested against the light ray directly.

## 1.3 Virtual light rig

One `light_dir` (or point light) per scene, animatable, used by all shading and shadow code. Keeps rule 7.3 (one light source) intact.

**In skyd:** Each scene uses one light direction, often animated.

## 1.4 Room grid

A wireframe grid aligned to the physical faces (in room space, 0.2 m spacing default). Drawing the grid first and then deforming it is the cheapest way to make people read the walls as surfaces that can change. Several scenes use it as their opening state.

**In skyd:** `gridLine()` on `faceUV()`; `edgeLines()` for the seams and the shape's outline.

## 1.5 View-independent geometry

Some effects are correct from every position because they are intersections of 3D shapes with the real walls (a 3D plane sweeping through the room draws a line on each face that is physically "true"). Mark these scenes `view_independent = True`. They play well when visitors are not at the sweet spot.

**In skyd:** Scenes drawn only on the surfaces (scanning planes, water fill, breakout bricks, neon set) are correct from anywhere.

## 1.6 Virtual ledges

Thin horizontal surfaces in room space attached to the walls (shelves, sills, a virtual floor line near the bottom of the projected area). Physics objects collide with them, and they get drawn in the `on` zone with a top highlight and an under-shadow. Several scenes need something for objects to land on.

**In skyd:** `ledgeBox()`, `ledgeHit()`, `ledgeUnderShadow()`, `shadeLedge()`: three ledges scaled to the shape.

## 1.7 Minimal physics

Spheres and points only: gravity, bounce restitution, friction, collisions against the three face planes and the ledges. Fixed timestep (120 Hz substeps), deterministic so `bake` produces the same result every run. No physics library.

**In skyd:** Closed-form or 120 Hz fixed-step physics, run once per frame on the CPU in [`sims.c`](../../pi-mapper/skyd/sims.c) and passed to the shader as uniforms. Deterministic.

## 1.8 Additive volumetric beam

A cone or sheet of light in the `front` zone, rendered additively with a soft falloff, plus its footprint on the faces (brighter where it hits). Keep peak brightness low so ContentGuard stays quiet.

**In skyd:** Spotlight reveal: the cone's footprint on the surfaces, plus the beam in the air from the closest approach between the view ray and the beam axis.

## 1.9 Recursive render

Render the corner's own output into a texture and draw it back into a smaller portal at the vertex, N levels deep (default 5). Used for the infinite-corner effect.

**In skyd:** Infinite corner: each level is the room turned and scaled about the vertex and ray-traced directly; no render-to-texture.

## 1.10 Physics upgrades (extend 1.7)

- **Gravity vector** as an animatable uniform, not a constant. Scenes can tween it between face normals.
- **Face planes as colliders by default**: ceiling, left wall, right wall, with per-face restitution and friction.
- **Box and capsule bodies** in addition to spheres, with simple rotation (no stacking stability beyond "good enough to look right"; settle bodies to sleep when slow).
- **Bounds**: bodies that leave the projected extents of all faces are removed, or wrapped back in by the scene.
- Still deterministic, fixed 120 Hz substeps.

**In skyd:** Gravity carousel: gravity is a uniform that tweens between face normals; spheres and blocks collide with the faces and each other.

## 1.11 Portal pairs

Two portals on different faces linked so a body entering one comes out the other with its velocity rotated into the exit face's frame. Each portal has a visible rim (thin ring on the face, `on` zone) and a dark interior (`behind` zone).

**In skyd:** Portal juggle: rim and dark interior on the face; balls behind the face show through the hole.

## 1.12 Contact cues

On each collision with a face: a short bright flash or ring at the contact point on the face (`on` zone), scaled by impact speed. Contact points on the real walls are view-independent, so this cue helps people off the sweet spot follow the motion. Expose an event hook so scenes can trigger sounds or ContentGuard-safe flashes on impact.

**In skyd:** Breakout and juggle: rings and flashes at contact points, which read from anywhere.
