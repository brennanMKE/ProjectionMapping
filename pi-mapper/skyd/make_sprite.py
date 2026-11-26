#!/usr/bin/env python3
"""Draw the sleigh-and-reindeer silhouette sprite for skyd (original artwork).

Writes sleigh.raw: uint32 width, uint32 height, then width*height bytes of
coverage (0..255). Two animation frames are stacked vertically (legs in two
gallop poses). The team flies to the LEFT (reindeer lead on the left).
"""
import math, struct, sys

W, H1 = 512, 128          # one frame
SS = 3                    # supersampling
out = sys.argv[1] if len(sys.argv) > 1 else "sleigh.raw"

def ellipse(cx, cy, rx, ry, ang=0.0):
    ca, sa = math.cos(ang), math.sin(ang)
    def f(x, y):
        dx, dy = x - cx, y - cy
        u = (dx * ca + dy * sa) / rx
        v = (-dx * sa + dy * ca) / ry
        return u * u + v * v <= 1
    return f

def seg(x1, y1, x2, y2, w):
    def f(x, y):
        vx, vy = x2 - x1, y2 - y1
        t = max(0, min(1, ((x - x1) * vx + (y - y1) * vy) / (vx * vx + vy * vy)))
        return math.hypot(x - (x1 + t * vx), y - (y1 + t * vy)) <= w / 2
    return f

def poly(pts):
    def f(x, y):
        inside = False
        n = len(pts)
        for i in range(n):
            (x1, y1), (x2, y2) = pts[i], pts[(i + 1) % n]
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                inside = not inside
        return inside
    return f

def reindeer(ox, oy, phase):
    s = []
    s.append(ellipse(ox, oy, 22, 8, -0.08))                 # body
    s.append(seg(ox - 18, oy - 3, ox - 28, oy - 16, 7))      # neck
    s.append(ellipse(ox - 31, oy - 18, 8, 4.5, 0.3))         # head
    s.append(seg(ox - 37, oy - 16, ox - 41, oy - 14, 3))     # muzzle
    for d in (-1, 1):                                        # antlers
        bx = ox - 28 + d * 2
        s.append(seg(bx, oy - 22, bx + 4 + d, oy - 34, 2))
        s.append(seg(bx + 3, oy - 29, bx - 3, oy - 33, 2))
        s.append(seg(bx + 4, oy - 32, bx + 9, oy - 36, 2))
    s.append(seg(ox + 20, oy - 3, ox + 25, oy - 7, 3))       # tail
    # legs: front and back pairs, gallop poses
    a = 0.6 if phase == 0 else -0.5
    for lx, base in ((ox - 14, a), (ox + 14, -a)):
        for k in (-1, 1):
            ang = base + 0.25 * k
            x2 = lx + math.sin(ang) * 18
            y2 = oy + 5 + math.cos(ang) * 18
            s.append(seg(lx, oy + 4, x2, y2, 3.2))
    return s

def scene(phase):
    s = []
    # sleigh (right side), runners curl up at the front (left)
    sx, sy = 400, 70
    s.append(poly([(sx - 40, sy - 6), (sx + 46, sy - 10), (sx + 52, sy - 34), (sx + 40, sy - 30),
                   (sx + 34, sy + 8), (sx - 30, sy + 10)]))
    s.append(seg(sx - 48, sy + 22, sx + 56, sy + 22, 3))                     # runner
    s.append(seg(sx - 48, sy + 22, sx - 58, sy + 14, 3))                    # runner curl
    s.append(seg(sx - 25, sy + 10, sx - 25, sy + 22, 3))
    s.append(seg(sx + 25, sy + 10, sx + 25, sy + 22, 3))
    # Santa: body, head, hat with bobble, arm holding reins
    s.append(ellipse(sx + 8, sy - 22, 17, 19))
    s.append(ellipse(sx + 2, sy - 47, 9, 10))
    s.append(poly([(sx - 7, sy - 52), (sx + 11, sy - 54), (sx + 18, sy - 70), (sx + 2, sy - 62)]))
    s.append(ellipse(sx + 20, sy - 71, 4, 4))
    s.append(seg(sx - 5, sy - 28, sx - 28, sy - 20, 5))
    # sack behind Santa
    s.append(ellipse(sx + 34, sy - 26, 14, 16, 0.3))
    # reindeer team, two abreast in pairs, leading to the left
    team = [(300, 62), (225, 56), (150, 50), (75, 44)]
    for i, (x, y) in enumerate(team):
        s += reindeer(x, y, (phase + i) % 2)
    # reins from Santa's hands to the team
    s.append(seg(sx - 28, sy - 20, team[0][0] - 20, team[0][1] - 10, 1.6))
    for (x1, y1), (x2, y2) in zip(team, team[1:]):
        s.append(seg(x1 - 22, y1 - 6, x2 + 18, y2 - 4, 1.6))
    s.append(seg(sx - 40, sy - 2, team[0][0] + 22, team[0][1], 2))         # harness
    return s

buf = bytearray()
for phase in (0, 1):
    shapes = scene(phase)
    for y in range(H1):
        for x in range(W):
            hits = 0
            for j in range(SS):
                for i in range(SS):
                    px, py = x + (i + 0.5) / SS, y + (j + 0.5) / SS
                    if any(f(px, py) for f in shapes):
                        hits += 1
            buf.append(255 * hits // (SS * SS))
open(out, "wb").write(struct.pack("<II", W, H1 * 2) + bytes(buf))
print("wrote", out, W, "x", H1 * 2)
