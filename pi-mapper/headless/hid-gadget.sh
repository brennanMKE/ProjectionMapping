#!/usr/bin/env bash
# Present the Pi Zero (2) W as a USB keyboard + media remote + power/sleep
# controller on its "USB" (OTG) micro-USB port. Plug that port into the
# projector's USB-A port: the same cable powers the Pi.
#
# Creates /dev/hidg0 (keyboard), /dev/hidg1 (consumer control: Home, Back,
# media keys), /dev/hidg2 (system control: power, sleep, wake).
# Needs "dtoverlay=dwc2,dr_mode=peripheral" under [all] in config.txt.
# Run as root (installed as hid-gadget.service). Safe to run again.
set -euo pipefail

G=/sys/kernel/config/usb_gadget/projkeys
modprobe libcomposite

if [[ -d $G ]]; then
  # already set up: just make sure it's bound
  if [[ -z "$(cat $G/UDC 2>/dev/null)" ]]; then ls /sys/class/udc | head -1 > $G/UDC; fi
  exit 0
fi

mkdir -p $G && cd $G
echo 0x1d6b > idVendor          # Linux Foundation
echo 0x0104 > idProduct         # multifunction composite gadget
echo 0x0100 > bcdDevice
echo 0x0200 > bcdUSB
mkdir -p strings/0x409
echo "mizar"                 > strings/0x409/serialnumber
echo "pi-mapper"             > strings/0x409/manufacturer
echo "Projector Keys"        > strings/0x409/product
mkdir -p configs/c.1/strings/0x409
echo "keyboard + remote" > configs/c.1/strings/0x409/configuration
echo 100 > configs/c.1/MaxPower

hidfn() { # name protocol subclass report_length descriptor-hex
  mkdir -p functions/hid.$1
  echo $2 > functions/hid.$1/protocol
  echo $3 > functions/hid.$1/subclass
  echo $4 > functions/hid.$1/report_length
  python3 -c "import sys; sys.stdout.buffer.write(bytes.fromhex(sys.argv[1]))" "$5" > functions/hid.$1/report_desc
  ln -s functions/hid.$1 configs/c.1/
}

# boot keyboard: 8-byte reports (modifiers, reserved, 6 keys)
hidfn kbd 1 1 8 "05010906a101050719e029e71500250175019508810295017508810395057501050819012905910295017503910395067508150025650507190029658100c0"
# consumer control: one 16-bit usage per report (Home 0x223, Back 0x224, ...)
hidfn cc 0 0 2 "050c0901a1011500 26ff03 1900 2aff03 75109501 8100 c0"
# system control: bit0 power down, bit1 sleep, bit2 wake up
hidfn sys 0 0 1 "05010980a101198129831500250175019503810295058101c0"

ls /sys/class/udc | head -1 > UDC
