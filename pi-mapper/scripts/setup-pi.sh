#!/usr/bin/env bash
# One-time (and repeatable) setup of a Raspberry Pi 5 as a projection mapper.
#
# Run ON THE PI, as the desktop user (not root), from the deployed folder:
#   ~/pi-mapper/scripts/setup-pi.sh
# or from the Mac:  make setup PI=<host> [ROLE=leader|follower|solo] [LEADER=<host>]
#
# Assumes a fresh Raspberry Pi OS 64-bit (Trixie, desktop) image.
# Safe to run more than once: every step checks or overwrites its own files.
#
# Env vars:
#   ROLE    solo | leader | follower   (default: keep existing config, else solo)
#   LEADER  leader host[:port]         (required for follower)
#   PORT    HTTP port                  (default 8080)

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8080}"
ROLE="${ROLE:-}"
LEADER="${LEADER:-}"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33mWARN: %s\033[0m\n' "$*"; }

if [[ $EUID -eq 0 ]]; then
  echo "Run this as the desktop user, not root (it calls sudo where needed)." >&2
  exit 1
fi
ME="$(id -un)"

# ---------------------------------------------------------------- checks
say "Checking system"
ARCH="$(uname -m)"
[[ "$ARCH" == "aarch64" ]] || warn "expected aarch64, got $ARCH (64-bit OS required)"
if [[ -r /etc/os-release ]]; then
  . /etc/os-release
  echo "OS: ${PRETTY_NAME:-unknown}"
  [[ "${VERSION_CODENAME:-}" == "trixie" ]] || warn "tested target is Trixie; this is ${VERSION_CODENAME:-unknown}"
fi
[[ -x "$APP_DIR/mapd" ]] || { echo "Missing $APP_DIR/mapd. Run 'make deploy PI=<host>' from the Mac first." >&2; exit 1; }

# ---------------------------------------------------------------- packages
say "Installing packages"
need=()
command -v curl >/dev/null || need+=(curl)
if ! command -v chromium >/dev/null && ! command -v chromium-browser >/dev/null; then
  need+=(chromium)
fi
if ((${#need[@]})); then
  sudo apt-get update
  # Trixie names the package 'chromium'; older releases used 'chromium-browser'.
  if ! sudo apt-get install -y "${need[@]}"; then
    need=("${need[@]/chromium/chromium-browser}")
    sudo apt-get install -y "${need[@]}"
  fi
else
  echo "curl and chromium already installed"
fi
CHROMIUM="$(command -v chromium || command -v chromium-browser)"
echo "Chromium: $CHROMIUM"

# ---------------------------------------------------------------- folders + config
say "Preparing $APP_DIR"
mkdir -p "$APP_DIR"/{media,layouts,logs}
chmod +x "$APP_DIR"/scripts/*.sh "$APP_DIR/mapd"

CONFIG="$APP_DIR/mapd.json"
if [[ -n "$ROLE" || ! -f "$CONFIG" ]]; then
  ROLE="${ROLE:-solo}"
  if [[ "$ROLE" == "follower" && -z "$LEADER" ]]; then
    echo "ROLE=follower needs LEADER=<host>" >&2
    exit 1
  fi
  cat > "$CONFIG" <<EOF
{
  "addr": ":$PORT",
  "name": "$(hostname)",
  "role": "$ROLE",
  "leader": "$LEADER",
  "cueDelayMs": 200
}
EOF
  echo "Wrote $CONFIG (role=$ROLE${LEADER:+, leader=$LEADER})"
else
  echo "Keeping existing $CONFIG"
fi

# ---------------------------------------------------------------- systemd
say "Installing mapd service"
UNIT=/etc/systemd/system/mapd.service
UNIT_TMP="$(mktemp)"
cat > "$UNIT_TMP" <<EOF
[Unit]
Description=mapd projection mapping server
Wants=network-online.target
After=network-online.target time-sync.target

[Service]
User=$ME
WorkingDirectory=$APP_DIR
ExecStart=$APP_DIR/mapd -config $APP_DIR/mapd.json -dir $APP_DIR
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
if ! sudo cmp -s "$UNIT_TMP" "$UNIT"; then
  sudo install -m 0644 "$UNIT_TMP" "$UNIT"
  sudo systemctl daemon-reload
  echo "Updated $UNIT"
fi
rm -f "$UNIT_TMP"
sudo systemctl enable mapd >/dev/null 2>&1
sudo systemctl restart mapd
sleep 1
systemctl is-active --quiet mapd && echo "mapd running" || warn "mapd failed to start: journalctl -u mapd -e"

# ---------------------------------------------------------------- kiosk autostart
say "Configuring Chromium kiosk autostart (labwc)"
# Current Pi OS desktops run labwc on Wayland. labwc runs the first autostart
# file it finds; a per-user file replaces /etc/xdg/labwc/autostart, so the
# panel and desktop icons do not start and nothing but Chromium is visible.
if ! command -v labwc >/dev/null; then
  warn "labwc not found. This script only configures labwc autostart; see README for other compositors."
fi
AUTOSTART="$HOME/.config/labwc/autostart"
mkdir -p "$(dirname "$AUTOSTART")"
touch "$AUTOSTART"
BEGIN='# >>> pi-mapper >>>'
END='# <<< pi-mapper <<<'
# remove any previous block, then append a fresh one
sed -i "/^$BEGIN\$/,/^$END\$/d" "$AUTOSTART"
cat >> "$AUTOSTART" <<EOF
$BEGIN
$APP_DIR/scripts/kiosk.sh http://localhost:$PORT/ >> $APP_DIR/logs/kiosk.log 2>&1 &
$END
EOF
echo "Updated $AUTOSTART"

# ---------------------------------------------------------------- boot + blanking
say "Boot to desktop with autologin, disable screen blanking"
if command -v raspi-config >/dev/null; then
  sudo raspi-config nonint do_boot_behaviour B4   # desktop, autologin
  sudo raspi-config nonint do_blanking 1          # 1 = disable blanking
else
  warn "raspi-config not found; enable desktop autologin and disable blanking manually"
fi

# ---------------------------------------------------------------- time sync
say "Checking time sync (needed for two-Pi cues)"
if command -v timedatectl >/dev/null; then
  timedatectl show -p NTP -p NTPSynchronized || true
  if [[ "$(timedatectl show -p NTP --value 2>/dev/null)" != "yes" ]]; then
    sudo timedatectl set-ntp true && echo "Enabled NTP"
  fi
fi

say "Done"
cat <<EOF
Projector page:  http://$(hostname).local:$PORT/
Control page:    http://$(hostname).local:$PORT/control
Reboot to start the kiosk:  sudo reboot
EOF
