// Anamorphic cube: ray-traced from the viewer's eye (the webcam), so from
// that spot the corner disappears and a solid cube grows out of it, floats
// forward and turns, lit by one light and casting a shadow on the walls.
// Animation state comes from cube.vert.
//
// Room coordinates (meters from the corner): x down the vertical seam,
// y along the left wall/ceiling seam, z along the right one. The ceiling is
// x=0, the left wall z=0, the right wall y=0; the room is x,y,z >= 0.
precision highp float;

uniform vec3 u_campos;       // viewer position, room coords (camsolve.py)
uniform float u_mask;        // shown out to this distance along each seam (m)
uniform float u_maskd;       // and this far down the walls (m)
varying vec3 v_rd;
varying vec4 v_box;
varying vec3 v_r0, v_r1, v_r2;
varying vec3 v_light;

// ray vs oriented box (rows r0..r2 map world -> local); t or -1
float box(vec3 ro, vec3 rd, out vec3 nl, out vec3 q) {
    vec3 c = v_box.xyz; float h = v_box.w;
    vec3 rel = ro - c;
    vec3 o = vec3(dot(v_r0, rel), dot(v_r1, rel), dot(v_r2, rel));
    vec3 d = vec3(dot(v_r0, rd), dot(v_r1, rd), dot(v_r2, rd));
    vec3 inv = 1.0 / d;
    vec3 t1 = (-vec3(h) - o) * inv, t2 = (vec3(h) - o) * inv;
    vec3 tn = min(t1, t2), tf = max(t1, t2);
    float tN = max(max(tn.x, tn.y), tn.z), tF = min(min(tf.x, tf.y), tf.z);
    if (tN > tF || tF < 0.0) return -1.0;
    q = o + d * tN;
    nl = step(vec3(h) - 1e-4, abs(q)) * sign(q);
    return tN;
}

void main() {
    vec3 ro = u_campos;
    vec3 rd = normalize(v_rd);
    vec3 L = normalize(v_light);
    float h = v_box.w;

    float tw = 1e9; vec3 nw = vec3(0.0);
    if (rd.x < 0.0) { float t = -ro.x / rd.x; vec3 p = ro + rd * t; if (p.y >= 0.0 && p.z >= 0.0 && t < tw) { tw = t; nw = vec3(1, 0, 0); } }
    if (rd.y < 0.0) { float t = -ro.y / rd.y; vec3 p = ro + rd * t; if (p.x >= 0.0 && p.z >= 0.0 && t < tw) { tw = t; nw = vec3(0, 1, 0); } }
    if (rd.z < 0.0) { float t = -ro.z / rd.z; vec3 p = ro + rd * t; if (p.x >= 0.0 && p.y >= 0.0 && t < tw) { tw = t; nw = vec3(0, 0, 1); } }

    vec3 col = vec3(0.0);
    vec3 nl, q;
    float tb = h > 0.002 ? box(ro, rd, nl, q) : -1.0;
    if (tb > 0.0 && tb < tw) {
        // local normal back to world: R * nl = nl.x*col0 + ... ; rows of R^T are R's columns
        vec3 nb = nl.x * v_r0 + nl.y * v_r1 + nl.z * v_r2;
        float diff = max(dot(nb, L), 0.0);
        col = vec3(0.85, 0.55, 0.25) * (0.12 + 0.85 * diff);
        vec3 a = abs(q);
        float e = h - 0.012;
        float edges = (a.x > e ? 1.0 : 0.0) + (a.y > e ? 1.0 : 0.0) + (a.z > e ? 1.0 : 0.0);
        if (edges >= 2.0) col = mix(col, vec3(1.0, 0.85, 0.6), 0.8);
    } else if (tw < 1e8) {
        vec3 p = ro + rd * tw;
        // room-aligned mask: a square on each surface, edges parallel to the seams
        // distance outside the shape (<0 inside): along the seams vs u_mask, down vs u_maskd
        float along = max(nw.y > 0.5 ? 0.0 : p.y, nw.z > 0.5 ? 0.0 : p.z);
        float down = nw.x > 0.5 ? 0.0 : p.x;
        float out_ = max(along - u_mask, down - u_maskd);
        if (out_ > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        vec3 g = abs(fract(p * 10.0 + 0.5) - 0.5);
        float gm = min(min(nw.x > 0.5 ? 1.0 : g.x, nw.y > 0.5 ? 1.0 : g.y), nw.z > 0.5 ? 1.0 : g.z);
        float gl = 1.0 - smoothstep(0.0, 0.04, gm);
        float diff = max(dot(nw, L), 0.0);
        col = vec3(0.10, 0.12, 0.16) * (0.4 + 0.6 * diff) + vec3(0.10, 0.14, 0.22) * gl;
        // a fine line along the outer edge of the shape
        col += vec3(0.25, 0.3, 0.4) * (1.0 - smoothstep(0.004, 0.01, -out_));
        vec3 ns, qs;
        if (h > 0.002 && box(p + nw * 0.002, L, ns, qs) > 0.0) col *= 0.25;
    }
    gl_FragColor = vec4(col, 1.0);
}
