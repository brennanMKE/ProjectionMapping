// @common  Window into a bigger room (2.2): portals open on each surface,
// growing out from the seams. Behind all three is ONE deep gridded space,
// rendered from the viewer's eye, so the depth agrees across the portals.
// Three tempos in the 20 s loop:
//   0-7.5 s   one slow portal, cool colours
//   7.5-13.5  the portal snaps open on the beat (every 2 beats), new colour each time
//   13.5-20   nested inner windows grow one after another, then all close
// Each window floods with its colour as it grows, flares bright, then fades
// quickly so only its border lines and the deep room remain.

const float B = 2.6;    // the room behind extends this far beyond each wall

// window k: how far open (0..1), how big relative to the full portal,
// seconds since it started growing, and its hue
void win(int k, float T, out float open, out float scl, out float age, out float hu) {
    open = 0.0; scl = 1.0; age = 99.0; hu = 0.6;
    float fk = float(k);
    if (T < 7.5) {
        if (k == 0) { open = smoothstep(1.0, 4.5, T) * (1.0 - smoothstep(7.0, 7.5, T)); age = T - 1.0; hu = 0.6; }
    } else if (T < 13.5) {
        float ph = T - 7.5, i = floor(ph), fr = ph - i;
        if (k == 0) {
            open = smoothstep(0.0, 0.3, fr) * (1.0 - smoothstep(0.82, 1.0, fr) * step(i, 4.5));
            age = fr; hu = fract(0.95 + i * 0.27);
        }
    } else {
        float s = 13.5 + (fk == 0.0 ? 0.0 : 0.5 + fk * 0.7);
        open = smoothstep(s, s + 0.45, T) * (1.0 - smoothstep(18.6 + (3.0 - fk) * 0.25, 19.0 + (3.0 - fk) * 0.25, T));
        scl = 1.0 - fk * 0.24;
        age = T - s; hu = fract(0.78 + fk * 0.19);
        if (k == 0) {   // the last beat window stays open and carries over
            open = 1.0 - smoothstep(19.35, 19.75, T);
            age = 99.0; hu = 0.3;
        }
    }
}

void main() {
    vec3 ro = u_campos, rd = viewRay(), n;
    float t = roomHit(ro, rd, n);
    if (t > 1e8) { gl_FragColor = vec4(0.0); return; }
    vec3 p = ro + rd * t;
    float mo = maskOut(p, n);
    if (mo > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

    float T = mod(u_time, 20.0);
    vec2 uv = faceUV(p, n), sz = faceSize(n);
    vec2 lo = vec2(0.06);
    float fid = n.x > 0.5 ? 0.0 : (n.z > 0.5 ? 1.0 : 2.0);

    // which windows contain this pixel; the innermost one sets the colour
    float inside = 0.0, frame = 0.0, flash = 0.0, hu = 0.6;
    vec3 fillc = vec3(0.0);
    for (int k = 0; k < 4; k++) {
        float op, sc, age, h;
        win(k, T, op, sc, age, h);
        vec2 hi = lo + (sz - 2.0 * lo) * sc * op;
        vec2 e = min(uv - lo, hi - uv);
        float m = min(e.x, e.y);
        if (op > 0.002 && m > 0.0) {
            inside = 1.0; hu = h;
            // colour fill: in quickly, flare, gone in about half a second
            float f = smoothstep(0.0, 0.12, age) * exp(-max(age - 0.12, 0.0) * 5.0);
            flash = f;
            fillc = hue(h + fid * 0.06);
        }
        if (op > 0.002) frame = max(frame, (1.0 - smoothstep(0.002, 0.007, abs(m))) * step(-0.007, min(uv.x - lo.x, uv.y - lo.y)));
    }

    vec3 col;
    if (inside > 0.5) {
        // continue the ray into the big room: its walls are the planes x,y,z = -B
        float tb = 1e9; vec3 nb = vec3(0.0);
        if (rd.x < 0.0) { float s = (-B - p.x) / rd.x; if (s < tb) { tb = s; nb = vec3(1, 0, 0); } }
        if (rd.y < 0.0) { float s = (-B - p.y) / rd.y; if (s < tb) { tb = s; nb = vec3(0, 1, 0); } }
        if (rd.z < 0.0) { float s = (-B - p.z) / rd.z; if (s < tb) { tb = s; nb = vec3(0, 0, 1); } }
        vec3 q = p + rd * tb;
        vec2 quv = faceUV(q, nb);
        float g = gridLine(quv, 0.5, 0.02);
        float fog = exp(-tb * 0.35);
        float bid = nb.x > 0.5 ? 0.0 : (nb.z > 0.5 ? 1.0 : 2.0);
        vec3 tint = mix(vec3(0.5), hue(hu + bid * 0.1), 0.75);
        col = (vec3(0.02, 0.03, 0.06) + tint * g * 0.9) * fog;
        // stars far away in the depths
        float st = step(0.995, hash(floor(quv * 18.0)));
        col += vec3(0.8, 0.85, 1.0) * st * fog * 0.6;
        col = mix(col, fillc * 1.3, flash * 0.85);
    } else {
        col = vec3(0.03, 0.035, 0.05) + vec3(0.05, 0.06, 0.09) * gridLine(uv, 0.2, 0.006);
        col += vec3(0.25, 0.3, 0.4) * edgeLines(p, n, 0.006);
    }
    col += mix(vec3(0.6, 0.7, 0.9), hue(hu) * 0.8 + 0.3, 0.6) * frame;
    gl_FragColor = vec4(col, 1.0);
}
