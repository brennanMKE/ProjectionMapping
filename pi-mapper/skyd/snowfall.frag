// @common  Snowfall with build-up (2.21): the ceiling is an overcast night sky
// the snow comes out of; flakes fall in the space in front of the two walls,
// nearer flakes bigger and softer, and settle on the ledges as growing white
// ridges, then melt away. Flakes live on layers facing the viewer, so depth
// comes from the viewer camera; all closed-form.
// No flakes are drawn over the ceiling: they fade in below the ceiling seams,
// fade out toward the shape's outer edge and thin out at the vertical seam,
// so nothing gets clipped by a real edge.

const int LAYERS = 6;

void main() {
    vec3 ro = u_campos, rd = viewRay(), n;
    float t = roomHit(ro, rd, n);
    if (t > 1e8) { gl_FragColor = vec4(0.0); return; }
    vec3 p0 = ro + rd * t;
    if (maskOut(p0, n) > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

    float T = mod(u_time, 25.0);
    float pile = smoothstep(2.0, 18.0, T) * (1.0 - smoothstep(19.5, 24.0, T));
    float hs = 0.016 * pile;                       // snow depth on the ledges

    // surfaces: ledges (with their snow) or the room
    vec3 nl; float lid;
    vec3 col;
    float tl = 1e9;
    {
        float best = 1e9; vec3 bn = vec3(0.0); float sn = 0.0;
        for (int i = 0; i < 3; i++) {
            vec3 lo, hi, nn;
            ledgeBox(i, lo, hi);
            float tt = boxHit(ro, rd, lo - vec3(hs, 0.0, 0.0), hi, nn);
            if (tt < best) {
                best = tt; bn = nn;
                vec3 q = ro + rd * tt;
                float along = hi.z < 0.1 ? q.y : q.z;
                float bump = 0.5 + 0.5 * sin(along * 90.0 + float(i) * 3.0) * sin(along * 37.0);
                sn = q.x < lo.x - hs * 0.15 * bump ? 1.0 : 0.0;
            }
        }
        tl = best; nl = bn; lid = sn;
    }
    vec3 L = normalize(vec3(-0.6, 0.55, 0.5));
    if (tl < t) {
        col = lid > 0.5 ? vec3(0.85, 0.9, 1.0) * (0.45 + 0.5 * max(dot(nl, L), 0.0)) : shadeLedge(nl, vec3(0.28, 0.25, 0.22));
        t = tl;
    } else {
        col = vec3(0.02, 0.025, 0.045) + vec3(0.03, 0.04, 0.07) * gridLine(faceUV(p0, n), 0.1, 0.004);
        if (n.x > 0.5) {
            // the ceiling: slow overcast clouds, a little brighter toward the seams where the snow appears
            vec2 c = p0.yz * 7.0 + vec2(u_time * 0.05, u_time * 0.03);
            float cl = sin(c.x + sin(c.y * 1.3 + u_time * 0.1)) * sin(c.y * 0.9 - sin(c.x * 0.7));
            cl = 0.5 + 0.5 * cl;
            float glow = exp(-min(p0.y, p0.z) / 0.12);
            col = vec3(0.03, 0.035, 0.06) + vec3(0.07, 0.08, 0.11) * cl * cl + vec3(0.05, 0.06, 0.09) * glow;
        }
        // falling light: the walls are lit a little from the sky above
        else col += vec3(0.03, 0.035, 0.05) * exp(-p0.x / 0.1);
        col *= 1.0 - 0.6 * ledgeUnderShadow(p0, n);
        col += vec3(0.2, 0.22, 0.3) * edgeLines(p0, n, 0.005) * 0.5;
    }

    // where flakes may show: only in front of the walls, fading in below the
    // ceiling seams, out toward the outer edge, and thinner at the vertical seam
    vec2 fuv = faceUV(p0, n);
    float vis = n.x > 0.5 ? 0.0 : smoothstep(0.02, 0.09, p0.x);
    vis *= smoothstep(0.0, 0.06, -maskOut(p0, n));
    vis *= 0.35 + 0.65 * smoothstep(0.0, 0.06, fuv.x);

    // flakes on layers between the viewer and the surface
    if (vis > 0.01) {
        vec3 A = normalize(u_campos);
        vec3 dn = normalize(vec3(1.0, 0.0, 0.0) - A * A.x);    // screen "down" in the room
        vec3 rt = cross(A, dn);
        float ra = dot(rd, A), oa = dot(ro, A);
        for (int k = 0; k < LAYERS; k++) {
            float fk = float(k);
            float D = 0.08 + fk * 0.13;                        // distance of the layer from the vertex
            float tk = (D - oa) / ra;
            vec3 q = ro + rd * tk;
            float cs = 0.028 + fk * 0.006;                     // cell size grows with nearness
            vec2 uv = vec2(dot(q, rt), dot(q, dn));
            uv.y -= u_time * (0.035 + fk * 0.008);
            uv.x += 0.02 * sin(u_time * 0.5 + uv.y * 9.0 + fk);
            vec2 id = floor(uv / cs), f = uv / cs - id;
            float on = step(hash(id + fk * 13.1), 0.55) * step(0.0, tk) * step(tk, t);
            vec2 o = vec2(hash(id + 3.7 + fk), hash(id + 9.2 + fk)) * 0.6 + 0.2;
            float rad = 0.08 + fk * 0.025;                     // nearer: bigger
            float soft = 0.4 + fk * 0.1;                       // and blurrier
            float a = smoothstep(rad, rad * (1.0 - soft), length(f - o));
            col = mix(col, vec3(0.9, 0.93, 1.0), on * a * vis * (0.55 + fk * 0.06));
        }
    }
    gl_FragColor = vec4(col, 1.0);
}
