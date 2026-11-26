// @common  Corner marble run (2.25): marbles drop from the ceiling onto ramps on
// the left wall, zigzag down, jump the seam onto the right wall, roll into a
// funnel at the vertical seam and spiral down a clear tube around it. The
// track builds itself first. Marble paths come from skyd (sims.c).

uniform vec4 u_obj[4];    // marbles: centre, w > 0 in play
uniform vec4 u_ramp[4];   // a0 (negative: right wall), d0, a1, d1

const float MR = 0.014;   // marble radius
const float TUBE = 0.07;  // tube axis: y = z = TUBE
const float TR = 0.032;   // tube radius
const float RT = 0.010, RD = 0.040;   // ramp thickness and depth out of the wall

// ray vs a sloped ramp on a wall; t or 1e9
float rampHit(vec3 ro, vec3 rd, vec4 r, float grow, out vec3 nw) {
    bool right = r.x < 0.0;
    vec2 A = vec2(abs(r.x), r.y), B = vec2(r.z, r.w);
    B = A + (B - A) * grow;
    vec3 wn = right ? vec3(0, 1, 0) : vec3(0, 0, 1);
    vec3 ta = right ? vec3(0, 0, 1) : vec3(0, 1, 0);       // along the wall
    vec3 td = vec3(1, 0, 0);                               // down the wall
    vec2 m = (A + B) * 0.5, dir = normalize(B - A);
    float hl = length(B - A) * 0.5;
    vec3 c = ta * m.x + td * m.y + wn * RD * 0.5;
    vec3 ax = normalize(ta * dir.x + td * dir.y);          // along the ramp
    vec3 ay = cross(wn, ax);                               // across (thickness)
    vec3 o = ro - c, lo = vec3(dot(o, ax), dot(o, ay), dot(o, wn)), ld = vec3(dot(rd, ax), dot(rd, ay), dot(rd, wn));
    vec3 nl;
    float tt = hl > 0.002 ? boxHit(lo, ld, vec3(-hl, -RT * 0.5, -RD * 0.5), vec3(hl, RT * 0.5, RD * 0.5), nl) : 1e9;
    nw = nl.x * ax + nl.y * ay + nl.z * wn;
    return tt;
}

void main() {
    vec3 ro = u_campos, rd = viewRay(), n;
    float t = roomHit(ro, rd, n);
    if (t > 1e8) { gl_FragColor = vec4(0.0); return; }
    if (maskOut(ro + rd * t, n) > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    vec3 L = normalize(vec3(-0.6, 0.55, 0.5));
    float T = u_time;
    float gone = smoothstep(28.0, 29.5, T);                // the track takes itself apart

    // ramps (they build one after another)
    float tr = 1e9; vec3 nr = vec3(0.0);
    for (int i = 0; i < 4; i++) {
        float grow = smoothstep(0.4 + float(i) * 0.7, 1.0 + float(i) * 0.7, T) * (1.0 - gone);
        vec3 nn;
        float tt = rampHit(ro, rd, u_ramp[i], grow, nn);
        if (tt < tr) { tr = tt; nr = nn; }
    }
    // marbles
    float tm = 1e9, im = 0.0; vec3 nm = vec3(0.0);
    for (int i = 0; i < 4; i++) {
        float tt = u_obj[i].w < 0.0 ? 1e9 : sphereHit(ro, rd, u_obj[i].xyz, MR);
        if (tt < tm) { tm = tt; im = float(i); nm = normalize(ro + rd * tt - u_obj[i].xyz); }
    }
    float tube = smoothstep(3.0, 3.8, T) * (1.0 - gone);

    vec3 col;
    float ts = min(t, tr);
    if (tm < ts) {
        vec3 base = hue(0.55 + im * 0.21) * 0.8 + 0.2;
        col = base * (0.25 + 0.8 * max(dot(nm, L), 0.0)) + vec3(0.9) * pow(max(dot(nm, normalize(L - rd)), 0.0), 50.0);
    } else if (tr < t) {
        col = vec3(0.55, 0.6, 0.7) * (0.25 + 0.7 * max(dot(nr, L), 0.0));
        if (nr.x < -0.5) col += 0.1;   // top edge
    } else {
        vec3 p = ro + rd * t;
        if (maskOut(p, n) > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        col = vec3(0.03, 0.035, 0.05) + vec3(0.05, 0.065, 0.11) * gridLine(faceUV(p, n), 0.1, 0.004);
        float sh = 1.0;
        for (int i = 0; i < 4; i++) sh *= u_obj[i].w < 0.0 ? 1.0 : sphereShadow(p, L, u_obj[i].xyz, MR);
        col *= sh;
        // the hole in the ceiling the marbles drop from
        if (n.x > 0.5) {
            float dh = length(p.yz - vec2(0.30 * u_mask, MR + 0.004));
            col = mix(col, vec3(0.0), 1.0 - smoothstep(0.02, 0.024, dh));
            col += vec3(0.4, 0.6, 1.0) * exp(-pow((dh - 0.024) / 0.003, 2.0)) * 0.6;
        }
        col += vec3(0.22, 0.25, 0.33) * edgeLines(p, n, 0.005) * 0.5;
    }
    // the clear tube around the vertical seam: bright where the ray grazes it
    {
        vec2 o = ro.yz - vec2(TUBE), d = rd.yz;
        float a = dot(d, d), b = dot(o, d), c = dot(o, o) - TR * TR, h = b * b - a * c;
        float top = 0.88 * u_maskd - 0.01;
        if (h > 0.0 && tube > 0.0) {
            float s = sqrt(h);
            for (int k = 0; k < 2; k++) {
                float tt = (-b + (k == 0 ? -s : s)) / a;
                vec3 q = ro + rd * tt;
                if (tt > 0.0 && tt < min(ts, tm) + (k == 0 ? 0.0 : 1.0) && q.x > top && q.x < u_maskd) {
                    vec3 nn = normalize(vec3(0.0, q.y - TUBE, q.z - TUBE));
                    float graze = pow(1.0 - abs(dot(nn, rd)), 3.0);
                    col += vec3(0.5, 0.75, 1.0) * (0.06 + 0.7 * graze) * tube * (tt < tm ? 1.0 : 0.4);
                }
            }
        }
        // the funnel's rim: a ring at the top of the tube
        float tp = (top - ro.x) / rd.x;
        vec3 q = ro + rd * tp;
        float rr = length(q.yz - vec2(TUBE));
        col += vec3(0.6, 0.85, 1.0) * exp(-pow((rr - TR * 1.7) / 0.003, 2.0)) * tube * step(tp, min(ts, tm) + 0.5);
    }
    gl_FragColor = vec4(col, 1.0);
}
