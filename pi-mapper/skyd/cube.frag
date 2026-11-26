// Anamorphic cube breakout: ray-traced from the viewer's eye (the webcam). A
// square hatch opens in one surface, a solid cube pushes out of it, floats
// and turns, then goes back in. One act per surface (see cube.vert).
//
// Made to survive a viewer who is not exactly at the sweet spot: the cube is
// small, stays over one surface at a time, well clear of the seams and the
// shape's edges, and never touches a seam. Most of the depth comes from cues
// painted where they really are (view-independent): the hatch outline, the
// cube's soft shadow and its contact darkening on that surface.
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
varying vec4 v_hole;

// ray vs oriented box (rows r0..r2 map world -> local); t or -1
float box(vec3 ro, vec3 rd, float h, out vec3 nl, out vec3 q) {
    vec3 rel = ro - v_box.xyz;
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

float gridAt(vec3 p, vec3 nw, float sp, float w) {
    vec3 g = abs(fract(p / sp + 0.5) - 0.5) * sp;
    float gm = min(min(nw.x > 0.5 ? 1.0 : g.x, nw.y > 0.5 ? 1.0 : g.y), nw.z > 0.5 ? 1.0 : g.z);
    return 1.0 - smoothstep(w * 0.5, w, gm);
}

void main() {
    vec3 ro = u_campos;
    vec3 rd = normalize(v_rd);
    vec3 L = v_light;
    float h = v_box.w;

    float tw = 1e9; vec3 nw = vec3(0.0);
    if (rd.x < 0.0) { float t = -ro.x / rd.x; vec3 p = ro + rd * t; if (p.y >= 0.0 && p.z >= 0.0 && t < tw) { tw = t; nw = vec3(1, 0, 0); } }
    if (rd.y < 0.0) { float t = -ro.y / rd.y; vec3 p = ro + rd * t; if (p.x >= 0.0 && p.z >= 0.0 && t < tw) { tw = t; nw = vec3(0, 1, 0); } }
    if (rd.z < 0.0) { float t = -ro.z / rd.z; vec3 p = ro + rd * t; if (p.x >= 0.0 && p.y >= 0.0 && t < tw) { tw = t; nw = vec3(0, 0, 1); } }
    if (tw > 1e8) { gl_FragColor = vec4(0.0); return; }
    vec3 p = ro + rd * tw;
    // room-aligned mask: everything outside the shape stays black, cube or not
    float along = max(nw.y > 0.5 ? 0.0 : p.y, nw.z > 0.5 ? 0.0 : p.z);
    float down = nw.x > 0.5 ? 0.0 : p.x;
    float out_ = max(along - u_mask, down - u_maskd);
    if (out_ > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

    // the hatch: which surface it is on, and whether this pixel looks into it
    vec3 hc = v_hole.xyz;
    float hs = v_hole.w;
    vec3 fn = vec3(step(hc.x, 1e-4), step(hc.y, 1e-4), step(hc.z, 1e-4));
    vec3 dh = abs(p - hc) * (1.0 - fn);
    float dbox = max(max(dh.x, dh.y), dh.z);              // square distance from the hatch centre
    bool onFace = dot(nw, fn) > 0.5;
    bool inHole = onFace && dbox < hs;

    vec3 col;
    float tlim = tw;
    if (inHole) {
        // look into the recess behind the hatch: an open box 3h deep
        vec3 lo = hc - hs * (1.0 - fn) - fn * (3.0 * h + 0.02), hi = hc + hs * (1.0 - fn);
        vec3 inv = 1.0 / rd;
        vec3 t1 = (lo - ro) * inv, t2 = (hi - ro) * inv;
        vec3 tf = max(t1, t2);
        float tF = min(min(tf.x, tf.y), tf.z);
        vec3 ne = vec3(tF == tf.x ? 1.0 : 0.0, tF == tf.y ? 1.0 : 0.0, tF == tf.z ? 1.0 : 0.0);
        vec3 q = ro + rd * tF;
        float depth = -dot(q - hc, fn);                    // how far behind the surface
        float side = dot(ne, fn) > 0.5 ? 0.35 : 0.6 + 0.4 * dot(ne * sign(rd), -L);
        col = vec3(0.08, 0.06, 0.05) * side * exp(-depth * 14.0) + vec3(0.25, 0.15, 0.06) * exp(-depth * 40.0) * 0.4;
        tlim = tF;
    }

    vec3 nl, q;
    float tb = h > 0.002 ? box(ro, rd, h, nl, q) : -1.0;
    if (tb > 0.0 && tb < tlim) {
        vec3 nb = nl.x * v_r0 + nl.y * v_r1 + nl.z * v_r2;
        float diff = max(dot(nb, L), 0.0);
        col = vec3(0.85, 0.55, 0.25) * (0.14 + 0.85 * diff);
        // face grid and bright edges
        vec3 qa = abs(q);
        float e = h - 0.006;
        float edges = (qa.x > e ? 1.0 : 0.0) + (qa.y > e ? 1.0 : 0.0) + (qa.z > e ? 1.0 : 0.0);
        if (edges >= 2.0) col = mix(col, vec3(1.0, 0.85, 0.6), 0.8);
        // inside the recess it is dark
        float behind = -dot(ro + rd * tb - hc, fn);
        col *= 1.0 - 0.8 * smoothstep(0.0, 0.03, behind);
    } else if (!inHole) {
        float gl = gridAt(p, nw, 0.1, 0.004);
        float diff = max(dot(nw, normalize(vec3(-1.0, 0.6, 0.6))), 0.0);
        col = vec3(0.10, 0.12, 0.16) * (0.4 + 0.6 * diff) + vec3(0.10, 0.14, 0.22) * gl;
        col += vec3(0.25, 0.3, 0.4) * (1.0 - smoothstep(0.004, 0.01, -out_));
        if (h > 0.002) {
            // soft shadow: the box seen from this point toward three nearby light directions
            vec3 a1 = normalize(cross(L, vec3(0.3, 0.5, 0.7))), a2 = cross(L, a1);
            vec3 ns, qs;
            float sh = 0.0;
            vec3 po = p + nw * 0.002;
            if (box(po, L, h, ns, qs) > 0.0) sh += 0.34;
            if (box(po, normalize(L + a1 * 0.07), h, ns, qs) > 0.0) sh += 0.33;
            if (box(po, normalize(L - a1 * 0.035 + a2 * 0.06), h, ns, qs) > 0.0) sh += 0.33;
            // contact darkening: the cube's mass close to this surface
            float dn = dot(v_box.xyz - p, nw);
            float dl = length((v_box.xyz - p) - nw * dn);
            float ao = onFace ? (1.0 - smoothstep(h * 0.8, h * 2.6, dl)) * (1.0 - smoothstep(h, h * 3.5, dn)) : 0.0;
            col *= (1.0 - 0.7 * sh) * (1.0 - 0.6 * ao);
        }
        // the hatch outline: a thin bright seam, glowing while it is open
        if (onFace && hs > 0.001) {
            float rim = 1.0 - smoothstep(0.0015, 0.006, dbox - hs);
            col += vec3(1.0, 0.7, 0.35) * rim * 0.9;
        }
    }
    gl_FragColor = vec4(col, 1.0);
}
