#!/usr/bin/env bash
# Read-only probe of an Android projector over ADB (handoff Phase 1).
# Saves everything to ~/projector-probe/<timestamp>/ and prints a summary.
# Changes nothing on the projector.
#
#   projector-probe.sh <projector-ip>[:5555]
set -uo pipefail

T="${1:?usage: projector-probe.sh <projector-ip>[:port]}"
[[ "$T" == *:* ]] || T="$T:5555"
adb connect "$T" >/dev/null
A=(adb -s "$T")
sh_() { "${A[@]}" shell "$@" </dev/null 2>&1; }   # </dev/null: adb would eat our stdin

D=~/projector-probe/$(date +%Y%m%d-%H%M%S)
mkdir -p "$D" && cd "$D" || exit 1

sh_ getprop                          > getprop.txt
sh_ id                               > id.txt
sh_ 'ls -la /sys/class/leds/ /sys/class/backlight/; for f in /sys/class/leds/*/brightness /sys/class/leds/*/max_brightness /sys/class/leds/*/trigger /sys/class/backlight/*/brightness /sys/class/backlight/*/bl_power; do echo "$f: $(cat $f 2>&1 | head -c 300)"; done' > leds.txt
sh_ ls /sys/class/                   > sysclass.txt
sh_ dumpsys power                    > power.txt
sh_ dumpsys display                  > display.txt
sh_ getevent -lp                     > getevent.txt
sh_ 'ls /vendor/usr/keylayout /system/usr/keylayout /odm/usr/keylayout' > keylayouts.txt
sh_ pm list packages -f              > packages.txt
sh_ ps -A                            > ps.txt
sh_ cat /proc/cpuinfo                > cpuinfo.txt
sh_ uname -a                         > uname.txt
sh_ dumpsys hdmi_control             > hdmi_control.txt
sh_ dumpsys tv_input                 > tv_input.txt
sh_ cmd package query-activities -a android.intent.action.MAIN -c android.intent.category.LAUNCHER > launcher-activities.txt
sh_ 'dumpsys activity activities | grep -E "ResumedActivity"' > resumed.txt
sh_ 'dumpsys window | grep -E "mCurrentFocus|mFocusedApp"' > focus.txt
mkdir -p keylayout
for f in $(grep -oE "[A-Za-z0-9_-]+\.kl" keylayouts.txt | sort -u); do
  for dir in /vendor/usr/keylayout /system/usr/keylayout /odm/usr/keylayout; do
    "${A[@]}" pull "$dir/$f" "keylayout/$f" </dev/null >/dev/null 2>&1 && break
  done
done

echo "saved to $D"
echo "--- device"
grep -E "ro.board.platform|ro.product.(model|manufacturer|brand|device|board)\]|ro.build.version.(release|sdk)\]|ro.boot.slot_suffix|ro.build.(type|tags)\]|ro.hardware\]|ro.product.cpu.abi\]" getprop.txt
echo "--- shell user: $(cat id.txt)"
echo "--- kernel: $(cat uname.txt)"
grep -iE "^Hardware|model name" cpuinfo.txt | sort -u | head -3
echo "--- leds / backlight"; head -40 leds.txt
echo "--- /sys/class entries of interest"; tr " \t" "\n\n" < sysclass.txt | grep -iE "led|lcd|lamp|panel|fan|proj|motor|keystone|backlight|pwm|tv|hdmi|cec" | tr "\n" " "; echo
echo "--- foreground"; cat resumed.txt focus.txt
echo "--- power"; grep -iE "mWakefulness=|Display Power|mHoldingDisplay" power.txt | head -5
echo "--- tv inputs"; grep -iE "inputId|hdmi|label|TvInputInfo" tv_input.txt | head -15
echo "--- hdmi_control"; head -12 hdmi_control.txt
echo "--- keylayouts: $(ls keylayout | tr "\n" " ")"
echo "--- input devices"; grep -E "add device|name:" getevent.txt | paste - - | sed 's/  */ /g' | head -15
echo "--- non-AOSP packages"; grep -viE "com.android|com.google|android.ext" packages.txt | sed 's/package://' | head -40
