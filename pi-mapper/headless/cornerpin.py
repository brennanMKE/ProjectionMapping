#!/usr/bin/env python3
"""Corner-pin an mpv video that plays straight to HDMI (no desktop, no browser).

mpv runs with --input-ipc-server=/tmp/mpv.sock. This script keeps four corner
positions, builds a GLSL user shader that warps mpv's output onto them, and
tells mpv to load it. Standard library only.

  cornerpin.py edit     interactive: 1-4 pick a corner, arrows move it,
                        +/- step size, a = all corners, r = reset, q = save and quit
  cornerpin.py apply    load the saved corners into mpv (e.g. after mpv restarts)
  cornerpin.py set X1 Y1 X2 Y2 X3 Y3 X4 Y4
                        corners in pixels: top-left, top-right, bottom-right, bottom-left
  cornerpin.py reset    back to the full screen
  cornerpin.py stats    print decoder, fps, dropped frames and temperature every 2 s

Env: MPV_SOCKET (default /tmp/mpv.sock), SCREEN (default 1280x720),
     CORNERS_FILE (default ~/cornerpin.json), FLIP_Y=1 if up/down come out reversed.
"""

import json
import os
import socket
import sys
import time

SOCK = os.environ.get("MPV_SOCKET", "/tmp/mpv.sock")
SCREEN_W, SCREEN_H = (int(v) for v in os.environ.get("SCREEN", "1280x720").lower().split("x"))
STATE = os.path.expanduser(os.environ.get("CORNERS_FILE", "~/cornerpin.json"))
FLIP_Y = os.environ.get("FLIP_Y") == "1"
SHADER_DIR = "/tmp/cornerpin"

FULL = [[0, 0], [SCREEN_W, 0], [SCREEN_W, SCREEN_H], [0, SCREEN_H]]


# ---------------------------------------------------------------- math

def square_to_quad(q):
    """3x3 homography mapping the unit square (0,0)(1,0)(1,1)(0,1) onto quad q (Heckbert)."""
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = q
    sx = x0 - x1 + x2 - x3
    sy = y0 - y1 + y2 - y3
    if abs(sx) < 1e-12 and abs(sy) < 1e-12:  # parallelogram: affine
        return [[x1 - x0, x2 - x1, x0], [y1 - y0, y2 - y1, y0], [0.0, 0.0, 1.0]]
    dx1, dx2 = x1 - x2, x3 - x2
    dy1, dy2 = y1 - y2, y3 - y2
    den = dx1 * dy2 - dx2 * dy1
    g = (sx * dy2 - dx2 * sy) / den
    h = (dx1 * sy - sx * dy1) / den
    return [[x1 - x0 + g * x1, x3 - x0 + h * x3, x0],
            [y1 - y0 + g * y1, y3 - y0 + h * y3, y0],
            [g, h, 1.0]]


def invert3(m):
    a, b, c = m[0]
    d, e, f = m[1]
    g, h, i = m[2]
    A, B, C = e * i - f * h, -(d * i - f * g), d * h - e * g
    det = a * A + b * B + c * C
    if abs(det) < 1e-12:
        raise ValueError("corners are degenerate (three in a line?)")
    inv = [[A, -(b * i - c * h), b * f - c * e],
           [B, a * i - c * g, -(a * f - c * d)],
           [C, -(a * h - b * g), a * e - b * d]]
    return [[v / det for v in row] for row in inv]


def screen_to_source(corners):
    """Homography from normalized screen coords (0..1) to normalized source coords (0..1)."""
    q = [[x / SCREEN_W, y / SCREEN_H] for x, y in corners]
    m = invert3(square_to_quad(q))
    s = m[2][2]
    return [[v / s for v in row] for row in m]


def apply_h(m, x, y):
    w = m[2][0] * x + m[2][1] * y + m[2][2]
    return ((m[0][0] * x + m[0][1] * y + m[0][2]) / w, (m[1][0] * x + m[1][1] * y + m[1][2]) / w)


# ---------------------------------------------------------------- shader + mpv

def shader_source(m):
    f = lambda v: "%.9f" % v  # noqa: E731
    flip = "p.y = 1.0 - p.y;" if FLIP_Y else ""
    flip_s = "s.y = 1.0 - s.y;" if FLIP_Y else ""
    return f"""//!HOOK OUTPUT
//!BIND HOOKED
//!DESC corner pin

vec4 hook() {{
    vec2 p = HOOKED_pos;
    {flip}
    vec3 q = vec3({f(m[0][0])} * p.x + {f(m[0][1])} * p.y + {f(m[0][2])},
                  {f(m[1][0])} * p.x + {f(m[1][1])} * p.y + {f(m[1][2])},
                  {f(m[2][0])} * p.x + {f(m[2][1])} * p.y + {f(m[2][2])});
    if (q.z <= 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
    vec2 s = q.xy / q.z;
    if (s.x < 0.0 || s.y < 0.0 || s.x > 1.0 || s.y > 1.0) return vec4(0.0, 0.0, 0.0, 1.0);
    {flip_s}
    return HOOKED_tex(s);
}}
"""


def mpv(*command):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
        s.settimeout(2)
        s.connect(SOCK)
        s.sendall((json.dumps({"command": list(command)}) + "\n").encode())
        buf = b""
        while b"\n" not in buf:
            chunk = s.recv(4096)
            if not chunk:
                break
            buf += chunk
        for line in buf.decode().splitlines():
            reply = json.loads(line)
            if "error" in reply:  # skip async events
                return reply
    return {}


_counter = [0]


def push(corners):
    """Write a fresh shader file and load it. mpv may cache shaders by path, so each update gets a new name."""
    os.makedirs(SHADER_DIR, exist_ok=True)
    _counter[0] += 1
    path = os.path.join(SHADER_DIR, "pin-%d-%d.glsl" % (os.getpid(), _counter[0]))
    with open(path, "w") as fh:
        fh.write(shader_source(screen_to_source(corners)))
    reply = mpv("change-list", "glsl-shaders", "set", path)
    for name in os.listdir(SHADER_DIR):  # keep the directory small
        full = os.path.join(SHADER_DIR, name)
        if full != path:
            try:
                os.remove(full)
            except OSError:
                pass
    return reply


def load():
    try:
        with open(STATE) as fh:
            c = json.load(fh)["corners"]
            if len(c) == 4:
                return c
    except (OSError, ValueError, KeyError):
        pass
    return [p[:] for p in FULL]


def save(corners):
    with open(STATE, "w") as fh:
        json.dump({"screen": [SCREEN_W, SCREEN_H], "corners": corners}, fh, indent=1)


# ---------------------------------------------------------------- commands

def edit():
    import curses

    corners = load()
    state = {"sel": 0, "step": 10, "msg": ""}

    def ui(scr):
        curses.curs_set(0)
        while True:
            scr.erase()
            scr.addstr(0, 0, "corner pin  screen %dx%d  socket %s" % (SCREEN_W, SCREEN_H, SOCK))
            scr.addstr(1, 0, "1-4 corner  a all  arrows move  +/- step  r reset  q save+quit")
            names = ["1 top-left", "2 top-right", "3 bottom-right", "4 bottom-left"]
            for i, (x, y) in enumerate(corners):
                mark = ">" if state["sel"] in (i, -1) else " "
                scr.addstr(3 + i, 0, "%s %-15s %7.1f %7.1f" % (mark, names[i], x, y))
            scr.addstr(8, 0, "step %g px   %s" % (state["step"], state["msg"]))
            scr.refresh()
            k = scr.getch()
            dx = dy = 0
            if k in (ord("q"), 27):
                return
            elif k in (ord("1"), ord("2"), ord("3"), ord("4")):
                state["sel"] = k - ord("1")
            elif k == ord("a"):
                state["sel"] = -1
            elif k in (ord("+"), ord("=")):
                state["step"] = min(100, state["step"] * 2 if state["step"] >= 1 else 1)
            elif k == ord("-"):
                state["step"] = max(0.5, state["step"] / 2)
            elif k == ord("r"):
                corners[:] = [p[:] for p in FULL]
            elif k == curses.KEY_LEFT:
                dx = -1
            elif k == curses.KEY_RIGHT:
                dx = 1
            elif k == curses.KEY_UP:
                dy = -1
            elif k == curses.KEY_DOWN:
                dy = 1
            else:
                continue
            for i in (range(4) if state["sel"] == -1 else [state["sel"]]):
                corners[i][0] += dx * state["step"]
                corners[i][1] += dy * state["step"]
            try:
                r = push(corners)
                state["msg"] = "" if r.get("error") == "success" else "mpv: %s" % r.get("error")
            except (OSError, ValueError) as e:
                state["msg"] = "error: %s" % e

    try:
        push(corners)
    except OSError as e:
        sys.exit("cannot reach mpv at %s: %s (is mpv running with --input-ipc-server?)" % (SOCK, e))
    curses.wrapper(ui)
    save(corners)
    print("saved", STATE)


def stats():
    props = ["hwdec-current", "estimated-vf-fps", "display-fps", "frame-drop-count",
             "decoder-frame-drop-count", "video-params/w", "video-params/h"]
    print("Ctrl-C to stop")
    while True:
        vals = []
        for p in props:
            r = mpv("get_property", p)
            v = r.get("data")
            vals.append("%s=%s" % (p.split("/")[-1], round(v, 1) if isinstance(v, float) else v))
        try:
            with open("/sys/class/thermal/thermal_zone0/temp") as fh:
                vals.append("temp=%.1fC" % (int(fh.read()) / 1000))
        except OSError:
            pass
        try:
            with open("/proc/loadavg") as fh:
                vals.append("load=%s" % fh.read().split()[0])
        except OSError:
            pass
        print("  ".join(vals), flush=True)
        time.sleep(2)


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "edit"
    if cmd == "edit":
        edit()
    elif cmd == "apply":
        print(push(load()))
    elif cmd == "reset":
        save([p[:] for p in FULL])
        print(push(load()))
    elif cmd == "set" and len(argv) == 10:
        v = [float(a) for a in argv[2:]]
        corners = [[v[0], v[1]], [v[2], v[3]], [v[4], v[5]], [v[6], v[7]]]
        save(corners)
        print(push(corners))
    elif cmd == "shader":  # print the shader for the saved corners, for debugging
        print(shader_source(screen_to_source(load())))
    elif cmd == "stats":
        try:
            stats()
        except KeyboardInterrupt:
            pass
    else:
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
