import struct, sys, json, os
d = sys.argv[1]; W, H = 1280, 720
raw = open(os.path.join(d, "projcam.f32"), "rb").read()
G = 16; gw, gh = W // G, H // G
cov = [[0] * gw for _ in range(gh)]
for y in range(0, H, 2):
    for x in range(0, W, 2):
        cx, cy = struct.unpack_from("<ff", raw, (y * W + x) * 8)
        if 0 <= cx < W and 0 <= cy < H:
            cov[int(cy) // G][int(cx) // G] += 1
ok = [[1 if cov[y][x] >= 3 else 0 for x in range(gw)] for y in range(gh)]
best = (0, None)
for y0 in range(gh):
    for y1 in range(y0, gh):
        run = 0
        for x in range(gw):
            if all(ok[y][x] for y in range(y0, y1 + 1)):
                run += 1; a = run * (y1 - y0 + 1)
                if a > best[0]: best = (a, (x - run + 1, y0, x, y1))
            else: run = 0
x0, y0, x1, y1 = best[1]
rect = {"x0": x0*G + 8, "y0": y0*G + 8, "x1": (x1+1)*G - 8, "y1": (y1+1)*G - 8}
json.dump(rect, open(os.path.join(d, "rect.json"), "w")); print(rect)
