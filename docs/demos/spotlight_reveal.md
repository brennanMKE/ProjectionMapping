# Spotlight reveal

| | |
| --- | --- |
| Status | Built |
| Shader | [`spotlight.frag`](../../pi-mapper/skyd/spotlight.frag) |
| Loop | Loop 2 |
| Duration | 15 s |
| Render resolution | half |
| Frame rate on a Pi Zero 2 W | about 30 fps |
| Correct from anywhere in the room | partly |

## Brief

From the corner illusions brief, part 2, section 2.17 ("Spotlight reveal, 15 s").

**Sees**: the corner goes dark. A spotlight beam sweeps around and wherever it hits, hidden relief shows (carved patterns, embossed shapes, or the X-ray cavity from 2.16).
**Build**: volumetric beam (1.8) driven by a slow Lissajous path. The footprint acts as a soft portal mask onto a hidden layer. Hidden layer shading uses the beam as its light source so the relief shadows move with the beam.
**Note**: strong opener for a dark room. Low average brightness by design.

## As built

The corner is dark. A spotlight sweeps on a slow Lissajous path; where it lands, hidden carved relief (rosettes, rings, diamonds) shows, lit by the beam so its shadows move with it. The beam is visible in the air. Ends with the beam widening to light everything.
