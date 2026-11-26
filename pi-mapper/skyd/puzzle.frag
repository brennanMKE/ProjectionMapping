// @common  Twisty puzzle cube corner (2.18): a big 3x3 cube sits in the corner
// with its outer corner pointing at the viewer. Its layers turn on the beat,
// scrambling the coloured squares across all three faces, then it solves.
// Plain six-colour set, no logo. Needs the viewer's sweet spot.

const float H = 0.13;            // half size of the cube (m)
const float TURN = 1.0;          // seconds per quarter turn

// move i: axis 0..2, layer -1/+1, direction +-1; four scramble moves then their inverses
void move(int i, out int axis, out float layer, out float dir) {
    int k = i < 4 ? i : 7 - i;
    float inv = i < 4 ? 1.0 : -1.0;
    if (k == 0) { axis = 0; layer = 1.0; dir = 1.0; }
    else if (k == 1) { axis = 1; layer = 1.0; dir = -1.0; }
    else if (k == 2) { axis = 2; layer = 1.0; dir = 1.0; }
    else { axis = 0; layer = -1.0; dir = -1.0; }
    dir *= inv;
}
float moveStart(int i) { return 1.5 + float(i) * 1.6 + (i >= 4 ? 1.5 : 0.0); }

vec3 rot(vec3 q, int axis, float a) {
    float c = cos(a), s = sin(a);
    if (axis == 0) return vec3(q.x, c * q.y - s * q.z, s * q.y + c * q.z);
    if (axis == 1) return vec3(c * q.x + s * q.z, q.y, -s * q.x + c * q.z);
    return vec3(c * q.x - s * q.y, s * q.x + c * q.y, q.z);
}
float comp(vec3 q, int axis) { return axis == 0 ? q.x : axis == 1 ? q.y : q.z; }

vec3 faceColour(vec3 nrm) {
    if (nrm.x > 0.5) return vec3(0.95, 0.95, 0.92);   // white
    if (nrm.x < -0.5) return vec3(1.0, 0.85, 0.1);    // yellow
    if (nrm.y > 0.5) return vec3(0.9, 0.12, 0.1);     // red
    if (nrm.y < -0.5) return vec3(1.0, 0.5, 0.05);    // orange
    if (nrm.z > 0.5) return vec3(0.1, 0.35, 0.95);    // blue
    return vec3(0.1, 0.7, 0.25);                      // green
}

void main() {
    vec3 ro = u_campos, rd = viewRay(), n;
    float t = roomHit(ro, rd, n);
    if (t > 1e8) { gl_FragColor = vec4(0.0); return; }
    vec3 p = ro + rd * t;
    if (maskOut(p, n) > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

    float T = mod(u_time, 20.0);
    float appear = smoothstep(0.0, 1.0, T) * (1.0 - smoothstep(18.5, 19.8, T));
    vec3 C = vec3(H + 0.001);                     // centre: the cube touches all three surfaces
    // current move and its progress
    int cur = -1; float prog = 0.0;
    for (int i = 0; i < 8; i++) {
        float s0 = moveStart(i);
        if (T >= s0 && T < s0 + TURN) { cur = i; prog = smoothstep(0.0, 1.0, (T - s0) / TURN); }
    }
    // trace: the turning slab (rotated box) and the rest (axis-aligned box)
    vec3 o = ro - C;
    float tb = 1e9; vec3 nl = vec3(0.0), ql = vec3(0.0);
    int ax = 0; float ly = 0.0, dr = 0.0;
    if (cur >= 0) move(cur, ax, ly, dr);
    float ang = cur >= 0 ? dr * prog * PI * 0.5 : 0.0;
    vec3 lo = vec3(-H), hi = vec3(H);
    vec3 slo = lo, shi = hi;
    if (cur >= 0) {
        float a0 = ly > 0.0 ? H / 3.0 : -H, a1 = ly > 0.0 ? H : -H / 3.0;
        if (ax == 0) { slo.x = a0; shi.x = a1; if (ly > 0.0) hi.x = H / 3.0; else lo.x = -H / 3.0; }
        else if (ax == 1) { slo.y = a0; shi.y = a1; if (ly > 0.0) hi.y = H / 3.0; else lo.y = -H / 3.0; }
        else { slo.z = a0; shi.z = a1; if (ly > 0.0) hi.z = H / 3.0; else lo.z = -H / 3.0; }
        vec3 nn;
        vec3 o2 = rot(o, ax, -ang), d2 = rot(rd, ax, -ang);
        float ts = boxHit(o2, d2, slo, shi, nn);
        if (ts < tb) { tb = ts; nl = nn; ql = o2 + d2 * ts; }
    }
    { vec3 nn; float tr = boxHit(o, rd, lo, hi, nn); if (tr < tb) { tb = tr; nl = nn; ql = o + rd * tr; } }

    vec3 col = roomBase(p, n);
    vec3 Lw = normalize(vec3(-0.7, 0.5, 0.4));
    // the cube's shadow on the walls
    { vec3 nn; if (boxHit(p - C + n * 0.001, Lw, vec3(-H), vec3(H), nn) < 1e8) col *= 0.35; }
    if (appear > 0.01 && tb < t) {
        // sticker grid: gaps between the 3x3 cells (same in any orientation)
        vec3 a = abs(ql) / (2.0 * H / 3.0);
        vec3 fr = abs(fract(a + 0.5) - 0.5);
        float gap = 1.0;
        if (abs(nl.x) < 0.5) gap = min(gap, fr.x);
        if (abs(nl.y) < 0.5) gap = min(gap, fr.y);
        if (abs(nl.z) < 0.5) gap = min(gap, fr.z);
        // undo the moves so far to find where this sticker started
        vec3 q = ql * 0.999, nrm = nl;
        for (int i = 7; i >= 0; i--) {
            float s0 = moveStart(i);
            if (T < s0 + TURN && i != cur) continue;
            if (i == cur) continue;          // the current move is already undone by tracing in its frame
            int a2; float l2, d2;
            move(i, a2, l2, d2);
            if (comp(q, a2) * l2 > H / 3.0 - 1e-4) { q = rot(q, a2, -d2 * PI * 0.5); nrm = rot(nrm, a2, -d2 * PI * 0.5); }
        }
        vec3 wn = nl;
        if (cur >= 0 && dot(abs(ql), vec3(1.0)) > 0.0) {
            // world normal of a slab hit: rotate back by the current angle
            bool inSlab = comp(ql, ax) * ly > H / 3.0 - 1e-3;
            if (inSlab) wn = rot(nl, ax, ang);
        }
        vec3 sc = faceColour(nrm) * (0.25 + 0.75 * max(dot(wn, Lw), 0.0) + 0.15);
        sc = mix(vec3(0.02), sc, smoothstep(0.035, 0.07, gap));
        col = mix(col, sc * 0.85, appear);
    }
    col += vec3(0.2, 0.22, 0.3) * edgeLines(p, n, 0.005) * 0.4;
    gl_FragColor = vec4(col, 1.0);
}
