// Shared building blocks for room scenes (prepended by skyd to any scene
// whose source contains "@common").
//
// Room coordinates (meters from the corner): x down the vertical seam,
// y along the left wall/ceiling seam, z along the right one. Ceiling x=0
// (normal +x), left wall z=0 (normal +z), right wall y=0 (normal +y).
precision highp float;

varying vec2 v_cam;          // viewer (webcam) pixel
uniform float u_time;        // seconds since the scene started
uniform vec3 u_campos;       // viewer position (camsolve.py)
uniform mat3 u_minv;         // viewer pixel -> ray direction
uniform float u_mask;        // shape: this far along each seam...
uniform float u_maskd;       // ...and this far down the walls

const float PI = 3.14159265;

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

vec3 viewRay() { return normalize(u_minv * vec3(v_cam, 1.0)); }

// nearest real surface in front of the viewer; returns t (1e9 if none)
float roomHit(vec3 ro, vec3 rd, out vec3 n) {
    float tw = 1e9; n = vec3(0.0);
    if (rd.x < 0.0) { float t = -ro.x / rd.x; vec3 p = ro + rd * t; if (p.y >= 0.0 && p.z >= 0.0 && t < tw) { tw = t; n = vec3(1, 0, 0); } }
    if (rd.y < 0.0) { float t = -ro.y / rd.y; vec3 p = ro + rd * t; if (p.x >= 0.0 && p.z >= 0.0 && t < tw) { tw = t; n = vec3(0, 1, 0); } }
    if (rd.z < 0.0) { float t = -ro.z / rd.z; vec3 p = ro + rd * t; if (p.x >= 0.0 && p.y >= 0.0 && t < tw) { tw = t; n = vec3(0, 0, 1); } }
    return tw;
}

// 2D coordinates on a face, both 0 at the vertex:
// ceiling (y, z); left wall (y, x); right wall (z, x)
vec2 faceUV(vec3 p, vec3 n) {
    if (n.x > 0.5) return vec2(p.y, p.z);
    if (n.z > 0.5) return vec2(p.y, p.x);
    return vec2(p.z, p.x);
}

// face extents of the masked shape (along the seam, and down / across)
vec2 faceSize(vec3 n) { return n.x > 0.5 ? vec2(u_mask) : vec2(u_mask, u_maskd); }

// > 0 outside the room-aligned mask shape, distance in meters
float maskOut(vec3 p, vec3 n) {
    vec2 uv = faceUV(p, n), s = faceSize(n);
    return max(uv.x - s.x, uv.y - s.y);
}

float gridLine(vec2 uv, float spacing, float w) {
    vec2 g = abs(fract(uv / spacing + 0.5) - 0.5) * spacing;
    return 1.0 - smoothstep(w * 0.5, w, min(g.x, g.y));
}

// fine line along the shape's outer edge and the real seams
float edgeLines(vec3 p, vec3 n, float w) {
    vec2 uv = faceUV(p, n);
    float o = -maskOut(p, n);
    return max(1.0 - smoothstep(w * 0.5, w, o), 1.0 - smoothstep(w * 0.5, w, min(uv.x, uv.y)));
}

// tangent axes for a face (match faceUV)
void faceAxes(vec3 n, out vec3 tu, out vec3 tv) {
    if (n.x > 0.5) { tu = vec3(0, 1, 0); tv = vec3(0, 0, 1); }
    else if (n.z > 0.5) { tu = vec3(0, 1, 0); tv = vec3(1, 0, 0); }
    else { tu = vec3(0, 0, 1); tv = vec3(1, 0, 0); }
}

// fixed 120 BPM clock for beat-driven parts
float beat(float t) { return exp(-fract(t * 2.0) * 6.0); }

// ---------------------------------------------------------------- Part 2 blocks

// ray vs sphere: t or 1e9
float sphereHit(vec3 ro, vec3 rd, vec3 c, float r) {
    vec3 oc = ro - c;
    float b = dot(oc, rd), h = b * b - dot(oc, oc) + r * r;
    if (h < 0.0) return 1e9;
    float t = -b - sqrt(h);
    return t > 0.0 ? t : 1e9;
}

// ray vs axis-aligned box: t or 1e9, with the face normal
float boxHit(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax, out vec3 n) {
    vec3 inv = 1.0 / rd;
    vec3 t1 = (bmin - ro) * inv, t2 = (bmax - ro) * inv;
    vec3 tn = min(t1, t2), tf = max(t1, t2);
    float tN = max(max(tn.x, tn.y), tn.z), tF = min(min(tf.x, tf.y), tf.z);
    n = vec3(0.0);
    if (tN > tF || tN < 0.0) return 1e9;
    if (tN == tn.x) n = vec3(-sign(rd.x), 0.0, 0.0);
    else if (tN == tn.y) n = vec3(0.0, -sign(rd.y), 0.0);
    else n = vec3(0.0, 0.0, -sign(rd.z));
    return tN;
}

// 1.6 Virtual ledges: thin shelves on the walls, scaled to the masked shape.
// Room x is down, so a ledge's top face has normal -x.
const float LEDGE_T = 0.012;   // thickness
const float LEDGE_D = 0.045;   // how far it sticks out of the wall
void ledgeBox(int i, out vec3 lo, out vec3 hi) {
    if (i == 0) {        // left wall, high, away from the corner
        float x = 0.50 * u_maskd;
        lo = vec3(x, 0.30 * u_mask, 0.0); hi = vec3(x + LEDGE_T, 0.85 * u_mask, LEDGE_D);
    } else if (i == 1) { // right wall, middle
        float x = 0.62 * u_maskd;
        lo = vec3(x, 0.0, 0.08 * u_mask); hi = vec3(x + LEDGE_T, LEDGE_D, 0.62 * u_mask);
    } else {             // left wall, low, near the corner
        float x = 0.86 * u_maskd;
        lo = vec3(x, 0.04 * u_mask, 0.0); hi = vec3(x + LEDGE_T, 0.50 * u_mask, LEDGE_D);
    }
}
// nearest ledge along a ray: t or 1e9, normal and which ledge
float ledgeHit(vec3 ro, vec3 rd, out vec3 n, out float id) {
    float best = 1e9; n = vec3(0.0); id = -1.0;
    for (int i = 0; i < 3; i++) {
        vec3 lo, hi, nn;
        ledgeBox(i, lo, hi);
        float t = boxHit(ro, rd, lo, hi, nn);
        if (t < best) { best = t; n = nn; id = float(i); }
    }
    return best;
}
// soft dark band on the wall just under each ledge
float ledgeUnderShadow(vec3 p, vec3 n) {
    float s = 0.0;
    for (int i = 0; i < 3; i++) {
        vec3 lo, hi;
        ledgeBox(i, lo, hi);
        bool onWall = (hi.z < 0.1 && n.z > 0.5) || (hi.y < 0.1 && n.y > 0.5);
        if (!onWall) continue;
        float along = hi.z < 0.1 ? p.y : p.z;
        float a0 = hi.z < 0.1 ? lo.y : lo.z, a1 = hi.z < 0.1 ? hi.y : hi.z;
        float d = p.x - hi.x;
        float inSpan = smoothstep(a0 - 0.01, a0 + 0.01, along) * (1.0 - smoothstep(a1 - 0.01, a1 + 0.01, along));
        if (d > 0.0) s = max(s, inSpan * exp(-d / 0.03));
    }
    return s;
}
// ledge colour: top highlight, darker front and underside
vec3 shadeLedge(vec3 n, vec3 base) {
    if (n.x < -0.5) return base * 1.25 + 0.08;
    if (n.x > 0.5) return base * 0.25;
    return base * 0.6;
}

// 1.2-style contact shadow of a sphere on a surface point (L toward the light):
// tighter and darker as the sphere gets close
float sphereShadow(vec3 p, vec3 L, vec3 c, float r) {
    vec3 oc = c - p;
    float b = dot(oc, L);
    if (b <= 0.0) return 1.0;
    float d = length(oc - L * b);
    float soft = r * 0.15 + b * 0.45;
    float dark = mix(0.85, 0.3, smoothstep(0.0, 0.25, b));
    return 1.0 - dark * (1.0 - smoothstep(r - soft, r + soft, d));
}

vec3 hue(float h) { return clamp(abs(fract(h + vec3(0.0, 2.0, 1.0) / 3.0) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }

// shared dim backdrop for the room surfaces
vec3 roomBase(vec3 p, vec3 n) {
    return vec3(0.025, 0.03, 0.045) + vec3(0.04, 0.05, 0.08) * gridLine(faceUV(p, n), 0.1, 0.004);
}
