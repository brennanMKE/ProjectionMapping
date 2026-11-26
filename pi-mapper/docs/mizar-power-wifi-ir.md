# Mizar: independent power, Wi-Fi control, and IR power-on

How to run the Pi Zero 2 W ("mizar") so it doesn't depend on the projector
for power, controls the projector entirely over Wi-Fi, and can switch the
projector on with an IR transmitter.

## Why

Today mizar is powered from the projector's USB-A port. That port stays live
in standby, but when the projector restarts or loses mains power, mizar loses
power too (this happened once, unexpectedly). It also can't switch the
projector on: in standby the projector ignores USB, Wi-Fi is down, and
HDMI-CEC is ignored. Only its IR receiver stays awake.

| Job | How | Needs |
| --- | --- | --- |
| Keep mizar running | Its own 5 V supply | A power supply |
| Play video | HDMI, as now | (nothing new) |
| Control the projector while on | ADB over Wi-Fi (HDMI input, keys, sleep) | USB debugging on the projector (done) |
| Turn the projector on from standby | IR LED sending a power code | IR transmitter wired to the Pi |
| Turn it off | ADB `input keyevent POWER`, or IR | (nothing new) |

## 1. Power

1. Use a dedicated **5 V, 2.5 A micro-USB supply** (the official Raspberry Pi
   Zero supply is a good choice). Plug it into the port labelled **PWR IN**
   at the end of the board.
2. **Unplug the projector's USB cable from the Pi's USB (data) port.** On the
   Pi Zero, that port's 5 V line connects straight to the board's power rail.
   With a separate supply plugged in as well, two power sources would feed
   the same rail, which can damage either one.
3. Optional: if you still want the USB keyboard fallback (`projkey`), use a
   **USB power blocker** (sold as "data only, no power" adapters) between the
   projector and the Pi's USB port. It passes data and cuts the 5 V wire. With
   ADB working, the keyboard isn't needed.
4. Check after boot: `vcgencmd get_throttled` should print `throttled=0x0`.

What changes in projd: nothing is required. Its USB keyboard features simply
report "not attached". The automatic "switch to HDMI when the projector
connects" currently watches USB; with no cable it should watch ADB instead
(the projector appearing on Wi-Fi). That's a small projd change, listed below.

## 2. Wi-Fi control (ADB)

Already working:

- USB debugging is on, and this firmware serves ADB over Wi-Fi on port 5555
  whenever the projector is on, about 40 s after it boots.
- mizar is authorized ("Always allow from this computer").
- mizar finds the projector by mDNS (`_adb._tcp`), so no IP address is configured.
- Direct HDMI: `am start -n com.softwinner.awlivetv/.MainActivity --es input_source HDMI1`.

Keep it reliable:

- Give the projector a **DHCP reservation** in the router, so its address
  doesn't change (mDNS discovery works either way; a fixed address is a
  fallback: `projd -adb <address>`).
- If mizar is ever shown as `unauthorized` again, the projector shows an
  "Allow USB debugging?" prompt: tick **Always allow**, then Allow.

## 3. IR transmitter (power on)

The projector's IR receiver is a wakeup source and accepts the power code of
17 different NEC remotes (listed in [FINDINGS.md](../../FINDINGS.md)). An IR
LED can send one of these; recording the physical remote isn't required,
though it's a useful check.

### Parts

- An **IR transmitter module** for Raspberry Pi or Arduino (940 nm LED with a
  built-in transistor driver; three pins: VCC, GND, signal), or a 940 nm IR LED
  plus a 2N2222 NPN transistor, a 1 kΩ resistor (base) and a 33 to 68 Ω
  resistor (LED current).
- Optional: an **IR receiver module, 38 kHz** (VS1838B or TSOP38238) to
  record and verify the remote's codes.
- Jumper wires, and a 2×20 header if mizar's GPIO isn't populated.

### Wiring

| Signal | Pi pin | GPIO |
| --- | --- | --- |
| IR transmitter signal (module IN, or transistor base via 1 kΩ) | 12 | GPIO 18 |
| Transmitter VCC | 2 (5 V) | |
| Transmitter GND | 6 | |
| IR receiver OUT (optional) | 11 | GPIO 17 |
| IR receiver VCC (optional) | 1 (3.3 V) | |
| IR receiver GND (optional) | 9 | |

Aim the LED at the projector's IR window (usually at the front, near the
remote's usual direction). A line of sight within a few meters is plenty.

### Software (I'll set this up once it's wired)

1. `/boot/firmware/config.txt`, under `[all]`:
   ```
   dtoverlay=pwm-ir-tx,gpio_pin=18
   dtoverlay=gpio-ir,gpio_pin=17
   ```
   then reboot. This creates `/dev/lirc*` devices. `ir-ctl` is already installed.
2. Optional: record the physical remote's power button:
   `ir-ctl -d /dev/lirc1 -r --mode2` (or `ir-keytable -t`), to confirm the
   address and code.
3. Send power, for example the first listed pair (address 0x01/0xFE, code 0x40):
   `ir-ctl -d /dev/lirc0 -S nec:0x0140`. If that doesn't wake it, try the
   other byte order and the other pairs from FINDINGS.md.
4. projd gets "Projector on" (IR) and "Projector off" (ADB) buttons, plus an
   optional schedule (for example on at dusk, off at 11 pm), and switches to
   HDMI over ADB once the projector is back on Wi-Fi.

## Changes to projd for this setup

- Detect the projector coming back via ADB (mDNS/port 5555), not only USB,
  then switch to HDMI.
- "Projector on" via IR, "Projector off" via ADB.
- Hide USB keyboard controls when the USB link isn't present.

## Checklist

- [ ] 5 V 2.5 A supply into PWR IN; projector USB cable unplugged from the Pi
      (or through a power blocker)
- [ ] `vcgencmd get_throttled` shows `0x0`
- [ ] Projector DHCP reservation
- [ ] IR transmitter wired to GPIO 18, aimed at the projector
- [ ] Tell Claude to enable the overlays and test the power codes
