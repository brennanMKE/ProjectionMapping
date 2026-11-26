// @common  Gravity carousel (2.23): balls and blocks rest on one face as if it
// were the floor. Gravity swings, they slide and tumble over the seam onto
// the next face, which becomes the floor. Physics in skyd (sims.c).

uniform vec4 u_obj[6];   // centre, radius (negative: a block)
uniform vec3 u_grav;      // unit gravity

void main() {
    vec3 ro = u_campos, rd = viewRay(), n;
    float t = roomHit(ro, rd, n);
    if (t > 1e8) { gl_FragColor = vec4(0.0); return; }
    vec3 p = ro + rd * t;
    if (maskOut(p, n) > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    vec3 L = normalize(-u_grav + vec3(-0.25, 0.2, 0.2));

    float tb = 1e9, ib = 0.0; vec3 nb = vec3(0.0);
    for (int i = 0; i < 6; i++) {
        vec4 o = u_obj[i];
        float r = abs(o.w);
        // both tests, then pick (plain code is kinder to the Pi's compiler than branches)
        float tsph = sphereHit(ro, rd, o.xyz, r);
        vec3 nbox;
        float tbox = boxHit(ro, rd, o.xyz - vec3(r * 0.85), o.xyz + vec3(r * 0.85), nbox);
        float tt = o.w > 0.0 ? tsph : tbox;
        vec3 nn = o.w > 0.0 ? normalize(ro + rd * tsph - o.xyz) : nbox;
        if (tt < tb) { tb = tt; ib = float(i); nb = nn; }
    }
    vec3 col;
    if (tb < t) {
        vec3 base = hue(0.07 + ib * 0.137) * 0.8 + 0.15;
        vec3 h = normalize(L - rd);
        col = base * (0.2 + 0.85 * max(dot(nb, L), 0.0)) + vec3(0.6) * pow(max(dot(nb, h), 0.0), 30.0);
    } else {
        // the current floor is lit a little warmer
        float floor_ = max(dot(n, -u_grav), 0.0);
        col = vec3(0.04, 0.045, 0.065) + vec3(0.08, 0.1, 0.17) * gridLine(faceUV(p, n), 0.1, 0.004);
        col += vec3(0.07, 0.05, 0.03) * floor_;
        float sh = 1.0;
        for (int i = 0; i < 6; i++) {
            vec3 dc = u_obj[i].xyz - p;
            if (dot(dc, dc) < 0.01) sh *= sphereShadow(p, -u_grav, u_obj[i].xyz, abs(u_obj[i].w));
        }
        col *= sh;
        col += vec3(0.22, 0.25, 0.33) * edgeLines(p, n, 0.005) * 0.6;
    }
    gl_FragColor = vec4(col, 1.0);
}
