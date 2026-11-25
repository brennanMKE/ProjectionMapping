#!/usr/bin/env bash
# Launch Chromium fullscreen on the mapping page. Started from labwc autostart.
# Waits for mapd, clears crash flags so no "restore pages" bubble appears,
# and relaunches Chromium if it exits.

URL="${1:-http://localhost:8080/}"
PROFILE="$HOME/.config/pi-mapper-chromium"
CHROMIUM="$(command -v chromium || command -v chromium-browser)"

for _ in $(seq 1 60); do
  curl -fsS -o /dev/null "$URL" && break
  sleep 1
done

# shellcheck disable=SC2054  # commas inside --disable-features are intended
FLAGS=(
  --kiosk
  --noerrdialogs
  --disable-infobars
  --no-first-run
  --no-default-browser-check
  --disable-session-crashed-bubble
  --disable-features=Translate,TranslateUI,MediaRouter
  --autoplay-policy=no-user-gesture-required
  --check-for-update-interval=31536000
  --password-store=basic
  --disable-pinch
  --overscroll-history-navigation=0
  --user-data-dir="$PROFILE"
)
[[ -n "${WAYLAND_DISPLAY:-}" ]] && FLAGS+=(--ozone-platform=wayland)
# Extra flags for experiments (e.g. hardware decode) go in kiosk.flags, one per line.
EXTRA="$(dirname "$0")/../kiosk.flags"
[[ -f "$EXTRA" ]] && while IFS= read -r f; do [[ -n "$f" && "$f" != \#* ]] && FLAGS+=("$f"); done < "$EXTRA"

while true; do
  PREF="$PROFILE/Default/Preferences"
  if [[ -f "$PREF" ]]; then
    sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' "$PREF"
  fi
  echo "$(date -Is) starting $CHROMIUM ${FLAGS[*]} $URL"
  "$CHROMIUM" "${FLAGS[@]}" "$URL"
  echo "$(date -Is) chromium exited ($?); restarting in 2s"
  sleep 2
done
