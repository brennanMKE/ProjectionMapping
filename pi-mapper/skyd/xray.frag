// @common  X-ray wall (2.16): a scan band sweeps across the walls and ceiling
// and shows what's inside them: studs at 16 in centres, ceiling joists,
// conduit that turns across the seams, a junction box. Blueprint palette by
// default; "set u_thermal 1" switches to a thermal look.

uniform float u_thermal;

const float STUD = 0.406;        // 16 in
const float CAV = 0.09;          // cavity depth behind the drywall
const float DRY = 0.013;         // drywall thickness

// what's at a point inside the cavity of face n (uv along/down, d depth behind
// the surface): 0 empty, 1 stud or joist, 2 conduit, 3 junction box
float cavity(vec3 n, vec2 uv, float d) {
    if (d < DRY || d > DRY + CAV) return d > DRY + CAV ? 4.0 : 0.0;
    float dd = d - DRY;
    if (n.x > 0.5) {
        // ceiling: joists run along y, spaced along z; deeper than studs
        float zz = abs(mod(uv.y + 0.12, STUD) - STUD * 0.5);
        if (zz > STUD * 0.5 - 0.019) return 1.0;
        // conduit continuing from the right wall riser, along y
        float c = length(vec2(uv.y - 0.25 * u_mask / 0.6 * 0.6, dd - 0.03));
        if (c < 0.011 && uv.x < u_mask) return 2.0;
        return 0.0;
    }
    // walls: studs are vertical (along x), spaced along the wall
    float a = uv.x;                 // along the wall from the corner
    if (a < 0.038) return 1.0;      // corner stud
    float s = abs(mod(a + 0.05, STUD) - STUD * 0.5);
    if (s > STUD * 0.5 - 0.019) return 1.0;
    // conduit: horizontal run at the same height on both walls (turns at the corner)
    float h = 0.22 * u_maskd / 0.4;
    float run = length(vec2(uv.y - h, dd - 0.03));
    bool rightRiser = n.y > 0.5 && a > 0.25 * u_mask / 0.6 * 0.6;
    if (run < 0.011 && !rightRiser) return 2.0;
    // riser on the right wall going up into the ceiling
    if (n.y > 0.5 && length(vec2(a - 0.25 * u_mask / 0.6 * 0.6, dd - 0.03)) < 0.011 && uv.y < h) return 2.0;
    // junction box on the left wall where the conduit starts
    if (n.z > 0.5 && abs(a - 0.62 * u_mask) < 0.05 && abs(uv.y - h) < 0.05 && dd < 0.06) return 3.0;
    return 0.0;
}

void main() {
    vec3 ro = u_campos, rd = viewRay(), n;
    float t = roomHit(ro, rd, n);
    if (t > 1e8) { gl_FragColor = vec4(0.0); return; }
    vec3 p = ro + rd * t;
    if (maskOut(p, n) > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

    // the band: a plane sweeping through the room, back and forth
    float T = u_time;
    vec3 bdir = normalize(vec3(0.35, 1.0, -0.8));
    float span = u_mask * 1.2;
    float pos = (0.5 - 0.5 * cos(T * 0.45)) * span * 1.6 - span * 0.6;
    float bd = dot(p, bdir) - pos;
    float W = 0.09 + 0.03 * sin(T * 0.7);
    float inBand = 1.0 - smoothstep(W - 0.006, W, abs(bd));
    float edge = exp(-pow((abs(bd) - W) / 0.003, 2.0));

    vec3 col = roomBase(p, n);
    if (inBand > 0.0) {
        // march into the wall from the surface point along the view ray
        float cosI = max(-dot(rd, n), 0.15);
        float hit = 0.0, hd = DRY + CAV;
        for (int i = 0; i < 10; i++) {
            float d = DRY + CAV * (float(i) + 0.5) / 10.0;
            vec3 q = p + rd * (d / cosI);
            float c = cavity(n, faceUV(q, n), d);
            if (c > 0.5) { hit = c; hd = d; break; }
        }
        float depth = (hd - DRY) / CAV;                    // 0 near, 1 back sheathing
        vec2 buv = faceUV(p + rd * (hd / cosI), n);
        vec3 xc;
        if (u_thermal > 0.5) {
            float heat = hit == 2.0 ? 1.0 : hit == 3.0 ? 0.85 : hit == 1.0 ? 0.15 : 0.45 + 0.15 * sin(buv.x * 9.0 + buv.y * 7.0);
            xc = mix(mix(vec3(0.05, 0.0, 0.25), vec3(0.9, 0.2, 0.3), smoothstep(0.0, 0.5, heat)), vec3(1.0, 0.9, 0.3), smoothstep(0.5, 1.0, heat)) * 0.75;
        } else {
            vec3 bg = vec3(0.02, 0.07, 0.2);
            xc = bg + vec3(0.1, 0.25, 0.5) * gridLine(buv, 0.05, 0.002) * 0.6;
            if (hit == 1.0) xc = mix(vec3(0.25, 0.5, 0.85), vec3(0.08, 0.2, 0.45), depth) + 0.1;
            if (hit == 2.0) xc = vec3(0.75, 0.95, 1.0) * (0.6 + 0.4 * (1.0 - depth));
            if (hit == 3.0) xc = vec3(0.5, 0.8, 1.0) * 0.8;
            // blueprint outline where the depth jumps (front faces of the studs)
            if (hit == 1.0 && depth < 0.12) xc += vec3(0.6, 0.85, 1.0) * 0.5;
        }
        col = mix(col, xc, inBand);
    }
    col += vec3(0.6, 0.9, 1.0) * edge * 0.8;
    col += vec3(0.2, 0.22, 0.3) * edgeLines(p, n, 0.005) * 0.6;
    gl_FragColor = vec4(col, 1.0);
}
