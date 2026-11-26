# Corner demos

One file per demo: a projector covering a room corner (two walls and the ceiling), with live scenes rendered for the viewer's point of view. Each file has the original brief, what was built, and the notes from watching it in the room. Use them as a starting point for your own.

- [Building blocks](building_blocks.md): the shared techniques.
- [Demo loops](demo_loops.md): how scenes are sequenced, planned and as built.
- [Scene template](scene_template.md): copy it to write up a new scene.
- [Scene design lessons](../guides/scene_design_lessons.md): what made the best scenes work. **Read this first.**

## Built

| Demo | Loop | Pi Zero 2 W | Correct from anywhere |
| --- | --- | --- | --- |
| [Corner flip](corner_flip.md) | Loop 1 | about 20 fps | mostly |
| [Window into a bigger room](window.md) | Loop 1 | about 26 fps | no |
| [Membrane push](membrane_push.md) | Loop 1 | about 30 fps | no |
| [Cube break-out](cube_break_out.md) | Loop 1 | about 26 fps | partly |
| [Relief panels](relief_panels.md) | Loop 1 | about 27 fps | partly |
| [Water fill](water_fill.md) | Loop 1 | — | yes |
| [Scanning planes](scanning_planes.md) | Loop 1 | about 28 fps | yes |
| [Corner spin](corner_spin.md) | Loop 1 | — | no |
| [Vortex at the vertex](vortex.md) | Loop 2 | about 42 fps | partly |
| [Bouncing balls](bouncing_balls.md) | Loop 2 | about 11 fps | no |
| [Infinite corner](infinite_corner.md) | Loop 2 | about 30 fps | no |
| [X-ray wall](x_ray_wall.md) | Loop 2 | about 29 fps | yes |
| [Spotlight reveal](spotlight_reveal.md) | Loop 2 | about 30 fps | partly |
| [Puzzle cube](puzzle_cube.md) | Loop 2 | about 28 fps | no |
| [Pin screen](pin_screen.md) | Loop 2 | about 17 fps | no |
| [String art](string_art.md) | Loop 2 | about 21 fps | partly |
| [Snowfall with build-up](snowfall.md) | Loop 2 | about 20 fps | no |
| [Liquid metal](liquid_metal.md) | Loop 2 | about 25 fps | no |
| [Gravity carousel](gravity_carousel.md) | Loop 3 | about 30 fps | no |
| [Portal juggle](portal_juggle.md) | Loop 3 | about 20 fps | partly |
| [Marble run](marble_run.md) | Loop 3 | about 14 fps | partly |
| [Three-wall breakout](breakout.md) | Loop 3 | about 18 fps | yes |
| [Corner crawlers](crawlers.md) | Loop 3 | about 26 fps | yes |
| [Night sky](night_sky.md) | Loop 1 | about 30 fps | no |
| [Neon grid](neon_grid.md) | Neon | about 20 fps | yes |
| [Wire tunnel](wire_tunnel.md) | Neon | about 18 fps | yes |
| [Rotor grid](rotor_grid.md) | Neon | about 15 fps | yes |
| [Equalizer](equalizer.md) | Neon | about 18 fps | yes |
| [Video in the corner](video_in_the_corner.md) | not in a loop | about 26 fps | no |

## Ideas not built yet

- [Tile fall-away](tile_fall_away.md)
- [Impossible object](impossible_object.md)
- [Floating cube lattice](floating_cube_lattice.md)
- [Peel-back](peel_back.md)

## Making your own scene

1. **Write a brief** from [the template](scene_template.md): what people see, how to build it, what sells it.
   Check it against the [design lessons](../guides/scene_design_lessons.md): use all three surfaces and the
   seams, prefer effects drawn on the surfaces, respect the frame.
2. **Write the shader** as `pi-mapper/skyd/<name>.frag`. Put `@common` in the first comment line so skyd
   prepends [`common.glsl`](../../pi-mapper/skyd/common.glsl) (room coordinates, `viewRay()`, `roomHit()`,
   `maskOut()`, grids, shadows, ledges). Start by copying a small scene such as `scan.frag` or `water.frag`.
   It's GLSL ES 1.00. Uniforms you get: `u_time` (seconds since the scene started), the calibration
   (`u_campos`, `u_minv`, `u_mask`, `u_maskd`), and anything you set with `set <uniform> <values>` over
   skyd's control port.
3. **Preview it on your computer** with the WebGL harness in
   [`pi-mapper/tools/preview/`](../../pi-mapper/tools/preview/): serve the `pi-mapper` folder
   (`python3 -m http.server 8777`) and open
   `http://127.0.0.1:8777/tools/preview/preview.html?scene=<name>&t=5`. It renders the viewer's view with
   your calibration (copy `~/skyd/uniforms.txt` from the Pi next to it) or the example one. `shot.mjs` saves
   screenshots with headless Chrome. The preview catches compile errors and layout, not speed.
4. **Register it**: add `<name>:<seconds>:<scale>:<loop>` to `skydScenes` in
   `pi-mapper/cmd/projd/main.go`, and a tile for it in the Demos tab of `pi-mapper/cmd/projd/web/index.html`.
5. **Deploy and measure on the Pi.** Copy the shader to `~/skyd/` and restart projd; skyd logs each scene's
   frame rate every 10 s (`journalctl -u projd | grep fps`). Aim for 25–30 fps.
6. **Watch it in the room and write notes.** This step made the biggest difference. Add them to the scene's
   file under "Viewing notes".

### Keeping it fast on a Pi Zero 2 W

- Anything that's the same for every pixel (physics, animation state) belongs on the CPU, computed once per
  frame in skyd ([`sims.c`](../../pi-mapper/skyd/sims.c)) and passed as uniforms.
- Loop over at most about 6 objects. The GPU compiler silently draws nothing beyond that.
- Avoid `continue` and long ternary chains in loops.
- Return black for pixels outside the shape (`maskOut() > 0`) before doing any other work.
- Render heavy scenes at half resolution or less (the scale field in `skydScenes`).
