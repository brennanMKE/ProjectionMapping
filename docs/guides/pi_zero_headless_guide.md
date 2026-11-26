# Headless projection mapping on a Pi Zero 2 W: test guide

Nov 25, 2026

This guide checks whether a Pi Zero 2 W can project a corner-pinned video over HDMI with no desktop and no web browser. mpv plays the video straight to the display with hardware H.264 decoding, and a small script warps the picture onto four corners you move from your Mac over SSH. If it holds a smooth frame rate at 720p, it is a sound base for a dedicated mapping app with a web control page served from the Pi.

None of this has been run on a Zero 2 W yet. The warp math is tested; the mpv shader and the hardware decoding are what this guide finds out.

## What you need

**Hardware**

- Raspberry Pi Zero 2 W
- microSD card, 8 GB or larger
- 5 V 2.5 A micro-USB power supply (the official Zero supply)
- Mini-HDMI to HDMI cable or adapter (the Zero has mini-HDMI, not micro-HDMI)
- The projector
- Optional: a small heatsink. The Zero 2 W throttles at 80 °C.

**On the Mac**

- Raspberry Pi Imager: `brew install --cask raspberry-pi-imager`
- ffmpeg, to make test clips (already installed)
- The `pi-mapper` folder. The helper script is `pi-mapper/headless/cornerpin.py`.
- An SSH key in `~/.ssh` (check with `ls ~/.ssh/*.pub`)

**Network**

- 2.4 GHz Wi-Fi that the Mac is also on. The Zero 2 W has no 5 GHz radio.

## 1. Flash the card

Use the Lite image: it boots to a text console, so nothing else competes for the display or the 512 MB of RAM.

1. Open Raspberry Pi Imager.
2. **Device:** Raspberry Pi Zero 2 W.
3. **OS:** Raspberry Pi OS (other) → **Raspberry Pi OS Lite (64-bit)**.
4. **Storage:** the microSD card.
5. Click **Next**, then **Edit settings**:
   - Hostname: `pizero`
   - Username and password: your choice (the steps below write `<user>`)
   - Wireless LAN: your 2.4 GHz network and country
   - Locale: your time zone
   - Services tab: **Enable SSH** → **Allow public-key authentication only**, and paste your public key (`cat ~/.ssh/id_ed25519.pub`, or whichever `.pub` you have)
6. Save, write the card, and put it in the Zero.
7. Connect the projector to the Zero's mini-HDMI port, turn the projector on, then plug in power.

**Power:** plug into the micro-USB port labelled **PWR IN** (at the end of the board). The middle port, **USB**, is data only.

The projector's USB-A port may work as the power source, but it is often limited to 0.5–1 A and may switch off in standby. The Zero 2 W can draw close to 1 A while decoding. After boot, run `vcgencmd get_throttled`: `throttled=0x0` means power is fine. Anything else (for example `0x50005`) means undervoltage, so use a 5 V 2.5 A supply for the tests below.

The first boot resizes the card and joins Wi-Fi. Allow 2 to 3 minutes. The projector should show a text login prompt.

## 2. First boot checks

These confirm the Zero sees the projector and has a hardware video decoder before you install anything. From the Mac:

```sh
ssh <user>@pizero.local
sudo apt update && sudo apt full-upgrade -y
sudo reboot
```

SSH in again, then run each check:

```sh
tr -d '\0' < /proc/device-tree/model; echo     # Raspberry Pi Zero 2 W Rev 1.0
uname -m                                       # aarch64
free -h                                        # about 420 Mi total
groups                                         # should include video and render
vcgencmd get_throttled                         # throttled=0x0

# HDMI: should print "connected", then the modes the projector offers
cat /sys/class/drm/card*-HDMI-A-1/status
cat /sys/class/drm/card*-HDMI-A-1/modes

# Hardware decoder: look for bcm2835-codec-decode
for d in /sys/class/video4linux/video*; do echo "$d: $(cat $d/name)"; done

# Memory the decoder and GPU share (CMA)
grep -i cma /proc/meminfo
```

Write down the projector's **native resolution**. Most cheap projectors are 1280×720 or lower even when they accept 1080p. Its spec sheet says "native"; the `modes` list only shows what it accepts.

If HDMI shows `disconnected`, plug the projector in and turn it on before powering the Zero, then reboot.

## 3. Play video straight to HDMI

The goal of this step is smooth playback with the hardware decoder in use, before any warping.

**On the Mac**, make a 720p test clip and copy it to the Zero with the helper script:

```sh
cd path/to/ProjectionMapping/pi-mapper
ffmpeg -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=30" \
  -an -c:v libx264 -profile:v high -pix_fmt yuv420p -g 60 -movflags +faststart test720.mp4
scp test720.mp4 headless/cornerpin.py <user>@pizero.local:~/
```

For your own footage, `scripts/encode.sh h264-720 yourclip.mov` writes a matching file into `media/`.

**On the Zero**, install mpv and play the clip:

```sh
sudo apt install -y mpv

mpv --vo=gpu --gpu-context=drm --drm-connector=HDMI-A-1 --drm-mode=1280x720 \
    --hwdec=v4l2m2m-copy --keepaspect=no --loop --no-audio --no-osc \
    --input-ipc-server=/tmp/mpv.sock ~/test720.mp4
```

Set `--drm-mode` to the projector's native resolution from step 2. Leave this terminal running; Ctrl-C stops mpv.

What to check:

- [ ] The test pattern fills the projected image and the counter moves smoothly.
- [ ] mpv's output includes `Using hardware decoding (v4l2m2m-copy)`. If it doesn't, stop it and try `--hwdec=drm`, then `--hwdec=auto-copy`. Note which one worked.
- [ ] No `Dropped` frame counts climbing in the status line.

If `--vo=gpu` fails to start, try `--vo=drm`. That confirms decoding and HDMI output, but it can't run the warp shader in the next step.

## 4. Warp the picture onto four corners

`cornerpin.py` writes a small GLSL shader that maps each projected pixel back into the video and paints everything outside the four corners black. It hands the shader to the running mpv through the socket from step 3. It uses only Python's standard library, which Lite already has.

With mpv still playing, open a **second** terminal on the Mac:

```sh
ssh <user>@pizero.local
chmod +x ~/cornerpin.py
export SCREEN=1280x720          # same as --drm-mode
~/cornerpin.py set 200 100 1080 160 1000 620 280 680
```

The four pairs are pixel positions for corners 1 to 4: top-left, top-right, bottom-right, bottom-left. The picture should now be a skewed quadrilateral on a black background.

- [ ] The video is warped, and the area outside it is black.
- [ ] Playback is still smooth.
- [ ] Corner 1 (200, 100) is at the top left. If the warp comes out upside down, run `export FLIP_Y=1` and repeat the `set` command.

Back to the full picture: `~/cornerpin.py reset`.

If nothing changes, run `~/cornerpin.py shader > /tmp/test.glsl`, stop mpv, and start it again with `--glsl-shaders=/tmp/test.glsl` added. mpv then prints the shader error, if there is one.

## 5. Line it up on an object

This is the real test: fit the picture to a box face or a wall panel from the Mac's keyboard. Point the projector at the object, then in the second terminal:

```sh
~/cornerpin.py edit
```

| Key | Action |
| --- | --- |
| 1 2 3 4 | Pick a corner: top-left, top-right, bottom-right, bottom-left |
| a | Move all four corners together |
| Arrow keys | Move the selected corner by the step size |
| + and - | Double or halve the step (0.5 to 100 px, starts at 10) |
| r | Reset to the full screen |
| q | Save and quit |

Corners save to `~/cornerpin.json`. After restarting mpv, run `~/cornerpin.py apply` to load them again.

- [ ] Each key press moves the projected corner with no visible lag.
- [ ] The picture stays smooth while you adjust.
- [ ] After quitting and running `apply`, the picture returns to the same place.

This keyboard editor stands in for the web control page a finished app would serve from the Zero.

## 6. Measure it

Let a warped clip play for 10 minutes and record the numbers below. In the second terminal:

```sh
~/cornerpin.py stats
```

It prints every 2 seconds: the decoder in use (`hwdec-current`), the video frame rate, the display rate, dropped frames, CPU temperature and load average. For CPU use per process, run `top` in a third terminal and read mpv's `%CPU` (100% = one of the four cores). Then check for throttling:

```sh
vcgencmd get_throttled     # throttled=0x0 means no undervoltage or heat throttling
```

Fill in one row per test:

| Test | Decoder | fps | Dropped after 10 min | mpv CPU % | Max temp °C | Throttled |
| --- | --- | --- | --- | --- | --- | --- |
| 720p30 H.264, no warp |  |  |  |  |  |  |
| 720p30 H.264, warped |  |  |  |  |  |  |
| 1080p30 H.264, warped |  |  |  |  |  |  |
| 720p30, software decode (`--hwdec=no`) |  |  |  |  |  |  |

For the 1080p row, copy `media/face-a.mp4` from the Mac and start mpv with `--drm-mode=1920x1080`, if the projector accepts it.

**Pass:** the warped 720p row shows 30 fps, a dropped count that stops climbing, and `throttled=0x0`.

## Troubleshooting

| Symptom | Try |
| --- | --- |
| `ssh: Could not resolve hostname pizero.local` | Wait another minute. Check the Zero joined 2.4 GHz Wi-Fi (the router's client list shows its IP), then use the IP instead. |
| mpv: `Failed to acquire DRM master` or `Failed to open DRM device` | Another mpv may still be running: `pkill mpv`. Check that `groups` lists `video` and `render`. As a last resort, run mpv with `sudo`. |
| No `Using hardware decoding` line | Try `--hwdec=drm`, then `--hwdec=auto-copy`. If none work and step 2 showed less than 128 MB of CMA, edit `/boot/firmware/config.txt`, change `dtoverlay=vc4-kms-v3d` to `dtoverlay=vc4-kms-v3d,cma-256`, and reboot. |
| Smooth without the warp, stutters with it | The GPU is the bottleneck. Use a lower `--drm-mode` (720p, or the projector's native mode if lower), and add `--profile=fast`. |
| Black bars, or the picture doesn't fill the screen | Keep `--keepaspect=no`, and match `--drm-mode` and `SCREEN` to each other. |
| `cornerpin.py`: `cannot reach mpv` | mpv must be running with `--input-ipc-server=/tmp/mpv.sock`, or set `MPV_SOCKET` to the path you used. |
| `set` returns success but nothing changes | Load the shader at startup to see mpv's error (end of step 4). Report the message and the output of `mpv --version`. |
| Warp comes out upside down | `export FLIP_Y=1`, then run `cornerpin.py apply`. |
| `throttled=0x50005` or similar | Undervoltage: use the official 2.5 A supply and a short cable, not the projector's USB port. |
| Temperature above 80 °C | Add a heatsink, and keep the Zero out of the projector's exhaust. |
| Zero reboots or loses power when the projector goes to standby | The projector's USB port switches off in standby. Use a separate supply. |

## Next steps

If the warped 720p test passes, this becomes a dedicated app with no browser on the Pi:

1. A systemd service starts mpv on boot with the saved corners. No login and no desktop are needed.
2. The Go server from `pi-mapper` runs on the Zero, without its projector page. It serves the control page to your phone or laptop and sends corner changes and cues (play, pause, next clip, blackout) to mpv over the same socket.
3. Later, if you need several surfaces or images, a small native renderer replaces mpv. It uses OpenGL directly with mpv's library for video.

If it fails, the results table shows where: decoding (try the Pi 5's HEVC decoder), the GPU warp (lower the resolution), or heat and power. Send me the table and any mpv errors, and I'll adjust the plan.
