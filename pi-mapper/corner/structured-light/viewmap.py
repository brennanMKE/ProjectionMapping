# Build the projector->camera map from the Gray-code captures, plus the largest
# camera-space rectangle that the projector fully lights.
import glob, os, struct, sys, statistics, json
d = sys.argv[1]; out = sys.argv[2]
W, H = 1280, 720
def load(tag): return open(glob.glob(os.path.join(d, f"sl-*-{tag}.gray"))[0], "rb").read()
white, black = load("white"), load("black")
xb = [(load(f"x{k}"), load(f"x{k}i")) for k in range(10, 2, -1)]
yb = [(load(f"y{k}"), load(f"y{k}i")) for k in range(9, 2, -1)]
PW, PH = 160, 90
cells = [[] for _ in range(PW * PH)]
lit = bytearray(W * H)
for i in range(W * H):
    if white[i] - black[i] < 25: continue
    lit[i] = 1
    b = v = 0
    for p, q in xb: b ^= 1 if p[i] > q[i] else 0; v = (v << 1) | b
    px = v
    b = v = 0
    for p, q in yb: b ^= 1 if p[i] > q[i] else 0; v = (v << 1) | b
    py = v
    if px < PW and py < PH: cells[py * PW + px].append((i % W, i // W))
cx = [None] * (PW * PH); cy = [None] * (PW * PH)
for j, c in enumerate(cells):
    if len(c) >= 3:
        mx = statistics.median(p[0] for p in c); my = statistics.median(p[1] for p in c)
        good = [p for p in c if abs(p[0] - mx) < 12 and abs(p[1] - my) < 12]   # drop decode outliers
        if len(good) >= 2:
            cx[j] = sum(p[0] for p in good) / len(good); cy[j] = sum(p[1] for p in good) / len(good)
# reject cells that disagree with their 5x5 neighbourhood (decode errors)
def med(vals): vals = sorted(vals); return vals[len(vals)//2]
for _ in range(5):
    nx, ny = cx[:], cy[:]
    for y in range(PH):
        for x in range(PW):
            j = y * PW + x
            nb = [(cx[k], cy[k]) for yy in range(max(0,y-2), min(PH,y+3)) for xx in range(max(0,x-2), min(PW,x+3))
                  for k in [yy*PW+xx] if k != j and cx[k] is not None]
            if len(nb) < 6: continue
            mx, my = med([n[0] for n in nb]), med([n[1] for n in nb])
            if cx[j] is None or abs(cx[j]-mx) > 4 or abs(cy[j]-my) > 4:
                nx[j], ny[j] = mx, my
    cx, cy = nx, ny
# fill holes from neighbours (a few passes)
for _ in range(6):
    nx, ny = cx[:], cy[:]
    for y in range(PH):
        for x in range(PW):
            j = y * PW + x
            if cx[j] is not None: continue
            nb = [(cx[k], cy[k]) for k in (j - 1 if x else -1, j + 1 if x < PW - 1 else -1, j - PW, j + PW) if 0 <= k < PW * PH and cx[k] is not None]
            if len(nb) >= 2:
                nx[j] = sum(n[0] for n in nb) / len(nb); ny[j] = sum(n[1] for n in nb) / len(nb)
    cx, cy = nx, ny
known = sum(1 for v in cx if v is not None)
# per projector pixel, bilinear between cell centres (cell k covers px 8k..8k+7, centre 8k+3.5)
buf = bytearray()
for y in range(H):
    fy = (y - 3.5) / 8; y0 = max(0, min(PH - 2, int(fy))); ty = min(1, max(0, fy - y0))
    for x in range(W):
        fx = (x - 3.5) / 8; x0 = max(0, min(PW - 2, int(fx))); tx = min(1, max(0, fx - x0))
        q = [cx[y0*PW+x0], cx[y0*PW+x0+1], cx[(y0+1)*PW+x0], cx[(y0+1)*PW+x0+1]]
        r = [cy[y0*PW+x0], cy[y0*PW+x0+1], cy[(y0+1)*PW+x0], cy[(y0+1)*PW+x0+1]]
        if None in q:
            buf += struct.pack("<ff", -1, -1); continue
        a = q[0]*(1-tx)+q[1]*tx; b2 = q[2]*(1-tx)+q[3]*tx
        c = r[0]*(1-tx)+r[1]*tx; d2 = r[2]*(1-tx)+r[3]*tx
        buf += struct.pack("<ff", a*(1-ty)+b2*ty, c*(1-ty)+d2*ty)
open(os.path.join(out, "projcam.f32"), "wb").write(buf)
# largest camera-space rectangle (on a 16 px grid) that is >= 97% lit
G = 16; gw, gh = W // G, H // G
frac = [[sum(lit[(y*G+dy)*W + x*G+dx] for dy in range(0, G, 4) for dx in range(0, G, 4)) / 16 for x in range(gw)] for y in range(gh)]
ok = [[1 if frac[y][x] >= 0.9 else 0 for x in range(gw)] for y in range(gh)]
best = (0, None)
for y0 in range(gh):
    for y1 in range(y0, gh):
        run = 0
        for x in range(gw):
            if all(ok[y][x] for y in range(y0, y1 + 1)):
                run += 1
                area = run * (y1 - y0 + 1)
                if area > best[0]: best = (area, (x - run + 1, y0, x, y1))
            else:
                run = 0
x0, y0, x1, y1 = best[1]
rect = {"x0": x0*G + G, "y0": y0*G + G, "x1": (x1+1)*G - G, "y1": (y1+1)*G - G}
json.dump(rect, open(os.path.join(out, "rect.json"), "w"))
print("cells with data:", known, "/", PW*PH, " camera rect:", rect)
