# Track B: ofxPiMapper on a Raspberry Pi 5

**Status: not run yet.** This is the runbook for a time-boxed attempt (suggest
one evening) on the second Pi. Fill in the Results section as you go. Stop at
the first wall that needs more than a small patch, and write down what failed.

Background (verified when the brief was written):
- The ofxPiMapper prebuilt image supports only up to the Pi 3B+. The addon
  itself is plain openFrameworks C++ (github.com/kr15h/ofxPiMapper) and was
  last tested against oF 0.11.0.
- openFrameworks supports the Pi 5 on 64-bit Pi OS (Trixie) with the
  `linuxaarch64` package. On Trixie, `install_dependencies.sh` asks for
  `libgconf-2-4`, which no longer exists (oF issue #8480).

## 1. Fresh card

Raspberry Pi OS 64-bit (Trixie, desktop). Don't reuse the Track A card.

```sh
sudo apt update && sudo apt full-upgrade -y
uname -m          # aarch64
```

## 2. openFrameworks (linuxaarch64)

Follow openframeworks.cc/setup/raspberrypi/raspberry-pi-getting-started/ and
take the current `linuxaarch64` release from openframeworks.cc/download.

```sh
cd ~
# replace URL/version with the current linuxaarch64 release
wget https://github.com/openframeworks/openFrameworks/releases/download/<ver>/of_v<ver>_linuxaarch64_release.tar.gz
tar xzf of_v*_linuxaarch64_release.tar.gz
mv of_v*_linuxaarch64_release openFrameworks
cd openFrameworks/scripts/linux/debian

# Trixie workaround: drop libgconf-2-4 from the apt-get line
sed -i 's/libgconf-2-4//g' install_dependencies.sh
sudo ./install_dependencies.sh

cd ../ && ./compileOF.sh -j4
```

Record: oF version, any other missing packages.

## 3. Prove GL works

```sh
cd ~/openFrameworks/examples/graphics/polygonExample
make -j4 && make RunRelease
```

Also try `examples/video/videoPlayerExample` with one of our clips
(`face-a.mp4`, then `face-a.hevc.mp4`) to see the GStreamer path's decode
performance before ofxPiMapper is involved. Watch `htop`.

## 4. ofxPiMapper

```sh
cd ~/openFrameworks/addons
git clone https://github.com/kr15h/ofxPiMapper.git
cd ofxPiMapper/example_basic
make -j4 2>&1 | tee ~/ofxpimapper-build.log
```

Expected trouble spots and what to try:

| Symptom | Likely cause | Try |
|---|---|---|
| Errors in OMX / `ofxOMXPlayer` code | Legacy Pi video path | Make sure `TARGET_RASPBERRY_PI` isn't defined for this build, or patch the `#ifdef`s so the generic `ofVideoPlayer` (GStreamer) path is used |
| EGL / `bcm_host.h` / dispmanx errors | Old Broadcom GL stack code | Same: the Pi 5 uses Mesa (V3D) like desktop Linux. Use the desktop GL path. |
| oF API errors (0.11 → current) | Addon written against oF 0.11.0 | Fix call sites one by one; note each in the diff |
| GLSL version errors | GLES2 shaders vs desktop GL / GLES3 | Check `ofGLESWindowSettings` vs `ofGLWindowSettings` in `main.cpp` |

Keep patches in a fork branch (e.g. `pi5-aarch64`) or save them as
`docs/guides/ofxpimapper_pi5.patch` here (`git diff > …`).

## 5. If it runs, test

1. Quad surface with a video source (`face-a.mp4`, then the HEVC version)
2. Grid warp surface
3. FBO source (one of the example FBO sources)

For each, record fps (ofxPiMapper shows it, or add `ofGetFrameRate()`),
CPU from `~/pi-mapper/scripts/record-stats.sh 300 5` (copy the script over),
and temperature.

## Results

_Fill in._

- Date / Pi OS image / oF version:
- Built? Which steps failed, and the exact errors:
- Patches (link to the diff or branch):
- Video: H.264 1080p fps / CPU %, HEVC 1080p fps / CPU %:
- Same clips in Track A (browser) for comparison:
- Verdict: worth continuing? What would it take?
