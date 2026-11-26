# camsnap

A tiny macOS background agent (`CamSnap.app`) that serves webcam frames on
`127.0.0.1`, plus a `camsnap` wrapper script.

It exists because terminal apps without `NSCameraUsageDescription` in their
Info.plist cannot get camera access for the processes they launch. CamSnap has
its own bundle id (`local.pimapper.camsnap`) and usage string, so macOS asks
once for CamSnap itself.

## Build

    ./build.sh          # -> build/CamSnap.app (swiftc + ad-hoc codesign)

## Use

    ./camsnap [out.jpg] [camera-substring]
    ./camsnap shot.jpg Logitech
    CAMSNAP_WIDTH=1920 ./camsnap big.jpg

The wrapper launches the app with `open -g` if port 8999 is not answering,
waits up to 120 s for the permission prompt on first run, then writes a fresh
JPEG. Exit codes: 0 ok, 3 permission denied / not granted, 1 other errors.

Env: `CAMSNAP_PORT` (8999), `CAMSNAP_WIDTH` (1280), `CAMSNAP_APP`,
`CAMSNAP_PERMISSION_WAIT` (120).

## HTTP API (127.0.0.1 only)

| Endpoint | Result |
| --- | --- |
| `GET /snap.jpg?camera=<substring>&w=<width>` | fresh JPEG (504 after 5 s, 403 without permission, 404 no match) |
| `GET /cameras` | camera names, one per line |
| `GET /status` | `{"auth":"authorized","camera":"...","pid":123}` |
| `GET /quit` | exits the agent |

Default camera: name contains "Logitech", else first external camera, else
built-in. With no `camera=` the currently open camera is reused. The capture
session stays running between requests (first frame after a camera start is
delayed ~0.8 s for auto exposure) and stops after 10 idle minutes
(`CAMSNAP_IDLE_SECONDS`, 0 = never).

## Notes

- After rebuilding, run `curl -s 127.0.0.1:8999/quit` so the next `camsnap`
  starts the new binary. An ad-hoc re-sign can make macOS ask for permission
  again; if it was denied, re-enable it in System Settings > Privacy &
  Security > Camera (or `tccutil reset Camera local.pimapper.camsnap`).
- Logs go to the unified log: `log stream --predicate 'process == "CamSnap"'`.
