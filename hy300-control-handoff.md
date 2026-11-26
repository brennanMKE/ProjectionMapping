# HY300 Projector Control from a Raspberry Pi: Claude Code Handoff

## Goal

Let a Raspberry Pi blank the projector's light output on demand, and restore it on demand, for a projection mapping setup. "Off" should mean the light source is dark (not a black frame, since LCD black still glows). "On" should be fast, ideally under 2 seconds, with no Android reboot.

Secondary goal: a small Android app on the projector that exposes this control over the LAN, so the Pi does not depend on ADB long term.

## Hardware

- Projector: XBJ "Smart Mini Portable Projector" sold as YTHY Global, an HY300-family clone. Listing claims Android 12, 300 ANSI, WiFi 6, BT 5.4. These claims are unverified.
- HY300 clones vary internally. Known variants:
  - Allwinner H713 (sun50iw12p1), Android 11, A/B partitions, 32-bit userspace on arm64 kernel (most common)
  - Allwinner H726, Android 14 (newer HY300 Pro)
  - Rockchip RK3326, Android TV, TXCZ firmware (seen in one teardown)
- Ports: HDMI in, USB-A (host), 3.5mm audio, DC power. The USB-A port is a host port, so ADB over a Pi-to-projector USB cable is not expected to work. Use ADB over Wi-Fi.
- Pi: The owner has a Pi connected to the projector over USB already. **Ask the owner which Pi model and what that USB link does** (likely a Pi Zero acting as a USB HID gadget, but confirm). The Pi also likely feeds HDMI for the mapping output.

## Phase 0: Enable Developer Options (the owner does this with the remote)

The launcher's own Settings screen usually hides Developer Options. Use the hidden stock Android Settings app:

1. Home > Settings > Other > Apps
2. Find "Settings" (there are two with that name; try the first) > Open
3. About > highlight Build Number (or Version Number) > press OK 7 to 10 times
4. Back out; Developer Options now appears in that Settings app (likely under System). Enable USB debugging, and Wireless debugging if present.

Fallbacks: in the launcher's About Device screen, press OK repeatedly on the first line (firmware) or on the device name.

Sources: dev.to/fllaviacorreia "How to Enable Developer Options on the HY300 Projector"; github.com/gniax/magcubic-hy300-root; github.com/voyageauciel-01/HY300-Pro-H726-Root-Guide.

## Phase 1: Connect and probe

From the Pi (install `adb` via `sudo apt install adb`):

```
adb connect <projector-ip>:5555
```

Accept the "Allow debugging?" prompt on the projected image ("always allow"). If Wireless debugging is the only option, use `adb pair <ip>:<pairing-port>` then `adb connect <ip>:<port>`.

Write `probe.sh` that saves everything to a timestamped directory on the Pi:

- `getprop` (full dump), especially `ro.board.platform`, `ro.product.*`, `ro.build.version.release`, `ro.boot.slot_suffix`
- `adb root` result (some firmware allows it) and `id` in shell
- `ls -la /sys/class/leds/ /sys/class/backlight/` and `cat` of each `brightness`, `max_brightness`, `trigger`
- `ls /sys/class/` and grep for anything named like lcd, led, lamp, panel, fan, projector, motor, keystone
- `dumpsys power` (display state, wakefulness)
- `dumpsys display`
- `getevent -lp` (input devices, to see IR and CEC input nodes)
- `ls /vendor/usr/keylayout /system/usr/keylayout` and pull the `.kl` files
- `pm list packages -f` (find vendor services, launcher, projector OSD apps)
- `ps -A` and `service list`
- `cat /proc/cpuinfo`, `uname -a`
- check for HDMI CEC: `dumpsys hdmi_control`

Report findings to the owner before changing anything.

## Phase 2: Test non-root control

Test each and record what happens to the light source (the owner looks at it), and whether ADB still responds afterward:

```
adb shell input keyevent KEYCODE_SLEEP     # 223
adb shell input keyevent KEYCODE_WAKEUP    # 224
adb shell input keyevent KEYCODE_POWER     # 26, toggle; avoid in final design
adb shell dumpsys power | grep -i wakefulness
```

Key questions:
1. Does SLEEP turn the LED fully off, or just show black?
2. Does Wi-Fi ADB stay connected while asleep?
3. Does WAKEUP restore it, and how fast?

If 1 through 3 all pass, the non-root path is sufficient. Skip to Phase 5 and build the Pi CLI on ADB keyevents.

If the Pi is a USB HID gadget, also test HID Generic Desktop System Control usages: System Sleep (0x82), System Wake Up (0x83), System Power Down (0x81). Confirm against the pulled keylayout files that these map to SLEEP/WAKEUP/POWER. Test whether the USB port stays powered while asleep.

## Phase 3: Root (only with the owner's go-ahead)

Only if Phase 2 fails to darken the light source.

1. **Back up first.** Dump the eMMC or at least the boot partitions to the Pi or a USB stick before flashing anything. Find a matching stock firmware image (androidpctv.com hosts HY300/HY300 Pro firmware) in case recovery is needed.
2. Follow github.com/gniax/magcubic-hy300-root (H713/H726) or github.com/lolmam/HY300-H713-Research: pull `boot_a`/`boot_b` per `ro.boot.slot_suffix`, patch with Magisk, flash via fastboot.
3. Do not proceed if `fastboot getvar unlocked` says no without asking the owner.

## Phase 4: Find the light source control (root)

Look for a sysfs node that cuts the LED. On one RK3326 HY300 this was:

```
echo 0   > /sys/class/leds/Lcd_power/brightness   # off
echo 255 > /sys/class/leds/Lcd_power/brightness   # on
```

On H713 the name and path will likely differ. Candidates to try, one at a time, recording old values first so they can be restored:

- entries under `/sys/class/leds/`
- `/sys/class/backlight/*/bl_power` (write 4 for off, 0 for on) and `brightness`
- GPIO or PWM nodes referenced by vendor init scripts: grep `/vendor/etc/init/`, `/system/etc/init/`, and vendor `.rc` files for `leds`, `backlight`, `pwm`, `gpio`, `lcd`, `panel`
- vendor binaries or services the launcher calls when the remote's power button is pressed (watch `logcat` while pressing it)

Watch thermals: confirm the fan behaves when the LED is off and on. Do not leave the LED on with the fan off.

## Phase 5: Pi-side CLI `projctl`

Go, single static binary for arm64/armv6 as needed. Commands:

```
projctl status          # reachable? awake? light on/off if knowable
projctl off             # blank light source
projctl on              # restore
projctl probe           # runs the Phase 1 probe
```

- Backend chosen by config: `adb-keyevent`, `adb-sysfs` (root), `http` (Phase 6 app), `ir` (Phase 7).
- Make commands idempotent: `off` twice stays off. Never use the POWER toggle in the final design.
- Reconnect ADB automatically if the connection dropped.
- Config file at `/etc/projctl.toml` with projector IP and backend.

## Phase 6: Android control app on the projector

Kotlin, minSdk 30, sideloaded with `adb install`. A foreground service starts on boot and runs a small HTTP server on the LAN:

```
GET  /status          -> {"light":"on|off","awake":true}
POST /light/off
POST /light/on
```

- Rooted mode: shell out with `su -c` to the Phase 4 sysfs write.
- Non-rooted mode: use `PowerManager` and `DevicePolicyManager.lockNow()` (requires device admin) to sleep, and a wake lock with `ACQUIRE_CAUSES_WAKEUP` to wake. Confirm on this device that these darken the LED.
- Restrict access to a shared token in a header, and optionally to the Pi's IP. Do not expose it beyond the LAN.
- Make sure the vendor firmware does not kill the service: test after a reboot and after the remote's power button is pressed.

## Phase 7: IR fallback

The only reliable way to wake from deep standby, if the projector enters it.

- IR receiver (TSOP38238 or similar) on a Pi GPIO with the `gpio-ir` overlay; record the stock remote with `ir-ctl -r`.
- IR LED with a transistor driver on another GPIO with the `gpio-ir-tx` overlay; replay with `ir-ctl --send`.
- Add an `ir` backend to `projctl`.

## Also check: HDMI-CEC

From the Pi: `cec-ctl --playback` then `cec-ctl -S`. If the projector shows up as a TV, test standby (`cec-ctl --to 0 --standby`) and wake (`cec-ctl --to 0 --image-view-on`). Unverified whether the HY300 HDMI input supports CEC.

## Acceptance criteria

- `projctl off` makes the light source visibly dark (not grey black) within 2 seconds.
- `projctl on` restores the image within 2 seconds without an Android reboot.
- Both work 50 times in a row from a script, and still work after a projector reboot.
- Findings written to `FINDINGS.md`: board/SoC, Android version, which methods worked, exact sysfs paths, any keylayout mappings.

## Ground rules

- Ask the owner before flashing, rooting, or writing to any partition.
- Back up before any change to the device.
- Keep a restore command next to every sysfs write you try.
