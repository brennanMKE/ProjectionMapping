#!/usr/bin/env python3
"""Fit one projector->camera homography per room surface and export a mesh.

The corner is three planes, so within each plane the projector->camera map is
a single homography. Fitting it robustly (RANSAC) to the decoded structured
light removes decode errors entirely. Plane membership comes from the seams in
projector space (corner.json: vertex, down, left, right).

  planefit.py <capture-dir> <corner.json> <out-dir>
writes <out-dir>/mesh.bin: int32 cols, rows, then per vertex float32
projector x, y, camera x, y (row-major, 8 px grid), and rect.json.
"""
import glob, json, os, random, struct, sys

cap, cfgp, out = sys.argv[1:4]
W, H = 1280, 720
cfg = json.load(open(cfgp))
V, Dn, L, R = cfg["vertex"], cfg["down"], cfg["left"], cfg["right"]

def side(a, b, p):  # >0 if p is left of a->b
    return (b[0]-a[0])*(p[1]-a[1]) - (b[1]-a[1])*(p[0]-a[0])

def plane(px, py):
    p = (px, py)
    above_l = side(V, L, p) > 0      # beyond the left seam (ceiling side)
    above_r = side(R, V, p) > 0      # beyond the right seam (ceiling side)
    if above_l and above_r and py < V[1] + 0:
        return 2
    return 0 if side(V, Dn, p) < 0 else 1   # left of the down seam = left wall

# ---- decode (same as viewmap.py, keep per-cell medians)
def load(tag): return open(glob.glob(os.path.join(cap, f"sl-*-{tag}.gray"))[0], "rb").read()
white, black = load("white"), load("black")
xb = [(load(f"x{k}"), load(f"x{k}i")) for k in range(10, 2, -1)]
yb = [(load(f"y{k}"), load(f"y{k}i")) for k in range(9, 2, -1)]
PW, PH = 160, 90
cells = [[] for _ in range(PW * PH)]
for i in range(W * H):
    if white[i] - black[i] < 25: continue
    b = v = 0
    for p, q in xb: b ^= 1 if p[i] > q[i] else 0; v = (v << 1) | b
    px = v; b = v = 0
    for p, q in yb: b ^= 1 if p[i] > q[i] else 0; v = (v << 1) | b
    py = v
    if px < PW and py < PH: cells[py*PW+px].append((i % W, i // W))
samples = [[], [], []]
for j, c in enumerate(cells):
    if len(c) < 3: continue
    xs = sorted(p[0] for p in c); ys = sorted(p[1] for p in c)
    px, py = (j % PW)*8 + 4, (j // PW)*8 + 4
    # stay clear of the seams: a cell straddling a seam mixes two planes
    if min(abs(side(V, Dn, (px, py))) / 430, abs(side(V, L, (px, py))) / 170, abs(side(R, V, (px, py))) / 370) < 12:
        continue
    samples[plane(px, py)].append((px, py, xs[len(xs)//2], ys[len(ys)//2]))

# ---- homography fit (DLT, h33 = 1) with RANSAC
def solve(A, bvec):
    n = len(bvec); M = [row[:] + [bvec[i]] for i, row in enumerate(A)]
    for c in range(n):
        piv = max(range(c, n), key=lambda r: abs(M[r][c]))
        if abs(M[piv][c]) < 1e-12: return None
        M[c], M[piv] = M[piv], M[c]
        for r in range(n):
            if r != c:
                f = M[r][c] / M[c][c]
                for k in range(c, n+1): M[r][k] -= f * M[c][k]
    return [M[i][n] / M[i][i] for i in range(n)]

def fit(pts):
    A, bv = [], []
    for x, y, u, v in pts:
        A.append([x, y, 1, 0, 0, 0, -u*x, -u*y]); bv.append(u)
        A.append([0, 0, 0, x, y, 1, -v*x, -v*y]); bv.append(v)
    # least squares via normal equations
    At = list(zip(*A)); AtA = [[sum(a*b for a, b in zip(r, c)) for c in At] for r in At]
    Atb = [sum(a*b for a, b in zip(r, bv)) for r in At]
    return solve(AtA, Atb)

def apply(h, x, y):
    w = h[6]*x + h[7]*y + 1
    return ((h[0]*x + h[1]*y + h[2]) / w, (h[3]*x + h[4]*y + h[5]) / w)

def ransac(pts, iters=400, tol=3.0):
    best, inl = None, []
    for _ in range(iters):
        h = fit(random.sample(pts, 4))
        if h is None: continue
        cur = [p for p in pts if (lambda q: (q[0]-p[2])**2 + (q[1]-p[3])**2)(apply(h, p[0], p[1])) < tol*tol]
        if len(cur) > len(inl): best, inl = h, cur
    return fit(inl), len(inl), len(pts)

random.seed(1)
Hs = []
for k, name in enumerate(("left wall", "right wall", "ceiling")):
    if len(samples[k]) < 20:
        Hs.append(None); print(f"{name}: too few samples ({len(samples[k])})"); continue
    h, ni, n = ransac(samples[k]); Hs.append(h)
    err = sorted(((apply(h, p[0], p[1])[0]-p[2])**2 + (apply(h, p[0], p[1])[1]-p[3])**2) ** 0.5 for p in samples[k])
    print(f"{name}: {ni}/{n} inliers, median error {err[len(err)//2]:.2f} px")

json.dump({"homographies": Hs, "names": ["left", "right", "ceiling"]}, open(os.path.join(out, "planes.json"), "w"))

# ---- mesh on an 8 px grid; each vertex mapped by its own plane
cols, rows = W // 8 + 1, H // 8 + 1
buf = bytearray(struct.pack("<ii", cols, rows))
cams = []
for r in range(rows):
    for c in range(cols):
        px, py = min(c*8, W-1), min(r*8, H-1)
        k = plane(px, py)
        h = Hs[k] if Hs[k] else Hs[0]
        u, v = apply(h, px, py)
        cams.append((u, v))
        buf += struct.pack("<ffff", px, py, u, v)
open(os.path.join(out, "mesh.bin"), "wb").write(buf)

# ---- window: largest camera-space rectangle covered by the projector (16 px grid)
G = 16; gw, gh = W // G, H // G
cov = [[0]*gw for _ in range(gh)]
for (u, v) in cams:
    if 0 <= u < W and 0 <= v < H: cov[int(v)//G][int(u)//G] += 1
ok = [[1 if cov[y][x] else 0 for x in range(gw)] for y in range(gh)]
# fill single-cell gaps (mesh spacing vs. camera grid)
for y in range(1, gh-1):
    for x in range(1, gw-1):
        if not ok[y][x] and sum(ok[y+dy][x+dx] for dy in (-1,0,1) for dx in (-1,0,1)) >= 6: ok[y][x] = 1
best = (0, None)
for y0 in range(gh):
    for y1 in range(y0, gh):
        run = 0
        for x in range(gw):
            if all(ok[y][x] for y in range(y0, y1+1)):
                run += 1; a = run*(y1-y0+1)
                if a > best[0]: best = (a, (x-run+1, y0, x, y1))
            else: run = 0
x0, y0, x1, y1 = best[1]
rect = {"x0": x0*G + 8, "y0": y0*G + 8, "x1": (x1+1)*G - 8, "y1": (y1+1)*G - 8}
json.dump(rect, open(os.path.join(out, "rect.json"), "w"))
print("window (camera px):", rect)
