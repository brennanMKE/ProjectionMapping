# Demo loops

How the scenes are sequenced. The briefs planned three loops with chained transitions; what was built plays the scenes with a 0.6 s fade between them (chained transitions are not built).

## As built

Playlists, chosen on the web UI's Demos tab:

| Playlist | Scenes |
| --- | --- |
| Loop 1 | scanning planes, membrane push, cube break-out, corner flip, window, relief panels, water fill, corner spin, night sky |
| Loop 2 | spotlight reveal, X-ray wall, bouncing balls, vortex, pin screen, puzzle cube, string art, liquid metal, snowfall, infinite corner |
| Loop 3 | marble run, breakout, gravity carousel, portal juggle, crawlers |
| Neon | neon grid, wire tunnel, rotor grid, equalizer |
| All loops | everything above, in order (about 9 minutes) |
| Shuffle | any scene, at random |
| Top 12 | the scenes starred in the web UI, in the order they were starred |

The scene list, durations, render scale and loop of each scene are in `skydScenes` in [`pi-mapper/cmd/projd/main.go`](../../pi-mapper/cmd/projd/main.go) (`name:seconds:scale:loop`).

## Planned: Part 1

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

### Implementation order (Part 1)

1. Depth zones and portals (1.1), refactor the sphere onto it.
2. Projected shadows (1.2) and light rig (1.3).
3. Room grid (1.4), scanning plane (2.8), membrane push (2.4).
4. Corner flip (2.1), window (2.2), tile fall-away (2.3).
5. Relief panels (2.6), water fill (2.7).
6. Impossible object (2.9), cube lattice (2.10), peel-back (2.11), corner spin (2.12).
7. Chain transitions and the demo show file.
8. Pi 5 performance pass on the whole loop at 1280x720, 30 fps. Cube lattice and tile fall-away are the likely hot spots: cap instance counts in config.

### Acceptance (Part 1)

- Every scene runs at 30 fps on Pi 5 at 1280x720, or has a documented quality setting that does.
- The loop runs for 1 hour with no memory growth and no visible stutter at the loop point.
- ContentGuard warnings: none during the loop, except intentional short peaks (allow scenes to declare a brief `guard_exempt` window, max 1 s).
- From the sweet spot, the sphere, corner flip, window and impossible object read as 3D. From other positions, the scanning plane and water fill still look correct.
- Each scene has a `--solo <scene>` preview for tuning, with keys to scrub time and move the virtual light.

## Planned: Part 2

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

### Implementation order (Part 2)

1. Ledges (1.6) and physics (1.7), then bouncing balls (2.14) to tune shadows and bounce.
2. String art (2.20), vortex (2.13): cheap wins.
3. Height-function interface shared with 2.4, then pin screen (2.19).
4. Beam (1.8), spotlight (2.17), X-ray wall (2.16).
5. Recursive render (1.9), infinite corner (2.15).
6. Twisty puzzle cube (2.18) on top of the 2.1 cube.
7. Snowfall (2.21), liquid metal (2.22).
8. Demo loop 2, playlist option, Pi 5 performance pass.

### Acceptance (Part 2)

Same as Part 1, plus:
- Physics scenes bake identically on two runs (compare frame hashes of the first 300 frames).
- Pin screen, snowfall and liquid metal each have quality presets (`low`, `medium`, `high`) and `low` holds 30 fps on Pi 5 at 1280x720.
- No image or texture assets are added. Everything is procedural.

## Planned: Part 3

Add these as a third loop, `examples/illusions-demo-3.yaml`, about 2 minutes:

| # | Scene | Into next via |
|---|---|---|
| 1 | Corner marble run (2.25) | last marble exits, track disassembles into bricks |
| 2 | Three-wall breakout (2.26) | final brick fragments land as a pile on the left wall |
| 3 | Gravity carousel (2.23) | bodies fall into three portals |
| 4 | Portal juggle (2.24) | balls drop out, portals close into crawler anchors |
| 5 | Corner crawlers (2.27) | crawlers carry a marble to the ceiling, run restarts |

Also slot the bouncing balls (2.14) into this loop after the marble run if it fits the music. Include all three loops in the playlist option.

### Implementation order (Part 3)

1. Physics upgrades (1.10) and contact cues (1.12).
2. Gravity carousel (2.23): best test of the upgrades.
3. Portal pairs (1.11) and portal juggle (2.24).
4. Three-wall breakout (2.26).
5. Corner marble run (2.25): start with spline paths, try physics on tracks after.
6. Corner crawlers (2.27).
7. Loop 3 and Pi 5 performance pass.

### Acceptance (Part 3)

Same as Parts 1 and 2, plus:
- Gravity carousel: bodies settle on each face within 1.5 s of a swing ending, no jitter.
- Portal juggle: no misses over a 5 minute run.
- Marble run: marbles complete the track every time across 50 consecutive runs in a bake.
- Crawlers cross a seam at least once every 3 s on average across the group.
