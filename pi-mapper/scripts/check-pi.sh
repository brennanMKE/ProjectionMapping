#!/usr/bin/env bash
# Print the facts the setup depends on, so the unverified assumptions in the
# README can be checked on a real Pi:  make check PI=<host>
echo "== OS";          grep -E '^(PRETTY_NAME|VERSION_CODENAME)=' /etc/os-release; uname -m
echo "== Model";       tr -d '\0' < /proc/device-tree/model 2>/dev/null; echo
echo "== Chromium";    for b in chromium chromium-browser; do command -v "$b" && "$b" --version 2>/dev/null; done
echo "== Session";     echo "XDG_SESSION_TYPE=${XDG_SESSION_TYPE:-?}"; pgrep -a -x 'labwc|wayfire|Xorg|Xwayland' || echo "(no compositor found from this shell)"
echo "== labwc autostart"; ls -l ~/.config/labwc/autostart /etc/xdg/labwc/autostart 2>/dev/null
echo "== Video decoders (V4L2)"
for d in /dev/video*; do
  n=$(cat "/sys/class/video4linux/$(basename "$d")/name" 2>/dev/null); [[ -n "$n" ]] && echo "$d: $n"
done
echo "== Time sync";   timedatectl show -p NTP -p NTPSynchronized 2>/dev/null
echo "== Temp/throttle"; command -v vcgencmd >/dev/null && { vcgencmd measure_temp; vcgencmd get_throttled; }
echo "== mapd";        systemctl is-active mapd 2>/dev/null; curl -fsS localhost:8080/api/status 2>/dev/null | head -c 400; echo
