// @common  String art (2.20): taut threads between anchors on the walls and
// ceiling form ruled 3D surfaces that twist slowly and change colour on beats.
// The anchors on the surfaces are correct from anywhere; the threads are
// drawn from the viewer's eye.

const int N = 14;

// family A: left wall vertical line  ->  right wall vertical line (hyperbolic sheet)
// family B: ceiling line along the right seam  ->  left wall line under the ceiling
void anchors(int fam, float i, float T, out vec3 a, out vec3 b) {
    float k = i / float(N - 1);
    float tw = 0.5 + 0.5 * sin(T * 0.21);                       // twist amount
    if (fam == 0) {
        float yA = u_mask * (0.62 + 0.12 * sin(T * 0.17));
        float zB = u_mask * (0.62 + 0.12 * cos(T * 0.19));
        a = vec3(u_maskd * (0.05 + 0.9 * k), yA, 0.0);
        b = vec3(u_maskd * (0.05 + 0.9 * mix(k, 1.0 - k, tw)), 0.0, zB);
    } else {
        float zc = u_mask * 0.78, xl = u_maskd * (0.25 + 0.1 * sin(T * 0.23));
        a = vec3(0.0, u_mask * (0.06 + 0.84 * k), zc);
        b = vec3(xl, u_mask * (0.06 + 0.84 * fract(k + 0.5 * (1.0 - tw))), 0.0);
    }
}

// distance from the ray to the segment ab, and the ray parameter there
float segDist(vec3 ro, vec3 rd, vec3 a, vec3 b, out float tr) {
    vec3 ab = b - a, ao = ro - a;
    float d1 = dot(rd, ab), d2 = dot(ab, ab), d3 = dot(rd, ao), d4 = dot(ab, ao);
    float den = d2 - d1 * d1;
    float s = clamp((d4 - d1 * d3) / max(den, 1e-6), 0.0, 1.0);   // along the segment
    vec3 q = a + ab * s;
    tr = dot(q - ro, rd);
    return length(ro + rd * tr - q);
}

void main() {
    vec3 ro = u_campos, rd = viewRay(), n;
    float t = roomHit(ro, rd, n);
    if (t > 1e8) { gl_FragColor = vec4(0.0); return; }
    vec3 p = ro + rd * t;
    if (maskOut(p, n) > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

    float T = u_time;
    float beatN = floor(T * 0.5);                               // colour step every other beat
    vec3 colA = hue(0.55 + beatN * 0.137), colB = hue(0.05 + beatN * 0.137);
    vec3 col = vec3(0.015, 0.017, 0.025);
    float dotA = 0.0;
    for (int f = 0; f < 2; f++) {
        float acc = 0.0;
        for (int i = 0; i < N; i++) {
            vec3 a, b;
            anchors(f, float(i), T, a, b);
            float tr;
            float d = segDist(ro, rd, a, b, tr);
            float w = 0.0011 * tr;                              // about two pixels wide
            acc += (1.0 - smoothstep(w * 0.4, w, d)) * step(tr, t + 0.002);
            dotA = max(dotA, 1.0 - smoothstep(0.004, 0.007, min(length(p - a), length(p - b))));
        }
        col += (f == 0 ? colA : colB) * min(acc, 1.5) * 0.9;
    }
    col += vec3(1.0, 0.95, 0.85) * dotA;
    col += vec3(0.15, 0.17, 0.22) * edgeLines(p, n, 0.005) * 0.5;
    gl_FragColor = vec4(col, 1.0);
}
