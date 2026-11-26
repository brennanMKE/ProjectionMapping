// @common  Infinite corner (2.15): a smaller copy of the corner opens at the
// vertex, with another inside it, receding without end; then we fly in.
// The "recursive render" is done analytically: level k is the room turned
// by k steps about the vertex->viewer axis and shrunk by S^k, ray-traced
// directly, so it costs a few ray/plane tests per level and no texture.
// The outer edge of the shape stays as a dim frame; the web lines of the
// level that has grown past it keep moving forward, clipped at that edge, and
// the edge flashes as each new frame comes forward and reaches it.

const float S = 0.55;            // each level's size relative to its parent
const float TURN = 0.18;         // radians each level turns
const float PERIOD = 3.0;        // seconds for one level to replace its parent
const int LEVELS = 6;

mat3 rotAxis(vec3 a, float ang) {
    float s = sin(ang), c = cos(ang), oc = 1.0 - c;
    return mat3(oc*a.x*a.x + c,     oc*a.x*a.y + a.z*s, oc*a.z*a.x - a.y*s,
                oc*a.x*a.y - a.z*s, oc*a.y*a.y + c,     oc*a.y*a.z + a.x*s,
                oc*a.z*a.x + a.y*s, oc*a.y*a.z - a.x*s, oc*a.z*a.z + c);
}

void main() {
    vec3 ro = u_campos, rd = viewRay(), n;
    float t = roomHit(ro, rd, n);
    if (t > 1e8) { gl_FragColor = vec4(0.0); return; }
    vec3 p = ro + rd * t;
    if (maskOut(p, n) > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

    float T = u_time;
    float open = smoothstep(0.0, 3.0, T);               // the first portal opens, then the zoom runs
    float zt = max(T - 3.0, 0.0) / PERIOD;
    float f = fract(zt), cyc = floor(zt);
    vec3 axis = normalize(u_campos);

    vec3 col = roomBase(p, n);
    float frame = 0.0;
    // walk inward: level k is visible where its virtual hit is inside its (scaled) shape.
    // Level 0 is the one that has already grown past the outer edge: it always
    // fills the shape, so its web lines run on until the edge clips them.
    for (int k = 0; k <= LEVELS; k++) {
        float lv = float(k) - f * step(0.001, zt);
        float sc = pow(S, lv) * (k == 0 ? 1.0 : mix(0.25, 1.0, open));
        mat3 R = rotAxis(axis, -TURN * lv);
        vec3 vro = R * ro, vrd = R * rd, vn;
        float vt = roomHit(vro, vrd, vn);
        if (vt > 1e8) break;
        vec3 q = vro + vrd * vt;
        vec2 uv = faceUV(q, vn) / sc, sz = faceSize(vn);
        float out_ = max(uv.x - sz.x, uv.y - sz.y);
        if (out_ > 0.0 && k > 0) {
            frame = max(frame, (1.0 - smoothstep(0.0, 0.012, out_ * sc)) * (k == 1 ? open : 1.0));
            break;
        }
        // inside level k: its own tinted grid and seams
        float id = float(k) + cyc;
        vec3 tint = hue(0.6 + id * 0.11) * (vn.x > 0.5 ? 0.5 : vn.z > 0.5 ? 0.32 : 0.22);
        col = vec3(0.02) + tint * 0.25 + tint * gridLine(uv, 0.1, 0.006) * 1.2;
        col += vec3(0.9, 0.85, 0.75) * (1.0 - smoothstep(0.003, 0.01, min(uv.x, uv.y) * sc)) * 0.6;
        col *= mix(1.0, 0.85, float(k) / float(LEVELS));
        frame = k == 0 ? 0.0 : 1.0 - smoothstep(0.0, 0.012, -out_ * sc);
    }
    col += vec3(1.0, 0.92, 0.8) * frame * 0.8;
    // the outer edge: a dim frame that flashes as each new frame reaches it
    float flash = zt > 0.0 ? exp(-f * PERIOD * 2.2) + exp(-(1.0 - f) * PERIOD * 6.0) * 0.6 : 0.0;
    float outer = 1.0 - smoothstep(0.003, 0.011, -maskOut(p, n));
    col = mix(col, vec3(1.0, 0.92, 0.8) * (0.3 + 0.75 * flash), outer);
    col += vec3(0.2, 0.22, 0.3) * edgeLines(p, n, 0.005) * 0.6;
    gl_FragColor = vec4(col, 1.0);
}
