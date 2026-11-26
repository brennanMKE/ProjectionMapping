# Gray-code structured-light patterns (RGB PPM), each stamped with its index:
# a black box at top-left holding a white "start" block, 6 index bits, and a black "end" gap.
import sys, os
W, H = 1280, 720
out = sys.argv[1]
pats = [("white", lambda x, y: 1), ("black", lambda x, y: 0)]
gbit = lambda v, k: ((v >> k) ^ (v >> (k + 1))) & 1
for k in range(3, 11):
    pats.append((f"x{k}", lambda x, y, k=k: gbit(x, k)))
    pats.append((f"x{k}i", lambda x, y, k=k: 1 - gbit(x, k)))
for k in range(3, 10):
    pats.append((f"y{k}", lambda x, y, k=k: gbit(y, k)))
    pats.append((f"y{k}i", lambda x, y, k=k: 1 - gbit(y, k)))
BX, BY, BS, GAP = 20, 20, 36, 8          # marker geometry (projector px)
MW = BX + 8 * (BS + GAP) + 10
for idx, (name, f) in enumerate(pats):
    bits = [1] + [(idx >> b) & 1 for b in range(5, -1, -1)]   # start block + 6 bits, MSB first
    rows = []
    for y in range(H):
        row = bytearray()
        in_my = y < BY + BS + 20
        for x in range(W):
            if in_my and x < MW:
                v = 0
                if BY <= y < BY + BS:
                    j, r = divmod(x - BX, BS + GAP)
                    if 0 <= j < len(bits) and x >= BX and r < BS and bits[j]:
                        v = 1
            else:
                v = f(x, y)
            row += b"\xff\xff\xff" if v else b"\x00\x00\x00"
        rows.append(bytes(row))
    with open(os.path.join(out, f"sl-{idx:02d}-{name}.ppm"), "wb") as fh:
        fh.write(b"P6\n%d %d\n255\n" % (W, H)); fh.write(b"".join(rows))
print(len(pats), "patterns")
