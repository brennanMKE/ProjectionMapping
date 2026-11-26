# Corner Illusions Demo Loop: Build Spec

Handoff doc for Claude Code. Adds a set of illusion scenes to the corner mapper and a looping demo show. It builds on the existing anamorphic pipeline (viewer camera, per-face homographies) and the spinning sphere scene that grows out of its defined space.

## 1. Shared building blocks

Build these first. Most scenes below are combinations of them.

### 1.1 Depth zones

Each object or surface in an anamorphic scene belongs to one zone:

- **behind**: beyond the wall planes. Visible only through a **portal** (a cutout region drawn on a face). Outside the portal the real wall shows instead.
- **on**: lies on the wall planes (paint, shadows, cracks, panels).
- **front**: between the walls and the viewer. Always drawn on top, never clipped by portals.

Implement this as render order plus a portal stencil: draw `behind` objects masked by the portal stencil, then `on` content, then `front` objects. This is the core of the "breaks out of the box" effect: an object moves from `behind` to `front` as it crosses the portal plane, and switches from clipped to unclipped at that moment. Generalize the logic the sphere scene already uses into `corner/scenes/zones.py`.

### 1.2 Projected shadows

`cast_shadow(mesh, light, faces)`: project a mesh along the light direction onto each face plane and render the result as a soft dark shape in the `on` zone. Shadows on the walls are what sell objects in the `front` zone. Without them, front objects look flat. Use a fixed blur (shadow texture rendered at quarter resolution and blurred).

### 1.3 Virtual light rig

One `light_dir` (or point light) per scene, animatable, used by all shading and shadow code. Keeps rule 7.3 (one light source) intact.

### 1.4 Room grid

A wireframe grid aligned to the physical faces (in room space, 0.2 m spacing default). Drawing the grid first and then deforming it is the cheapest way to make people read the walls as surfaces that can change. Several scenes use it as their opening state.

### 1.5 View-independent geometry

Some effects are correct from every position because they are intersections of 3D shapes with the real walls (a 3D plane sweeping through the room draws a line on each face that is physically "true"). Mark these scenes `view_independent = True`. They play well when visitors are not at the sweet spot.

## 2. Illusion scenes

Each entry: what the viewer sees, how to build it, and notes. Durations are suggestions for the demo loop.

### 2.1 Corner flip (convex / concave), 15 s
**Sees**: the corner shaded as a normal inside corner, then the shading inverts and it pops out as a cube corner pointing at the viewer, then flips back.
**Build**: render a cube corner at the vertex in the `front` zone with one light. Crossfade between "inside corner" shading (light falls on faces as real room light would) and "outside cube" shading (ceiling brightest, walls darker). Add edge highlights on the seams for the convex state, edge shadows for the concave state.
**Note**: the flip reads best with a slow light move during the transition.

### 2.2 Window into a bigger room, 20 s
**Sees**: a rectangular portal opens on each wall and the ceiling. Behind them is a larger, deeper space (a gridded room several meters deep, or a starfield), with consistent depth across all three portals.
**Build**: portals from 1.1. The `behind` scene is one 3D environment rendered from the viewer camera, so all three windows look into the same space. Animate portals growing from the seams outward.

### 2.3 Tile fall-away, 20 s
**Sees**: the walls break into square tiles that come loose one by one, tumble toward the viewer and fall to the floor, revealing a void behind.
**Build**: room grid (1.4) cells become thin boxes. Each tile is `on` until it detaches, then `front` while it falls with simple gravity and rotation. The revealed area becomes a portal onto the `behind` void. Shadows from 1.2 on remaining tiles. Order the detachment from the vertex outward.
**Note**: reverse it to rebuild the walls as a transition into the next scene.

### 2.4 Membrane push, 15 s
**Sees**: the walls look like stretched fabric. Something presses from behind and bulges the surface toward the viewer, moving around, then pushes through near the vertex.
**Build**: room grid as a deformable mesh. Displace vertices toward the viewer with a moving Gaussian bump. Shade with normals from the displaced mesh using the light rig. The grid lines bending is what sells it.
**Note**: a good lead-in to the sphere scene. The bump becomes the sphere breaking out.

### 2.5 Sphere break-out (existing), 20 s
Keep as is. Make sure it uses 1.1 and 1.2, so the sphere casts a shadow on the walls after it crosses into the `front` zone.

### 2.6 Relief panels with moving light, 15 s
**Sees**: the flat walls become raised and recessed panels (wainscoting, hex tiles or extruded blocks), then a light sweeps across and the shadows move.
**Build**: `on` zone geometry with fake depth. Render a heightmap per face, shade it from the viewer camera with the light rig, and draw cast shadows within each panel. Animate `light_dir` in a slow arc.
**Note**: subtle but very convincing. Keep overall brightness low (rule 7.1).

### 2.7 Water fill, 20 s
**Sees**: the corner fills with water. A rising waterline appears on all three faces at once, with ripples and caustic light above it.
**Build**: a horizontal plane in room space rising along -Z. Where it meets the walls draws a waterline (view-independent). Below the line, tint blue and add a scrolling caustics texture projected from above. Add a ripple displacement on the waterline. When the water reaches the ceiling, drain it quickly.
**Note**: the waterline is view-independent. Caustics only need to look plausible.

### 2.8 Scanning plane, 15 s
**Sees**: thin bright planes of light sweep through the room. Each one draws a line where it cuts each face, and the lines stay connected across the seams.
**Build**: intersect animated 3D planes (horizontal, vertical, then tilted and rotating) with the three face planes and draw the lines. Several planes at once, tempo-driven.
**Note**: `view_independent = True`. Strong on beats, cheap to render, good as a reset between heavy scenes.

### 2.9 Impossible object, 15 s
**Sees**: a Penrose triangle (or impossible staircase) floating in the corner that looks solid and continuous from the sweet spot.
**Build**: three real beams arranged in 3D so they line up into the impossible shape only from the viewer position (the classic Perth sculpture approach). Since the camera is fixed at the viewer, this falls out of the anamorphic pipeline. Slowly rotate the light, not the object. Moving the object breaks the illusion.
**Note**: worth including precisely because it rewards standing at the sweet spot. Add a floor marker.

### 2.10 Floating cube lattice, 20 s
**Sees**: a 3D grid of small cubes that fills the space both in front of and behind the walls. It drifts slowly toward the viewer and the cubes pass through the walls.
**Build**: instanced cubes. Cubes behind the wall planes show only through a wall-sized portal (fade the walls to dark first), cubes in front are drawn freely with shadows. Depth fog to the background. Cubes light up on beats.

### 2.11 Peel-back, 15 s
**Sees**: the corner of one wall peels back like a sticker, revealing a different texture or color underneath, then the other faces peel in sequence.
**Build**: a curled quad mesh per face (cylinder-bend deformation along a moving fold line), shaded with the light rig, backside a lighter tone, casting a shadow onto the revealed surface.

### 2.12 Corner spin, 15 s
**Sees**: the whole corner seems to rotate around the vertex axis, with the walls and ceiling swapping places.
**Build**: render a virtual copy of the room box (grid plus face tint) rotating about the axis from the vertex toward the viewer, in the `on` zone so it is painted onto the real faces. Hold the real seams as faint lines so the conflict between real and virtual corner is visible.
**Note**: disorienting in a good way. Keep it short.

## 3. Demo loop

`examples/illusions-demo.yaml`. Total about 4 minutes, loops forever. The order alternates heavy illusions with lighter, view-independent resets, and chains scenes so each transition is part of the effect rather than a fade.

| # | Scene | Into next via |
|---|---|---|
| 1 | Scanning plane (2.8) | planes converge into a grid |
| 2 | Room grid hold, 4 s | grid starts bulging |
| 3 | Membrane push (2.4) | bulge breaks through |
| 4 | Sphere break-out (2.5) | sphere shrinks back into vertex |
| 5 | Corner flip (2.1) | cube faces split into tiles |
| 6 | Tile fall-away (2.3) | void revealed |
| 7 | Window into bigger room (2.2) | portals close, walls rebuild |
| 8 | Relief panels (2.6) | light dims to black |
| 9 | Water fill (2.7) | drains |
| 10 | Impossible object (2.9) | object fades, light stays |
| 11 | Floating cube lattice (2.10) | cubes recede, walls return |
| 12 | Peel-back (2.11) | last peel reveals black |
| 13 | Corner spin (2.12) | spin settles, fades to scanning planes |

Add a `chain` transition type in `timeline.py`: the outgoing scene exposes its final state (for example the deformed grid mesh or the tile layout) and the incoming scene can take it as a starting state. Fall back to a 0.5 s crossfade when a scene does not support chaining.

If the show has no audio, use a fixed 120 BPM clock so beat-driven parts still move.

## 4. Implementation order

1. Depth zones and portals (1.1), refactor the sphere onto it.
2. Projected shadows (1.2) and light rig (1.3).
3. Room grid (1.4), scanning plane (2.8), membrane push (2.4).
4. Corner flip (2.1), window (2.2), tile fall-away (2.3).
5. Relief panels (2.6), water fill (2.7).
6. Impossible object (2.9), cube lattice (2.10), peel-back (2.11), corner spin (2.12).
7. Chain transitions and the demo show file.
8. Pi 5 performance pass on the whole loop at 1280x720, 30 fps. Cube lattice and tile fall-away are the likely hot spots: cap instance counts in config.

## 5. Acceptance

- Every scene runs at 30 fps on Pi 5 at 1280x720, or has a documented quality setting that does.
- The loop runs for 1 hour with no memory growth and no visible stutter at the loop point.
- ContentGuard warnings: none during the loop, except intentional short peaks (allow scenes to declare a brief `guard_exempt` window, max 1 s).
- From the sweet spot, the sphere, corner flip, window and impossible object read as 3D. From other positions, the scanning plane and water fill still look correct.
- Each scene has a `--solo <scene>` preview for tuning, with keys to scrub time and move the virtual light.
