// @common  Bouncing balls (2.14): balls drop out of portals in the ceiling,
// bounce on ledges, roll along them, fall off the ends and leave the picture.
// Closed-form physics (deterministic for any time), computed once per frame
// by skyd (balls_update) and passed in as u_b0..u_b3. Each ball's shadow
// tightens and darkens as it nears a surface: that's the main depth cue.

const float R = 0.034;    // ball radius (keep in step with balls.vert)
const float P = 6.0;
const vec3 L = vec3(-0.55, 0.6, 0.58);   // toward the light (x negative is up)
uniform vec4 u_b0, u_b1, u_b2, u_b3;     // from skyd (centre, squash; x < -2 when not in play)

vec4 ballAt(int i) { return i == 0 ? u_b0 : i == 1 ? u_b1 : i == 2 ? u_b2 : u_b3; }
vec3 ballColour(float fi) {
    float cyc = floor(max(u_time - fi * 1.5, 0.0) / P);
    return hue(0.08 + fi * 0.23 + cyc * 0.31) * 0.8 + 0.2;
}

void main() {
    vec3 ro = u_campos, rd = viewRay(), n;
    float t = roomHit(ro, rd, n);
    if (t > 1e8) { gl_FragColor = vec4(0.0); return; }
    vec3 Ln = normalize(L);

    vec3 nl; float lid;
    float tl = ledgeHit(ro, rd, nl, lid);
    float tb = 1e9, ib = 0.0; vec3 nb = vec3(1.0, 0.0, 0.0);
    for (int i = 0; i < 4; i++) {
        vec4 b = ballAt(i);
        if (b.x > -2.0) {
            // squash: flatten along x, widen sideways
            vec3 Sq = vec3(1.0 - b.w, 1.0 + b.w * 0.5, 1.0 + b.w * 0.5);
            vec3 o = (ro - b.xyz) / Sq, d = rd / Sq;
            float dl = length(d);
            float tt = sphereHit(o, d / dl, vec3(0.0), R) / dl;
            if (tt < tb) { tb = tt; nb = normalize((o + d * tt) / Sq); ib = float(i); }
        }
    }

    vec3 col;
    if (tb < t && tb < tl) {
        vec3 h = normalize(Ln - rd);
        col = ballColour(ib) * (0.2 + 0.9 * max(dot(nb, Ln), 0.0)) + vec3(1.0) * pow(max(dot(nb, h), 0.0), 30.0) * 0.8;
    } else {
        float ledge = tl < t ? 1.0 : 0.0;
        vec3 p = ro + rd * min(t, tl);
        vec3 nn = ledge > 0.5 ? nl : n;
        if (ledge < 0.5 && maskOut(p, n) > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        vec3 wall = (vec3(0.05, 0.06, 0.09) + vec3(0.1, 0.13, 0.22) * gridLine(faceUV(p, n), 0.1, 0.004)) * (1.0 - 0.7 * ledgeUnderShadow(p, n));
        col = ledge > 0.5 ? shadeLedge(nn, vec3(0.7, 0.62, 0.52)) : wall;
        // the portals in the ceiling
        if (ledge < 0.5 && n.x > 0.5) {
            float dp = min(length(vec2(p.y - 0.70 * u_mask, p.z - R) * vec2(0.6, 1.0)), length(vec2(p.y - R, p.z - 0.49 * u_mask) * vec2(1.0, 0.6)));
            col = mix(col, vec3(0.0), 1.0 - smoothstep(0.045, 0.05, dp));
            col += vec3(0.3, 0.5, 0.9) * exp(-pow((dp - 0.05) / 0.005, 2.0)) * 0.8;
        }
        float sh = 1.0;
        for (int i = 0; i < 4; i++) {
            vec4 b = ballAt(i);
            if (b.x > -R) sh *= sphereShadow(p, Ln, b.xyz, R);
        }
        col *= sh * (0.6 + 0.5 * max(dot(nn, Ln), 0.0));
        col += vec3(0.25, 0.28, 0.38) * edgeLines(p, nn, 0.005) * (1.0 - ledge) * 0.6;
    }
    gl_FragColor = vec4(col, 1.0);
}
