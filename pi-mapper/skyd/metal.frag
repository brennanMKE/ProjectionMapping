// @common  Liquid metal (2.22): a pool of mercury-like chrome seeps out of the
// vertex and spreads over the whole ceiling, spills over both ceiling seams
// and runs down the walls in rivulets with heavy beads at their heads. Big
// drops swell on the underside of the ceiling pool, neck, and fall in front
// of the walls, casting shadows. At the end it all drains back into the corner.
// The pool and rivulets are surface effects (shaded from their own normals,
// so they hold up from anywhere); only the hanging drop is ray-marched, and
// only inside a small box around it. Chrome reflects the room's own grid.

const float PER = 20.0;
const float G = 0.7;          // slow-motion gravity (m/s^2)

float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float sdCaps(vec3 p, vec3 a, vec3 b, float r) { vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }

// per-frame drip state (same for every pixel)
vec3 S; float RB, HANG, NECK; vec3 DC; float DR, DSTR; float FALLING;

float map(vec3 q) {
    float d = q.x - 0.006;                                   // the ceiling pool's underside
    if (RB > 0.001) {
        vec3 bc = S + vec3(HANG, 0.0, 0.0);
        d = smin(d, length(q - bc) - RB, 0.022);
        d = smin(d, sdCaps(q, S, bc, RB * NECK), 0.01);
    }
    if (FALLING > 0.5) {
        vec3 e = (q - DC) * vec3(1.0 / DSTR, 1.0, 1.0);
        d = smin(d, length(e) * min(DSTR, 1.0) - DR, 0.012);
    }
    return d;
}

// what chrome sees: the room's own walls (grid) or the open room behind the viewer
vec3 env(vec3 p, vec3 r) {
    vec3 nh;
    float th = roomHit(p + r * 0.002, r, nh);
    if (th < 0.8) {
        vec3 h = p + r * th;
        // reflected room: pale walls lit from above, with dark grid lines
        float g = gridLine(faceUV(h, nh), 0.1, 0.008);
        vec3 wall = mix(vec3(0.75, 0.78, 0.85), vec3(0.22, 0.25, 0.32), smoothstep(0.0, 0.5, h.x));
        return wall * (1.0 - 0.75 * g) + vec3(0.4, 0.6, 1.0) * g * 0.25;
    }
    // the open room: a dim floor with a grid far below, a bright horizon band
    // and a couple of big soft lamps
    float down = r.x;
    vec3 c = mix(vec3(0.55, 0.6, 0.7), vec3(0.05, 0.05, 0.07), smoothstep(-0.1, 0.5, down));
    c = mix(c, vec3(0.06, 0.07, 0.1), smoothstep(0.1, -0.6, down));
    if (down > 0.05) {
        vec2 f = p.yz + r.yz * (2.4 - p.x) / down;
        c += vec3(0.25, 0.2, 0.15) * gridLine(f, 0.6, 0.03) * exp(-length(f) * 0.25);
    }
    c += vec3(0.8, 0.85, 1.0) * exp(-down * down * 60.0) * 0.5;
    c += vec3(1.2, 1.1, 1.0) * smoothstep(0.9, 0.96, dot(r, normalize(vec3(0.2, 1.0, 0.3))));
    c += vec3(0.9, 1.0, 1.2) * smoothstep(0.93, 0.97, dot(r, normalize(vec3(0.3, 0.2, 1.0))));
    return c;
}

vec3 chrome(vec3 p, vec3 nn, vec3 rd, vec3 L) {
    vec3 r = reflect(rd, nn);
    float fres = 0.65 + 0.35 * pow(1.0 - max(dot(-rd, nn), 0.0), 4.0);
    return env(p, r) * vec3(0.92, 0.95, 1.0) * fres + vec3(1.0) * pow(max(dot(r, L), 0.0), 60.0) * 1.2;
}

void main() {
    vec3 ro = u_campos, rd = viewRay(), n;
    float t = roomHit(ro, rd, n);
    if (t > 1e8) { gl_FragColor = vec4(0.0); return; }
    vec3 p = ro + rd * t;
    float mo = maskOut(p, n);
    if (mo > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

    float T = mod(u_time, PER);
    vec3 L = normalize(vec3(-0.7, 0.5, 0.5));
    float k = u_mask / 0.6;
    // pool radius on the ceiling: seeps out, holds, drains back into the vertex
    float R0 = 0.9 * u_mask * smoothstep(0.0, 5.0, T) * (1.0 - smoothstep(17.0, 19.8, T)) + 0.02;
    // rivulets: how far they have run (0..1 of the way down), and how fat they still are
    float run = smoothstep(2.5, 11.0, T);
    float fat = 1.0 - smoothstep(16.0, 18.5, T);

    // ---- drip state: three drops, 4 s each, from three sites near the vertex
    RB = 0.0; FALLING = 0.0; HANG = 0.0; NECK = 0.4;
    float u = T - 5.0;
    if (u > 0.0 && u < 12.0) {
        float id = floor(u / 4.0);
        u = mod(u, 4.0);
        S = vec3(0.0, 0.17, 0.17) * k;
        if (id > 0.5) S = vec3(0.0, 0.31, 0.11) * k;
        if (id > 1.5) S = vec3(0.0, 0.11, 0.30) * k;
        float rmax = 0.062 * k;
        RB = rmax * smoothstep(0.0, 2.6, u) * (1.0 - smoothstep(3.0, 3.7, u));
        HANG = RB * 0.5 + 0.035 * smoothstep(1.6, 2.95, u) * (1.0 - smoothstep(3.0, 3.4, u));
        NECK = 0.45 * (1.0 - smoothstep(2.6, 3.0, u));
        if (u > 2.95) {
            float w = u - 2.95;
            FALLING = 1.0;
            DC = S + vec3(rmax * 0.5 + 0.035 + 0.5 * G * w * w, 0.0, 0.0);
            DR = rmax * 0.9 * (1.0 - smoothstep(0.5 * u_maskd, 1.0 * u_maskd, DC.x));
            DSTR = 1.0 + min(w * 0.8, 0.5);
        }
    }

    // ---- the real surface: dark grid, with the pool and rivulets on top
    vec2 uv = faceUV(p, n);
    vec3 tu, tv;
    faceAxes(n, tu, tv);
    vec3 col = roomBase(p, n) * 1.4;
    float metal = 0.0;
    vec3 nn = n;
    if (n.x > 0.5) {
        // ceiling pool with a wobbly rounded edge
        float r = length(uv);
        float th = atan(uv.y, uv.x);
        float R = R0 * (1.0 + 0.05 * sin(th * 6.0 + T * 0.9) + 0.03 * sin(th * 11.0 - T * 1.7));
        float e = (R - r) / 0.025;                           // 0 at the edge, 1 a bit inside
        if (e > 0.0) {
            metal = 1.0;
            float s = 1.0 - min(e, 1.0);
            vec2 radial = uv / max(r, 1e-4);
            // flowing ripples outward from the vertex
            float rip = sin(r * 60.0 - T * 4.0) * 0.06 * exp(-r * 4.0) + sin(uv.x * 37.0 + uv.y * 23.0 + T) * 0.03;
            vec2 slope = radial * (s * s * 2.2 + rip);
            nn = normalize(n + tu * slope.x + tv * slope.y);
        } else {
            col *= 1.0 - 0.5 * exp(e * 0.6);                  // dark damp ring just outside
        }
    } else {
        // the pool spills over the ceiling seam as a lip...
        float a = uv.x, x = uv.y;
        float seamR = R0 * 0.97;
        float lipOn = 1.0 - smoothstep(seamR - 0.03, seamR, a);
        float lip = 0.02 * lipOn;
        float hgt = 0.0; vec2 sl = vec2(0.0);
        if (x < lip) { hgt = 1.0; float s = x / max(lip, 1e-4); sl = vec2(0.0, s * s * 1.8); }
        // ...and runs down the wall as rivulets with a bead at each head
        float wid = n.z > 0.5 ? 0.0 : 1.0;
        for (int i = 0; i < 3; i++) {
            float fi = float(i);
            float a0 = (0.1 + 0.16 * fi + 0.04 * wid) * u_mask;
            float on = step(a0, seamR - 0.02);
            float sp = 0.75 + 0.35 * fract(sin(fi * 7.1 + wid * 3.3) * 43.7);
            float xh = min(run * sp, 1.0) * u_maskd * 0.92;      // head position
            float ac = a0 + 0.012 * sin(x * 28.0 + fi * 2.0 + wid) + 0.006 * sin(x * 61.0 + fi);
            float w = (0.012 + 0.005 * sin(x * 33.0 - T * 3.0 + fi * 5.0)) * fat * on;
            float da = a - ac;
            if (x < xh && abs(da) < w) {
                float s = da / w;
                hgt = 1.0; sl = vec2(s * 1.4, 0.0);
            }
            float rb = (0.032 - 0.014 * xh / u_maskd) * fat * on * step(0.001, xh);
            vec2 dv = vec2(a - ac, x - xh);
            float dl = length(dv);
            if (dl < rb) { hgt = 1.0; sl = dv / rb * 1.6; }
        }
        if (hgt > 0.0) {
            metal = 1.0;
            nn = normalize(n + tu * sl.x + tv * sl.y);
        } else {
            // wet streak and soft shadows on the wall
            col *= 1.0 - 0.45 * lipOn * exp(-x / 0.03);
        }
    }
    if (metal > 0.5) col = chrome(p, nn, rd, L);

    // shadows of the hanging and falling drops on the walls (view-independent)
    if (n.x < 0.5 && metal < 0.5) {
        if (RB > 0.001) col *= sphereShadow(p, L, S + vec3(HANG, 0.0, 0.0), RB);
        if (FALLING > 0.5 && DR > 0.001) col *= sphereShadow(p, L, DC, DR);
    }

    // ---- the hanging drop: march only inside a small box around it
    if (RB > 0.001 || FALLING > 0.5) {
        float bx = FALLING > 0.5 ? DC.x + DR * 2.0 : HANG + RB + 0.01;
        vec3 bmin = vec3(-0.01, S.y - 0.065, S.z - 0.065), bmax = vec3(bx, S.y + 0.065, S.z + 0.065);
        vec3 inv = 1.0 / rd;
        vec3 t1 = (bmin - ro) * inv, t2 = (bmax - ro) * inv;
        float tN = max(max(min(t1.x, t2.x), min(t1.y, t2.y)), min(t1.z, t2.z));
        float tF = min(min(max(t1.x, t2.x), max(t1.y, t2.y)), max(t1.z, t2.z));
        if (tN < tF && tN < t) {
            float tt = max(tN, 0.0), te = min(tF, t);
            for (int i = 0; i < 32; i++) {
                vec3 q = ro + rd * tt;
                float d = map(q);
                if (d < 0.0006) {
                    if (q.x > 0.008) {
                        vec2 e = vec2(0.0008, -0.0008);
                        vec3 qn = normalize(e.xyy * map(q + e.xyy) + e.yyx * map(q + e.yyx) + e.yxy * map(q + e.yxy) + e.xxx * map(q + e.xxx));
                        col = chrome(q, qn, rd, L);
                    }
                    break;
                }
                tt += max(d, 0.0008);
                if (tt > te) break;
            }
        }
    }

    col += vec3(0.2, 0.22, 0.3) * edgeLines(p, n, 0.005) * 0.5 * (1.0 - metal);
    gl_FragColor = vec4(col, 1.0);
}
