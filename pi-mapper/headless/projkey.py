#!/usr/bin/env python3
"""Press keys on the projector through the USB HID gadget (hid-gadget.sh).

  projkey.py home down down right enter      # a sequence, 0.4 s apart
  projkey.py --delay 1 sleep
  projkey.py cc:0x89 kb:0x65                 # raw consumer / keyboard usages
  projkey.py --list

Android maps these to its own keys: home/back from the consumer page, arrows
and enter from the keyboard page, sleep/wake/power from the system page.
"""

import argparse
import sys
import time

KBD, CC, SYS = "/dev/hidg0", "/dev/hidg1", "/dev/hidg2"

KEYBOARD = {  # HID keyboard usages
    "enter": 0x28, "ok": 0x28, "esc": 0x29, "backspace": 0x2A, "tab": 0x2B, "space": 0x2C,
    "right": 0x4F, "left": 0x50, "down": 0x51, "up": 0x52,
    "f1": 0x3A, "f2": 0x3B, "f3": 0x3C, "f4": 0x3D, "f5": 0x3E, "f6": 0x3F,
    "f7": 0x40, "f8": 0x41, "f9": 0x42, "f10": 0x43, "f11": 0x44, "f12": 0x45,
    "menu": 0x65,  # keyboard "Application" key
}
CONSUMER = {  # HID consumer usages
    "home": 0x223, "back": 0x224, "search": 0x221,
    "playpause": 0xCD, "stop": 0xB7, "next": 0xB5, "prev": 0xB6,
    "volup": 0xE9, "voldown": 0xEA, "mute": 0xE2,
    "tv": 0x89, "settings": 0x40,  # Media Select TV, Menu
    "cpower": 0x30, "csleep": 0x32,
}
SYSTEM = {"power": 0x01, "sleep": 0x02, "wake": 0x04}  # bits in the 1-byte report


def write(dev, data):
    with open(dev, "wb", buffering=0) as fh:
        fh.write(bytes(data))


def press(name):
    n = name.lower()
    if n.startswith("kb:"):
        code = int(n[3:], 0)
        write(KBD, [0, 0, code, 0, 0, 0, 0, 0]); time.sleep(0.05); write(KBD, [0] * 8)
    elif n.startswith("cc:"):
        code = int(n[3:], 0)
        write(CC, [code & 0xFF, code >> 8]); time.sleep(0.05); write(CC, [0, 0])
    elif n in KEYBOARD:
        write(KBD, [0, 0, KEYBOARD[n], 0, 0, 0, 0, 0]); time.sleep(0.05); write(KBD, [0] * 8)
    elif n in CONSUMER:
        c = CONSUMER[n]
        write(CC, [c & 0xFF, c >> 8]); time.sleep(0.05); write(CC, [0, 0])
    elif n in SYSTEM:
        write(SYS, [SYSTEM[n]]); time.sleep(0.1); write(SYS, [0])
    else:
        raise SystemExit("unknown key %r (try --list)" % name)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("keys", nargs="*")
    ap.add_argument("--delay", type=float, default=0.4, help="seconds between keys")
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()
    if a.list or not a.keys:
        print("keyboard:", " ".join(sorted(KEYBOARD)))
        print("consumer:", " ".join(sorted(CONSUMER)))
        print("system:  ", " ".join(sorted(SYSTEM)))
        print("raw:      kb:0xNN  cc:0xNNN")
        return 0
    for i, k in enumerate(a.keys):
        if i:
            time.sleep(a.delay)
        print("press", k, flush=True)
        press(k)
    return 0


if __name__ == "__main__":
    sys.exit(main())
