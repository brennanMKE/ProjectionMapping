// @common  Portal juggle (2.24): a portal on each face. Balls shoot out of one,
// arc through the space in front of the corner and drop into the next, then
// come out of the linked portal. Arcs solved in skyd (sims.c), so no misses.

uniform vec4 u_obj[4];      // ball centre, w > 0 when in play
uniform vec4 u_portal[3];   // left wall, ceiling, right wall
uniform vec3 u_flash;       // contact cue per portal

const float BR = 0.026;     // ball radius
const float PR = 0.045;     // portal radius

void main() {
    vec3 ro = u_campos, rd = viewRay(), n;
    float t = roomHit(ro, rd, n);
    if (t > 1e8) { gl_FragColor = vec4(0.0); return; }
    vec3 p = ro + rd * t;
    if (maskOut(p, n) > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    vec3 L = normalize(vec3(-0.6, 0.55, 0.5));

    // which portal (if any) this wall point is inside
    float inP = 0.0, rim = 0.0;
    for (int i = 0; i < 3; i++) {
        float d = length(p - u_portal[i].xyz);
        float fl = i == 0 ? u_flash.x : i == 1 ? u_flash.y : u_flash.z;
        inP = max(inP, 1.0 - smoothstep(PR - 0.003, PR, d));
        rim += exp(-pow((d - PR) / 0.004, 2.0)) * (0.6 + 1.4 * fl);
        rim += exp(-pow((d - PR - fl * 0.03) / 0.003, 2.0)) * fl;   // ring pulse
    }
    float tb = 1e9, ib = 0.0; vec3 nb = vec3(0.0);
    for (int i = 0; i < 4; i++) {
        float tt = u_obj[i].w < 0.0 ? 1e9 : sphereHit(ro, rd, u_obj[i].xyz, BR);
        if (tt < tb) { tb = tt; ib = float(i); nb = normalize(ro + rd * tt - u_obj[i].xyz); }
    }
    vec3 col;
    // a ball in front of the wall, or seen through a portal's hole
    if (tb < t || (tb < 1e8 && inP > 0.5)) {
        vec3 base = hue(0.1 + ib * 0.25) * 0.85 + 0.15;
        col = base * (0.2 + 0.85 * max(dot(nb, L), 0.0)) + vec3(0.7) * pow(max(dot(nb, normalize(L - rd)), 0.0), 30.0);
        if (tb > t) col *= 0.45;   // still inside the portal
    } else {
        if (maskOut(p, n) > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        col = vec3(0.035, 0.04, 0.06) + vec3(0.06, 0.08, 0.14) * gridLine(faceUV(p, n), 0.1, 0.004);
        float sh = 1.0;
        for (int i = 0; i < 4; i++) if (u_obj[i].w > 0.0) sh *= sphereShadow(p, L, u_obj[i].xyz, BR);
        col *= sh;
        col = mix(col, vec3(0.0, 0.0, 0.01), inP);
        col += vec3(0.22, 0.25, 0.33) * edgeLines(p, n, 0.005) * 0.6;
    }
    col += vec3(0.4, 0.7, 1.0) * rim * 0.8;
    gl_FragColor = vec4(col, 1.0);
}
