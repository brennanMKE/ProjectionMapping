# Tile fall-away

| | |
| --- | --- |
| Status | Not built yet |
| Suggested duration | 20 s |

## Brief

From the corner illusions brief, part 1, section 2.3 ("Tile fall-away, 20 s").

**Sees**: the walls break into square tiles that come loose one by one, tumble toward the viewer and fall to the floor, revealing a void behind.
**Build**: room grid (1.4) cells become thin boxes. Each tile is `on` until it detaches, then `front` while it falls with simple gravity and rotation. The revealed area becomes a portal onto the `behind` void. Shadows from 1.2 on remaining tiles. Order the detachment from the vertex outward.
**Note**: reverse it to rebuild the walls as a transition into the next scene.

## Building it

Start from the [building blocks](building_blocks.md) and the [design lessons](../guides/scene_design_lessons.md). See [making a scene](README.md#making-your-own-scene).
