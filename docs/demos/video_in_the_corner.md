# Video in the corner

| | |
| --- | --- |
| Status | Built |
| Shader | [`video.frag`](../../pi-mapper/skyd/video.frag) + [`skyd.c`](../../pi-mapper/skyd/skyd.c) |
| Loop | not in a loop |
| Duration | length of the video |
| Render resolution | full |
| Frame rate on a Pi Zero 2 W | about 26 fps |
| Correct from anywhere in the room | no, best from the sweet spot |

## As built

Plays a video file from the Pi on a thin screen floating in the middle of the corner, facing the viewer. It grows out of the vertex, bobs and sways, casts a shadow and spills its colours onto the walls. ffmpeg decodes in real time to YUV frames read by a thread in skyd; audio goes to the projector over HDMI. Chosen from the Video tab; returns to the previous scene when it ends.

## Viewing notes

> "Create a video player so we can select a video from a folder on the Pi to play inside the cube that defines the demos... placed in the center almost like one of the cubes we see in a demo. It should have a floating in the cube effect."

Built as described.
