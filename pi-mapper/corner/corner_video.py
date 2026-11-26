#!/usr/bin/env python3
"""Turn a normal 2D video into a corner video (two walls + ceiling).

From the projector's own position, any video already looks flat on the
corner: each surface shows exactly what the lens throws at it. The fold only
distorts the picture for people standing somewhere else. This script
pre-distorts a video for a chosen viewing spot, so that from there it looks
like a flat screen floating behind the corner.

It uses the same corner.json as cornergen (projector size, throw ratio,
distance, and the measured vertex and seam points), solves where the
projector sits relative to the corner, and builds a per-pixel lookup map.
ffmpeg's remap filter then warps every frame. Standard library + ffmpeg only.

Examples:
  corner/corner_video.py in.mp4 media/corner/my-corner.mp4
  corner/corner_video.py in.mp4 out.mp4 --config corner/corner.json --eye-height 1.6 --ceiling 2.6
  corner/corner_video.py in.mp4 out.mp4 --eye 1.0,2.5,2.0      # meters: below ceiling, from right wall, from left wall
  corner/corner_video.py in.mp4 out.png --preview               # one frame, to check framing quickly

Viewing spot: by default the viewer stands where the projector is, at eye
height (--eye-height, default 1.6 m) under a ceiling of --ceiling meters
(default 2.5). Set "distance" in corner.json to the measured lens-to-corner
distance: it sets the scale of the room, so the viewing spot lands right.
"""

import argparse
import json
import math
import os
import struct
import subprocess
import sys
import tempfile
import time

# ---------------------------------------------------------------- vectors


def add(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
def sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def mul(a, s): return (a[0] * s, a[1] * s, a[2] * s)
def dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def length(a): return math.sqrt(dot(a, a))
def norm(a): return mul(a, 1 / length(a))


# ---------------------------------------------------------------- config + solve

DEFAULTS = {
    "width": 1280, "height": 720, "fps": 30, "throw": 1.3, "distance": 3.0,
    "vertex": [640, 302], "down": [640, 720], "left": [276, 92], "right": [1004, 92],
}


def load_config(path):
    cfg = dict(DEFAULTS)
    if path:
        with open(path) as fh:
            cfg.update(json.load(fh))
    return cfg


class Scene:
    """Same model as cmd/cornergen: world meters from the corner,
    x down the wall seam, y along the left seam, z along the right seam."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.w, self.h = cfg["width"], cfg["height"]
        self.f = cfg["throw"] * self.w
        pp = cfg.get("principal") or [self.w / 2, self.h / 2]
        self.cx, self.cy = pp
        self.solve()

    def ray(self, px, py):
        return ((px - self.cx) / self.f, (py - self.cy) / self.f, 1.0)

    def project(self, p):
        return (self.f * p[0] / p[2] + self.cx, self.f * p[1] / p[2] + self.cy)

    def solve(self):
        cfg = self.cfg
        v = cfg["vertex"]
        pts = [cfg["down"], cfg["left"], cfg["right"]]
        rv = self.ray(*v)
        n = [norm(cross(rv, self.ray(*p))) for p in pts]
        e1 = cross(n[0], (0, 0, 1))
        if length(e1) < 1e-6:
            e1 = cross(n[0], (1, 0, 0))
        e1 = norm(e1)
        e2 = cross(n[0], e1)

        def axes(a):
            d0 = add(mul(e1, math.cos(a)), mul(e2, math.sin(a)))
            c = cross(n[1], d0)
            if length(c) < 1e-9:
                return None
            d1 = norm(c)
            d2 = cross(d0, d1)
            return d0, d1, d2, dot(d2, n[2])

        steps, roots = 3600, []
        prev = axes(0.0)
        prev_a = 0.0
        for i in range(1, steps + 1):
            a = math.pi * i / steps
            cur = axes(a)
            if cur and prev and (prev[3] < 0) != (cur[3] < 0) and abs(prev[3] - cur[3]) < 0.5:
                lo, hi, flo = prev_a, a, prev[3]
                for _ in range(60):
                    mid = (lo + hi) / 2
                    fm = axes(mid)[3]
                    if (fm < 0) == (flo < 0):
                        lo, flo = mid, fm
                    else:
                        hi = mid
                roots.append((lo + hi) / 2)
            prev, prev_a = cur, a

        self.V = mul(norm(rv), cfg["distance"])
        for a in roots:
            base = axes(a)[:3]
            for signs in range(8):
                D = [mul(base[i], -1) if signs & (1 << i) else base[i] for i in range(3)]
                ok = True
                for i in range(3):
                    qx, qy = self.project(add(self.V, mul(D[i], 0.01)))
                    if (qx - v[0]) * (pts[i][0] - v[0]) + (qy - v[1]) * (pts[i][1] - v[1]) <= 0:
                        ok = False
                    if dot(mul(self.V, -1), D[i]) <= 0:
                        ok = False
                if ok:
                    self.D = D
                    self.cam = tuple(-dot(self.V, D[i]) for i in range(3))
                    return
        sys.exit("No perpendicular-corner solution for these points. Check vertex/down/left/right in the config.")

    def hit(self, px, py):
        """World point where a projector pixel lands, or None."""
        d = self.ray(px, py)
        best, bp = math.inf, None
        for normal_axis in (2, 1, 0):  # left wall, right wall, ceiling
            N = self.D[normal_axis]
            den = dot(d, N)
            if abs(den) < 1e-12:
                continue
            t = dot(self.V, N) / den
            if t <= 0 or t >= best:
                continue
            P = sub(mul(d, t), self.V)
            w = [dot(P, self.D[0]), dot(P, self.D[1]), dot(P, self.D[2])]
            w[normal_axis] = 0.0
            if min(w) < -1e-9:
                continue
            best, bp = t, tuple(w)
        return bp


# ---------------------------------------------------------------- map

def build_map(scene, eye, fit, zoom, shift, in_w, in_h):
    """For every output pixel, the input pixel it shows (or None)."""
    c = norm(mul(eye, -1))          # the viewer looks at the corner
    up = (-1.0, 0.0, 0.0)            # world x points down
    u = norm(sub(up, mul(c, dot(up, c))))
    r = norm(cross(u, c))
    W, H = scene.w, scene.h
    coords = [None] * (W * H)
    xs, ys = [], []
    for y in range(H):
        for x in range(W):
            p = scene.hit(x + 0.5, y + 0.5)
            if p is None:
                continue
            q = sub(p, eye)
            qc = dot(q, c)
            if qc <= 1e-6:
                continue
            X, Y = dot(q, r) / qc, dot(q, u) / qc
            coords[y * W + x] = (X, Y)
            xs.append(X)
            ys.append(Y)
    if not xs:
        sys.exit("Nothing visible from that viewing spot.")
    # fit the video to the visible area as the viewer sees it
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    vw, vh = x1 - x0, y1 - y0
    aspect = in_w / in_h
    if (fit == "cover") == (vw / vh > aspect):
        sw, sh = vw, vw / aspect
    else:
        sw, sh = vh * aspect, vh
    sw, sh = sw / zoom, sh / zoom
    mx = (x0 + x1) / 2 + shift[0] * vw
    my = (y0 + y1) / 2 + shift[1] * vh
    out = []
    for xy in coords:
        if xy is None:
            out.append(None)
            continue
        ix = ((xy[0] - mx) / sw + 0.5) * in_w
        iy = (0.5 - (xy[1] - my) / sh) * in_h
        out.append((ix, iy) if 0 <= ix < in_w and 0 <= iy < in_h else None)
    return out


def write_pgm16(path, w, h, values):
    with open(path, "wb") as fh:
        fh.write(b"P5\n%d %d\n65535\n" % (w, h))
        fh.write(struct.pack(">%dH" % len(values), *values))


def probe(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=width,height", "-of", "csv=p=0", path], capture_output=True, text=True, check=True)
    w, h = out.stdout.strip().split(",")[:2]
    return int(w), int(h)


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", help="input video or image")
    ap.add_argument("output", help="output .mp4 (or .png with --preview)")
    ap.add_argument("--config", default=None, help="corner.json (default: corner/corner.json if present, else built-in example)")
    ap.add_argument("--eye", help="viewer position in meters: below-ceiling,from-right-wall,from-left-wall")
    ap.add_argument("--eye-height", type=float, default=1.6, help="viewer eye height in meters (default 1.6)")
    ap.add_argument("--ceiling", type=float, default=2.5, help="ceiling height in meters (default 2.5)")
    ap.add_argument("--fit", choices=["cover", "contain"], default="cover", help="cover fills the corner; contain shows the whole frame")
    ap.add_argument("--zoom", type=float, default=1.0, help="scale the video up (>1) or down (<1)")
    ap.add_argument("--shift", default="0,0", help="move the video, as fractions of the visible width,height (up is +)")
    ap.add_argument("--upscale", type=int, default=2, help="upscale input before remapping, for smoother results (default 2)")
    ap.add_argument("--crf", type=int, default=20)
    ap.add_argument("--preview", action="store_true", help="write a single frame (PNG) instead of a video")
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    cfg_path = args.config or (os.path.join(here, "corner.json") if os.path.exists(os.path.join(here, "corner.json")) else None)
    cfg = load_config(cfg_path)
    scene = Scene(cfg)
    cam = scene.cam
    print("config: %s" % (cfg_path or "built-in example"))
    print("projector: %.2f m below the ceiling, %.2f m from the right wall, %.2f m from the left wall" % cam)

    if args.eye:
        eye = tuple(float(v) for v in args.eye.split(","))
    else:
        eye = (args.ceiling - args.eye_height, cam[1], cam[2])
    if min(eye) <= 0:
        sys.exit("The viewing spot must be inside the room (all three values > 0).")
    print("viewer:    %.2f m below the ceiling, %.2f m from the right wall, %.2f m from the left wall" % eye)

    in_w, in_h = probe(args.input)
    k = max(1, args.upscale)
    shift = tuple(float(v) for v in args.shift.split(","))
    t0 = time.time()
    m = build_map(scene, eye, args.fit, args.zoom, shift, in_w * k, in_h * k)
    print("map: %dx%d in %.1f s" % (scene.w, scene.h, time.time() - t0))

    with tempfile.TemporaryDirectory() as tmp:
        xmap, ymap = os.path.join(tmp, "x.pgm"), os.path.join(tmp, "y.pgm")
        # out-of-range coordinates make remap fill with black
        write_pgm16(xmap, scene.w, scene.h, [65535 if v is None else min(65534, int(v[0])) for v in m])
        write_pgm16(ymap, scene.w, scene.h, [65535 if v is None else min(65534, int(v[1])) for v in m])
        graph = ("[0:v]scale=iw*%d:ih*%d:flags=bicubic,format=gbrp[s];"
                 "[s][1:v][2:v]remap=fill=black,format=yuv420p[out]" % (k, k))
        cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-stats", "-y",
               "-i", args.input, "-i", xmap, "-i", ymap, "-filter_complex", graph, "-map", "[out]"]
        if args.preview:
            cmd += ["-frames:v", "1", "-update", "1", args.output]
        else:
            cmd += ["-an", "-r", str(cfg["fps"]), "-c:v", "libx264", "-profile:v", "high", "-crf", str(args.crf),
                    "-g", str(cfg["fps"] * 2), "-movflags", "+faststart", args.output]
        subprocess.run(cmd, check=True)
    print("wrote", args.output)


if __name__ == "__main__":
    main()
