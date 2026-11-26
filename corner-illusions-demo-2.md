# Corner Illusions Demo Loop, Part 2: 10 More Scenes

Handoff doc for Claude Code. Extends `corner-illusions-demo.md`. Uses the same shared building blocks (depth zones and portals, projected shadows, one light rig, room grid, view-independent flag). Section numbers continue from Part 1 (2.13 onward).

## 1. New shared building blocks

### 1.6 Virtual ledges
Thin horizontal surfaces in room space attached to the walls (shelves, sills, a virtual floor line near the bottom of the projected area). Physics objects collide with them, and they get drawn in the `on` zone with a top highlight and an under-shadow. Several scenes need something for objects to land on.

### 1.7 Minimal physics
Spheres and points only: gravity, bounce restitution, friction, collisions against the three face planes and the ledges. Fixed timestep (120 Hz substeps), deterministic so `bake` produces the same result every run. No physics library.

### 1.8 Additive volumetric beam
A cone or sheet of light in the `front` zone, rendered additively with a soft falloff, plus its footprint on the faces (brighter where it hits). Keep peak brightness low so ContentGuard stays quiet.

### 1.9 Recursive render
Render the corner's own output into a texture and draw it back into a smaller portal at the vertex, N levels deep (default 5). Used for the infinite-corner effect.

## 2. Scenes

### 2.13 Vortex at the vertex, 15 s
**Sees**: the room grid starts to spiral into the vertex as if a black hole has opened in the corner. Lines stretch and bend around it, then it collapses and the grid snaps back.
**Build**: room grid in room space, vertices displaced with a rotational swirl and radial pull centered on the vertex, strength ramping up and down. A small black disc at the vertex with a bright thin ring (`front` zone). Optional particle streaks sucked in along the seams.
**Note**: works fairly well off the sweet spot because the motion is so strong.

### 2.14 Bouncing balls, 20 s
**Sees**: balls drop out of a portal in the ceiling, bounce off ledges on the walls, roll along them, fall off the ends and leave the projected area.
**Build**: physics (1.7) plus ledges (1.6). Balls spawn on beats. Each ball casts a shadow (1.2) that tightens and darkens as it gets close to a ledge or wall, which is the main depth cue. A small squash on impact.
**Note**: the shadow-to-ball distance is what sells the 3D. Tune it before anything else.

### 2.15 Infinite corner, 15 s
**Sees**: a smaller copy of the corner opens at the vertex, with another inside it, receding without end. The camera then seems to fly into it.
**Build**: recursive render (1.9) in a portal at the vertex, each level scaled and slightly rotated. Animate a zoom so each level grows to replace its parent, which loops seamlessly.
**Note**: the zoom loop makes a good transition since it can end at any state.

### 2.16 X-ray wall, 20 s
**Sees**: a scan band sweeps across the walls and ceiling and shows what is "inside" them: studs, ceiling joists, electrical conduit, a junction box, pipes, with a slight blueprint look.
**Build**: a `behind` scene with a simple procedural wall cavity layout (studs at 16 in centers, joists along the ceiling, one or two conduit runs that turn across seams). Seen through a moving portal shaped as the scan band. Blueprint or thermal palette, configurable.
**Note**: the conduit runs crossing the seams and the studs lining up across a wall sell it. Keep the layout believable rather than busy.

### 2.17 Spotlight reveal, 15 s
**Sees**: the corner goes dark. A spotlight beam sweeps around and wherever it hits, hidden relief shows (carved patterns, embossed shapes, or the X-ray cavity from 2.16).
**Build**: volumetric beam (1.8) driven by a slow Lissajous path. The footprint acts as a soft portal mask onto a hidden layer. Hidden layer shading uses the beam as its light source so the relief shadows move with the beam.
**Note**: strong opener for a dark room. Low average brightness by design.

### 2.18 Twisty puzzle cube corner, 20 s
**Sees**: the corner reads as the outside corner of a big 3x3 puzzle cube, then its layers rotate, and each turn scrambles the colored squares across all three faces.
**Build**: reuse the convex cube from 2.1 split into 27 cubies (only the visible ones need geometry). Animate layer rotations around the three axes, timed to downbeats, with a short ease. Colors: a plain six-color set, no branding, no logo on a center square.
**Note**: needs the sweet spot. Pair it after the corner flip so the "cube" reading is already established.

### 2.19 Pin screen, 20 s
**Sees**: the walls become a dense field of pins that push out of the surface in waves, ripples from the vertex, and shapes like a hand pressing from behind.
**Build**: instanced short cylinders on a grid per face (cap counts per config for Pi 5, start at 24x24 per face). Each pin's extrusion comes from a height function: ripples, traveling waves, or a heightmap (a pressed shape). Lit by the light rig with shadows between pins (cheap ambient occlusion from the heightmap is enough).
**Note**: the membrane push (2.4) and this share the height-function interface. Write one.

### 2.20 String art, 20 s
**Sees**: taut colored threads stretch across the space between points on the walls and ceiling, forming curved 3D surfaces (hyperboloids, twisted sheets) that rotate slowly and change color on beats.
**Build**: line segments in room space between anchor points on the three faces (`front` zone), rendered from the viewer camera. Anchor points slide along the seams and edges over time, which makes the ruled surfaces twist. Small bright dots at the anchors on the walls.
**Note**: very cheap, very 3D from the sweet spot, and the anchors on the walls stay correct from anywhere.

### 2.21 Snowfall with build-up, 25 s
**Sees**: snow falls in the space in front of the corner, drifting and catching light. It settles on the ledges and on the tops of relief panels, building up visible white ridges, then melts away.
**Build**: point particles (1.7) with wind noise, depth-sorted, size and blur by distance from the viewer. Particles that hit a ledge add to a per-ledge height buffer drawn as a soft white bump. Melt by decaying the buffers.
**Note**: fits a December show. Limit particle count on Pi 5 (start at 1500).

### 2.22 Liquid metal drip, 20 s
**Sees**: a chrome bead forms on the ceiling near the vertex, stretches, drips onto a ledge, pools, then flows along the seam and drips again.
**Build**: metaballs evaluated in a small 3D grid near the drip path, shaded with a fake environment map (a blurred gradient, no image assets) plus one sharp highlight from the light rig. Drops follow 1.7 physics, and pools are flattened metaballs on ledges.
**Note**: the most expensive scene here. Render the metaball pass at half resolution and upscale.

## 3. Second demo loop

`examples/illusions-demo-2.yaml`, about 3.5 minutes, loops forever. Same rules as Part 1: alternate heavy and light scenes and chain the transitions.

| # | Scene | Into next via |
|---|---|---|
| 1 | Spotlight reveal (2.17) | beam widens to full light on the hidden layer |
| 2 | X-ray wall (2.16) | cavity fades, ledges stay |
| 3 | Bouncing balls (2.14) | last ball rolls into vertex |
| 4 | Vortex (2.13) | collapse snaps to flat grid |
| 5 | Pin screen (2.19) | pins settle flat into a cube shading |
| 6 | Twisty puzzle cube (2.18) | cube solves, fades to anchor dots |
| 7 | String art (2.20) | threads cut, anchors drip |
| 8 | Liquid metal drip (2.22) | metal pools turn white and cool |
| 9 | Snowfall (2.21) | melt to black |
| 10 | Infinite corner (2.15) | zoom lands on spotlight start |

Add a `playlist` option so the show can alternate between the Part 1 loop and this one, or shuffle scenes (shuffle uses crossfades, since chained transitions assume a fixed order).

## 4. Implementation order

1. Ledges (1.6) and physics (1.7), then bouncing balls (2.14) to tune shadows and bounce.
2. String art (2.20), vortex (2.13): cheap wins.
3. Height-function interface shared with 2.4, then pin screen (2.19).
4. Beam (1.8), spotlight (2.17), X-ray wall (2.16).
5. Recursive render (1.9), infinite corner (2.15).
6. Twisty puzzle cube (2.18) on top of the 2.1 cube.
7. Snowfall (2.21), liquid metal (2.22).
8. Demo loop 2, playlist option, Pi 5 performance pass.

## 5. Acceptance

Same as Part 1, plus:
- Physics scenes bake identically on two runs (compare frame hashes of the first 300 frames).
- Pin screen, snowfall and liquid metal each have quality presets (`low`, `medium`, `high`) and `low` holds 30 fps on Pi 5 at 1280x720.
- No image or texture assets are added. Everything is procedural.
