# HY300-class projector: control findings

Running notes for [the projector control brief](../briefs/hy300_control_handoff.md). The
projector is an XBJ "Smart Mini Portable Projector" (an HY300-family clone),
controlled from **mizar**, a Raspberry Pi Zero 2 W that feeds it HDMI and is
powered from its USB-A port.

Last updated 2026-11-25. Raw probe output is on mizar in `~/projector-probe/`.

## Summary

| Goal | Best method found | Status |
| --- | --- | --- |
| Select HDMI input | ADB: `am start -n com.softwinner.awlivetv/.MainActivity --es input_source HDMI1` | **Works**, about 2 s, also from a cold boot |
| Select HDMI input (no ADB) | USB keyboard menu sequence | Works, about 12 s |
| Navigate (arrows, OK, Home, Back) | USB keyboard (HID gadget) or `adb shell input keyevent` | Works |
| Light source off/on, Android stays up | Vendor API `AwTvSystemManager.setBacklightEnable(bool)` from a sideloaded app | **Very likely possible without root** (SELinux allows it); app not built yet |
| Standby (full off) | USB system Power key (`projkey power`), USB consumer Power key, or `input keyevent POWER` | Works |
| Wake from standby | IR power code (17 accepted, listed below) | Needs an IR LED; USB, ADB and CEC can't wake it |
| Power on with mains power | `AwTvSystemManager.setPowerOnMode(DIRECT)` | Possible via the same app; not tried |
| Sleep/Wake keys (HID, ADB) | | Ignored by the firmware |
| HDMI-CEC control | | Ignored (answers queries only) |

## Device

| Property | Value |
| --- | --- |
| SoC | Allwinner **H713** (`ro.hardware` sun50iw12p1, platform `ares`) |
| Android | **11** (SDK 30), not the advertised 12. `user` build, `release-keys` |
| Userspace | 32-bit (`armeabi-v7a`) on kernel 5.4.99 |
| Slots | A/B, running `_b` |
| Identity | brand `ADT-3`, manufacturer `askey`, model `Projector` (spoofed Android TV dev kit identity) |
| Settings UI | Android TV Settings (Network & Internet, Bluetooth, Apps, Device Preferences) |
| Launcher | `com.chiptrip.tv.launcher` (DymtLauncher) |
| HDMI app | `com.softwinner.awlivetv` (TV input `com.softwinner.vis/.HdmiInputService/HW1`) |
| Light source | `/sys/class/backlight/tv` (`brightness`, `bl_power`), root-only (0644 root) |
| Status LED | `/sys/class/leds/tv:green`, `tv:red` |
| Other | `motor` (focus), keystone in `persist.display.keystone_*`, accelerometer `mir3da` |

## Developer options and ADB

1. Settings → **Device Preferences** → **About** → press OK on **Build** 7 to
   10 times. Developer options then appears under Device Preferences.
2. Turn on **USB debugging**. There is no Wireless debugging entry, but this
   firmware then serves **ADB over Wi-Fi on port 5555** anyway
   (`service.adb.tcp.port=5555`) and announces it via mDNS as `_adb._tcp`
   (hostname `Android-*.local`). projd finds it that way, so no IP is configured.
3. First connection shows "Allow USB debugging?". **Tick "Always allow from
   this computer".** Without it the authorization was lost after the second
   projector reboot, and mizar showed as `unauthorized` until accepted again.
4. ADB comes back about 40 s after a projector reboot.
5. ADB over Wi-Fi isn't always there. Late on 2026-11-25, after hours of
   use, `adb mdns services` listed nothing and no device was connected,
   while the USB keyboard still worked (the system Power key put the
   projector in standby). Cause unknown. If it happens, try
   `adb connect <projector-ip>:5555` with the address from the router, or
   fall back to the USB keyboard. An IR transmitter avoids depending on either.

The shell user is `uid=2000(shell)`, no root.

### How projd uses ADB

- **Discovery:** it browses mDNS for `_adb._tcp` and connects to whatever it
  finds, so no IP address is configured anywhere.
- **Status:** it checks the ADB state in the background every 10 s (it takes
  1–2 s), and the web UI's status panel shows the cached result.
- **HDMI:** the web UI's **Switch to HDMI** button, and the switch when the
  projector connects, run the `am start ... --es input_source HDMI1` command
  below. If ADB isn't available it falls back to the USB keyboard menu sequence.
- **Remote:** the web UI's D-pad, Home, Back and Standby buttons press keys
  through the USB keyboard gadget (`projkey`), not ADB.

## HDMI input, directly

```
adb shell am start -n com.softwinner.awlivetv/.MainActivity --es input_source HDMI1
```

Without the `input_source` extra, a cold start crashes
(`IllegalStateException: otherIntentSource must not be null`). It only
"works" without it when the app is already running in the background. The
settings provider records the source as `input_source_recent_record=HDMI1`.

projd uses this for "Switch to HDMI" and after the projector connects over
USB (Pi boot or projector wake): it waits for `sys.boot_completed=1`, switches,
and confirms the HDMI activity is in front. It falls back to the key
sequence only if ADB is unavailable or unauthorized.

## Light source: vendor API (no root)

`/system/framework/com.softwinner.tv.jar` is a shared library registered for
apps (`/system/etc/permissions/com.softwinner.tv.xml`, `<uses-library
android:name="com.softwinner.tv"/>`). Relevant methods (read from the dex):

```
com.softwinner.tv.AwTvSystemManager.getInstance(Context) -> AwTvSystemManager
  setBacklightEnable(boolean) -> int        // light source off/on
  getBacklightEnable() -> boolean
  setPowerOnMode(AwTvSystemTypes$EnumPowerMode) -> int   // DIRECT | MEMORY | STANDBY
  getPowerOnMode() -> EnumPowerMode
com.softwinner.tv.AwTvDisplayManager.getInstance() -> AwTvDisplayManager
  setBacklight(int) -> int / getBacklight() -> int        // brightness
```

These call the HIDL service `vendor.aw.homlet.tvsystem.tvserver@1.0::ITvServer/default`
(SELinux type `tvserver_hwservice`). The vendor policy explicitly allows
ordinary apps to use it:

```
(allow untrusted_app_30_0 tvserver_hwservice (hwservice_manager (find)))
(allow untrusted_app_30_0 tvserver (binder (call transfer)))
```

The ADB shell is **not** allowed (no rule for `shell`), so this needs a small
sideloaded app targeting SDK 30 (handoff Phase 6), not `adb shell`. Not yet
verified: whether `tvserver` adds its own caller checks, and whether
`setBacklightEnable(false)` fully darkens the LED.

Tried and ruled out for the light: Android `screen_brightness` (0 to 255) does
not change `/sys/class/backlight/tv`; `input keyevent SLEEP/WAKEUP` are
ignored (Android stays Awake, backlight unchanged, ADB stays connected).

## IR remote (wake from standby)

The IR receiver (`s_cir@7040000`) is a **wakeup source**, and the device tree
(`/proc/device-tree/cir_param`) lists 17 NEC remotes whose power key wakes it.
Any one of these pairs should work from an IR LED, without recording the
physical remote. Address shown as stored (the two NEC address bytes):

| # | Address | Power code | | # | Address | Power code |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | fe01 | 0x40 | | 9 | fb04 | 0x08 |
| 1 | fb04 | 0x1a | | 10 | fc03 | 0x00 |
| 2 | 2992 | 0xf2 | | 11 | bf00 | 0x00 |
| 3 | 9f00 | 0x57 | | 12 | fb04 | 0xea |
| 4 | 4cb3 | 0xdc | | 13 | bf00 | 0x42 |
| 5 | ff00 | 0x14 | | 14 | 1608 | 0x87 |
| 6 | dd22 | 0xdc | | 15 | ef11 | 0x1d |
| 7 | bc00 | 0x0d | | 16 | 00f7 | 0xf1 |
| 8 | 4040 | 0x4d | | | | |

Matching keylayouts are in `/vendor/usr/keylayout/customer_ir_<addr>.kl`;
the active one is `sunxi-ir.kl`. Byte order for `ir-ctl` (`nec:0xAACC` vs
extended `necx`) still needs a test.

## USB keyboard (HID gadget) on the Pi

- Uses the Pi Zero's **USB** (OTG) port, not PWR. One cable from the
  projector's USB-A port powers the Pi and carries the keyboard.
- **The cable must carry data.** Two short charge-only cables powered the Pi
  but never enumerated. A full data cable worked (`configured`, high-speed).
- `dtoverlay=dwc2,dr_mode=peripheral` under `[all]` in `config.txt`;
  `hid-gadget.service` creates `/dev/hidg0` (keyboard), `/dev/hidg1`
  (consumer control), `/dev/hidg2` (system control). `projkey` sends keys.
- The projector sees it as three "pi-mapper Projector Keys" input devices.
- In standby the USB port stays powered but the host stops enumerating, so
  no USB input can wake it. The remote-wakeup bit (`bmAttributes 0xa0`) didn't help.

| Key | HID usage | Effect |
| --- | --- | --- |
| arrows, enter | Keyboard 0x52/0x51/0x50/0x4F, 0x28 | Navigate / select |
| home / back | Consumer 0x223 / 0x224 | Home / Back |
| power | System Power (bit 0x01) | Standby (from on); confirmed 2026-11-25 |
| cpower | Consumer 0x30 | Standby (from on) |
| tv | Consumer 0x89 | No effect |
| sleep / wake | System 0x82 / 0x83 | No effect |
| csleep | Consumer 0x32 | No effect |

Menu sequence to HDMI (no ADB):
`home up up up down down left left left left left right right right right enter`.
The launcher remembers the last tile, and running off an edge hides the
highlight; one press back returns it to the edge tile.

## HDMI audio

The projector plays HDMI audio from the Pi through its speaker. On the Pi Zero
it's ALSA card `vc4hdmi`; skyd's video player sends audio with ffmpeg to
`default:CARD=vc4hdmi`. The 720p60 output mode carries audio. (We haven't yet
confirmed by ear that the sound is clean.)

## HDMI-CEC

Reports itself as a TV, OSD name "Projector", CEC 1.4, vendor ID 0x769394,
power status always "on". `dumpsys hdmi_control` shows CEC enabled on the
HDMI_IN port. Standby, Image View On, Active Source, Set Stream Path and
remote button presses are acknowledged but ignored. Not usable for control.

## Unexpected restart (open issue)

At about 17:24 the projector restarted on its own and came back up in
standby, which cut USB power and restarted mizar. Its boot history
(`getprop persist.sys.boot.reason.history`) records it as `reboot,216`, unlike
the earlier `shutdown` (Power key) and `reboot,shell` (adb reboot) entries.
Android's dropbox kept no crash or kernel log for it. It came back in standby
rather than on, which suggests its power-on mode is STANDBY or MEMORY; check
with the projector app's `getPowerOnMode`. Watch for repeats: projd logs every
USB reconnect ("projector connected over USB").

## Next steps

1. Done: the ADB prompt was accepted again with "Always allow" ticked.
2. **Build the projector app** (Phase 6): a foreground service that calls
   `AwTvSystemManager.setBacklightEnable()` and exposes it over the LAN with
   a token, plus direct HDMI and the power-on mode. Needs a JDK and the
   Android SDK on the Mac (not installed).
3. **IR LED** on mizar for waking from standby, using one of the 17 codes
   above, and for standby too, so neither power direction depends on ADB or
   the USB cable. Then mizar can run from its own supply with no USB link
   (see [mizar_power_wifi_ir.md](mizar_power_wifi_ir.md)).
4. Test `setPowerOnMode(DIRECT)` with a smart plug as an alternative to IR.
