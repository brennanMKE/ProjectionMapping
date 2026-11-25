#!/usr/bin/env bash
# Record CPU load, temperature, clocks and throttling on the Pi while the
# mapper runs (acceptance test 3).
#
#   scripts/record-stats.sh [seconds=600] [interval=5] [out=logs/stats-<time>.csv]
#
# Columns: time, temp_c, load1, cpu_pct (all cores together, 0-100),
# chromium_pct and mapd_pct (percent of ONE core, so up to 400 on a Pi 5),
# arm_mhz, throttled (vcgencmd get_throttled bitmask; 0x0 = fine).
set -euo pipefail

DUR="${1:-600}"
INT="${2:-5}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/logs"
OUT="${3:-$ROOT/logs/stats-$(date +%Y%m%d-%H%M%S).csv}"
HZ="$(getconf CLK_TCK)"

cpu_total() { awk '/^cpu /{print $2+$3+$4+$5+$6+$7+$8; exit}' /proc/stat; }
cpu_idle()  { awk '/^cpu /{print $5+$6; exit}' /proc/stat; }
proc_ticks() { # sum utime+stime for processes matching name
  local sum=0 p t
  for p in $(pgrep -f "$1" || true); do
    t=$(awk '{print $14+$15}' "/proc/$p/stat" 2>/dev/null || echo 0)
    sum=$((sum + t))
  done
  echo "$sum"
}
temp_c() { awk '{printf "%.1f", $1/1000}' /sys/class/thermal/thermal_zone0/temp; }
vc() { command -v vcgencmd >/dev/null && vcgencmd "$@" 2>/dev/null || echo "n/a"; }

echo "time,temp_c,load1,cpu_pct,chromium_pct,mapd_pct,arm_mhz,throttled" > "$OUT"
echo "Recording ${DUR}s every ${INT}s to $OUT"

t0=$(cpu_total); i0=$(cpu_idle); c0=$(proc_ticks chromium); m0=$(proc_ticks "/mapd ")
end=$((SECONDS + DUR))
while ((SECONDS < end)); do
  sleep "$INT"
  t1=$(cpu_total); i1=$(cpu_idle); c1=$(proc_ticks chromium); m1=$(proc_ticks "/mapd ")
  dt=$((t1 - t0)); di=$((i1 - i0))
  cpu=$(awk -v dt="$dt" -v di="$di" 'BEGIN{ if (dt>0) printf "%.1f", 100*(dt-di)/dt; else print 0 }')
  cpct=$(awk -v d="$((c1 - c0))" -v hz="$HZ" -v s="$INT" 'BEGIN{ v=100*d/(hz*s); if (v<0) v=0; printf "%.1f", v }')
  mpct=$(awk -v d="$((m1 - m0))" -v hz="$HZ" -v s="$INT" 'BEGIN{ v=100*d/(hz*s); if (v<0) v=0; printf "%.1f", v }')
  load=$(cut -d' ' -f1 /proc/loadavg)
  mhz=$(vc measure_clock arm | awk -F= '{ if ($2 != "") printf "%d", $2/1000000; else print "n/a" }')
  thr=$(vc get_throttled | sed 's/throttled=//')
  line="$(date -Is),$(temp_c),$load,$cpu,$cpct,$mpct,$mhz,$thr"
  echo "$line" >> "$OUT"
  echo "$line"
  t0=$t1; i0=$i1; c0=$c1; m0=$m1
done

echo
awk -F, 'NR>1 { n++; t+=$2; if ($2>tm) tm=$2; c+=$4; ch+=$5 }
  END { if (n) printf "samples %d  temp avg %.1f max %.1f C  cpu avg %.1f%%  chromium avg %.1f%% of one core\n", n, t/n, tm, c/n, ch/n }' "$OUT"
