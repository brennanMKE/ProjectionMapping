#!/usr/bin/env python3
"""Solve the viewer camera (webcam) in room coordinates.

Room points come from the projector-side corner solve (corner.json, same model
as cmd/cornergen: meters from the corner, x down the vertical seam, y along
the left wall/ceiling seam, z along the right one). Their camera positions
come from the per-surface homographies (planes.json from planefit.py). A
direct linear transform over these 3D-2D pairs gives the 3x4 camera matrix.

Writes uniforms for skyd: u_campos (camera centre, room coords) and u_minv
(inverse of the left 3x3 of the camera matrix: camera pixel -> ray direction).

  camsolve.py <corner.json> <planes.json> <out-uniforms.txt>
"""
import importlib.util, json, math, os, sys

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("cv", os.path.join(here, "..", "corner_video.py"))
cv = importlib.util.module_from_spec(spec); spec.loader.exec_module(cv)

cfg = cv.load_config(sys.argv[1])
scene = cv.Scene(cfg)
H = json.load(open(sys.argv[2]))["homographies"]
W, Hh = cfg["width"], cfg["height"]

def hom(h, x, y):
    w = h[6]*x + h[7]*y + 1
    return ((h[0]*x + h[1]*y + h[2]) / w, (h[3]*x + h[4]*y + h[5]) / w)

def face_of(p):  # world point -> plane index matching planefit (0 left, 1 right, 2 ceiling)
    if abs(p[0]) < 1e-6: return 2
    if abs(p[2]) < 1e-6: return 0
    return 1

pairs = []
for py in range(20, Hh - 20, 24):
    for px in range(20, W - 20, 24):
        p = scene.hit(px, py)
        if p is None: continue
        if min(sorted(p)[1:]) < 0.05: continue          # stay off the seams
        k = face_of(p)
        if H[k] is None: continue
        u, v = hom(H[k], px, py)
        if 0 <= u < 1280 and 0 <= v < 720:
            pairs.append((p, (u, v)))
print("3D-2D pairs:", len(pairs))

# DLT with P[2][3] = 1: 11 unknowns, least squares via normal equations
rows, rhs = [], []
for (X, Y, Z), (u, v) in pairs:
    rows.append([X, Y, Z, 1, 0, 0, 0, 0, -u*X, -u*Y, -u*Z]); rhs.append(u)
    rows.append([0, 0, 0, 0, X, Y, Z, 1, -v*X, -v*Y, -v*Z]); rhs.append(v)
n = 11
AtA = [[sum(r[i]*r[j] for r in rows) for j in range(n)] for i in range(n)]
Atb = [sum(r[i]*b for r, b in zip(rows, rhs)) for i in range(n)]
M = [AtA[i][:] + [Atb[i]] for i in range(n)]
for c in range(n):
    piv = max(range(c, n), key=lambda r: abs(M[r][c])); M[c], M[piv] = M[piv], M[c]
    for r in range(n):
        if r != c:
            f = M[r][c] / M[c][c]
            for k in range(c, n+1): M[r][k] -= f*M[c][k]
p = [M[i][n] / M[i][i] for i in range(n)] + [1.0]
P = [p[0:4], p[4:8], p[8:12]]

def proj(X):
    x = [sum(P[r][c]*v for c, v in enumerate(list(X) + [1])) for r in range(3)]
    return (x[0]/x[2], x[1]/x[2])
errs = sorted(math.hypot(proj(X)[0]-u, proj(X)[1]-v) for X, (u, v) in pairs)
print(f"reprojection error: median {errs[len(errs)//2]:.2f} px, 90% {errs[int(len(errs)*0.9)]:.2f} px")

A = [row[:3] for row in P]; b = [row[3] for row in P]
def inv3(m):
    a, bb, c = m[0]; d, e, f = m[1]; g, h, i = m[2]
    det = a*(e*i-f*h) - bb*(d*i-f*g) + c*(d*h-e*g)
    return [[(e*i-f*h)/det, -(bb*i-c*h)/det, (bb*f-c*e)/det],
            [-(d*i-f*g)/det, (a*i-c*g)/det, -(a*f-c*d)/det],
            [(d*h-e*g)/det, -(a*h-bb*g)/det, (a*e-bb*d)/det]]
Minv = inv3(A)
C = [-sum(Minv[r][k]*b[k] for k in range(3)) for r in range(3)]
# ray direction for a pixel must point from the camera toward the room point
X0, (u0, v0) = pairs[len(pairs)//2]
d0 = [sum(Minv[r][k]*q for k, q in enumerate((u0, v0, 1))) for r in range(3)]
if sum((X0[i]-C[i])*d0[i] for i in range(3)) < 0:
    Minv = [[-v for v in row] for row in Minv]
vtx = proj((0, 0, 0))
print("camera at (m, room coords x=down y=left z=right):", [round(v, 2) for v in C])
print("corner vertex appears at camera pixel:", [round(v, 1) for v in vtx])
# mask: largest S such that each surface's S x S square at the corner (edges
# parallel to the seams) lies inside the projector picture
def in_frame(X):
    cam = cv.add(scene.V, cv.add(cv.add(cv.mul(scene.D[0], X[0]), cv.mul(scene.D[1], X[1])), cv.mul(scene.D[2], X[2])))
    if cam[2] <= 0: return False
    u, v = scene.project(cam)
    return 1 <= u < W - 1 and 1 <= v < Hh - 1
def shape_fits(Wd, D):
    # ceiling: Wd x Wd square; each wall: Wd along its ceiling seam, D down
    for i in range(25):
        a, b = Wd * i / 24, D * i / 24
        for X in ((0, a, Wd), (0, Wd, a), (b, Wd, 0), (D, a, 0), (b, 0, Wd), (D, 0, a)):
            if not in_frame(X): return False
    return True
best = (0, 0.0, 0.0)
Wd = 0.05
while Wd < 4:
    D = 0.0
    while shape_fits(Wd, D + 0.01) and D < 4: D += 0.01
    if D == 0: break
    area = Wd * Wd + 2 * Wd * D
    if D >= 0.5 * Wd and area > best[0]: best = (area, Wd, D)   # keep walls from getting too shallow
    Wd += 0.01
S, Sd = best[1] * 0.98, best[2] * 0.98
print(f"mask: {S:.2f} m along each seam, walls {Sd:.2f} m down")

with open(sys.argv[3], "w") as fh:
    fh.write("# viewer camera, from camsolve.py\n")
    fh.write("u_campos %f %f %f\n" % tuple(C))
    fh.write("u_minv " + " ".join("%.9g" % v for row in Minv for v in row) + "\n")
    fh.write("u_vertex %f %f\n" % vtx)
    fh.write("u_mask %f\n" % S)
    fh.write("u_maskd %f\n" % Sd)
