// @common  Corner crawlers (2.27): small geometric bugs walk across the walls and
// wrap round the seams onto the other wall and the ceiling, upside down. One
// drops from the ceiling on a thread, swings, and lands on a wall. Their paths
// come from skyd (sims.c); bodies and legs are drawn here, flat on the faces.

uniform vec4 u_obj[6];     // position on a face, w = leg phase (negative: hanging)
uniform vec4 u_head[6];    // heading, w = size
uniform vec4 u_thread;     // anchor, w > 0 while someone hangs from it

float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }

// a bug in its own frame (x forward), units of its size
float bug(vec2 q, float ph) {
    float d = length(q - vec2(1.25, 0.0)) - 0.42;                       // head
    d = min(d, length((q - vec2(0.35, 0.0)) * vec2(1.0, 1.25)) - 0.55);  // thorax
    d = min(d, length((q + vec2(0.85, 0.0)) * vec2(0.8, 1.15)) - 0.7);   // abdomen
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float sw = 0.45 * sin(ph + fi * 2.1);
        vec2 hip = vec2(0.6 - fi * 0.55, 0.0);
        d = min(d, seg(q, hip, vec2(hip.x + 0.4 + sw, 1.55)) - 0.09);
        d = min(d, seg(q, hip, vec2(hip.x + 0.4 - sw, -1.55)) - 0.09);
    }
    d = min(d, seg(q, vec2(1.5, 0.15), vec2(2.2, 0.6)) - 0.06);         // antennae
    d = min(d, seg(q, vec2(1.5, -0.15), vec2(2.2, -0.6)) - 0.06);
    return d;
}

vec3 faceN(vec3 p) { return p.x <= p.y && p.x <= p.z ? vec3(1, 0, 0) : (p.y <= p.z ? vec3(0, 1, 0) : vec3(0, 0, 1)); }

void main() {
    vec3 ro = u_campos, rd = viewRay(), n;
    float t = roomHit(ro, rd, n);
    if (t > 1e8) { gl_FragColor = vec4(0.0); return; }
    vec3 p = ro + rd * t;
    if (maskOut(p, n) > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

    vec3 col = vec3(0.03, 0.035, 0.05) + vec3(0.05, 0.065, 0.11) * gridLine(faceUV(p, n), 0.1, 0.004);
    float body = 1e9, shadow = 1e9, idx = 0.0;
    for (int i = 0; i < 6; i++) {
        vec4 o = u_obj[i];
        float size = 0.02 * u_head[i].w;
        vec3 dd = p - o.xyz;
        if (o.w >= 0.0 && dot(dd, dd) < size * size * 12.0) {   // only near this bug
            vec3 cn = faceN(o.xyz);
            vec3 h = u_head[i].xyz, sd = cross(cn, h);
            vec3 d = p - o.xyz;
            // unfold across a seam: distance up the other face counts as distance along the heading
            float off = dot(d, cn);
            float fx = dot(d, h);
            vec2 q = vec2(fx + abs(off) * sign(fx), dot(d, sd)) / size;
            float b = bug(q, o.w);
            if (b < body) { body = b; idx = float(i); }
            shadow = min(shadow, bug(q - vec2(-0.5, 0.6), o.w));
        }
    }
    // the hanging one: drawn facing the viewer, with its thread
    if (u_thread.w > 0.0) {
        vec4 o = u_obj[0];
        vec3 a = u_thread.xyz, b = o.xyz;
        vec3 ab = b - a, ao = ro - a;
        float d1 = dot(rd, ab), d2 = dot(ab, ab), d3 = dot(rd, ao), d4 = dot(ab, ao);
        float s = clamp((d4 - d1 * d3) / max(d2 - d1 * d1, 1e-6), 0.0, 1.0);
        vec3 qq = a + ab * s;
        float tr = dot(qq - ro, rd);
        float dl = length(ro + rd * tr - qq);
        col += vec3(0.8, 0.85, 0.9) * (1.0 - smoothstep(0.0006 * tr, 0.0012 * tr, dl)) * step(tr, t);
        // body: a small bug seen from below, in the plane facing the viewer
        float tb = dot(b - ro, rd);
        vec3 pc = ro + rd * tb - b;
        vec3 up = vec3(-1, 0, 0), right = normalize(cross(rd, up));
        float hb = bug(vec2(dot(pc, -up), dot(pc, right)) / (0.02 * u_head[0].w), -o.w);
        if (tb < t && hb < body) { body = hb; idx = 0.0; }
    }
    col *= 1.0 - 0.6 * (1.0 - smoothstep(0.0, 0.4, shadow));
    vec3 bc = hue(0.42 + idx * 0.09) * 0.75 + 0.25;
    col = mix(col, bc * 0.9, 1.0 - smoothstep(-0.05, 0.08, body));
    col = mix(col, bc * 0.35, (1.0 - smoothstep(0.08, 0.2, body)) * smoothstep(-0.05, 0.08, body));   // outline
    col += vec3(0.22, 0.25, 0.33) * edgeLines(p, n, 0.005) * 0.5;
    gl_FragColor = vec4(col, 1.0);
}
