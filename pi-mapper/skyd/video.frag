// @common  Video in the corner: the picture plays on a thin floating screen in
// the middle of the corner, facing the viewer and drawn from the viewer's eye,
// so it hangs in the space in front of the vertex. It bobs and sways gently,
// casts a soft shadow on the walls and spills its colours onto them.
// Frames come from skyd's decoder as Y, U, V textures.

uniform sampler2D u_vy, u_vu, u_vv;
uniform float u_vidt;     // seconds since the video started (-1: none)
uniform float u_vidok;    // 1 once the first frame has arrived
uniform float u_vidend;   // 1 when the video has finished

vec3 yuv(vec2 uv) {
    float y = (texture2D(u_vy, uv).r - 0.0627) * 1.164;
    float u = texture2D(u_vu, uv).r - 0.5, v = texture2D(u_vv, uv).r - 0.5;
    return clamp(vec3(y + 1.596 * v, y - 0.392 * u - 0.813 * v, y + 2.017 * u), 0.0, 1.0);
}

void main() {
    vec3 ro = u_campos, rd = viewRay(), n;
    float t = roomHit(ro, rd, n);
    if (t > 1e8) { gl_FragColor = vec4(0.0); return; }
    vec3 p = ro + rd * t;
    float mo = maskOut(p, n);
    if (mo > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

    float T = u_time;
    // the screen grows out of the vertex, then floats; shrinks back when the video ends
    float grow = smoothstep(0.2, 2.2, T) * (1.0 - u_vidend * 0.0);
    vec3 A = normalize(u_campos);
    float D = 0.5 * grow;
    vec3 C = A * D;
    vec3 N = A;
    vec3 up = normalize(vec3(-1.0, 0.0, 0.0) - N * (-N.x));
    vec3 right = normalize(cross(N, up));
    // float: bob and a slow sway
    C += up * 0.012 * sin(T * 0.9) + right * 0.006 * sin(T * 0.55);
    N = normalize(N + right * 0.10 * sin(T * 0.41) + up * 0.06 * sin(T * 0.53 + 1.0));
    up = normalize(up - N * dot(up, N));
    right = normalize(cross(N, up));
    float W = 0.86 * u_mask * grow, H = W * 9.0 / 16.0, TH = 0.007;

    // ray vs the screen (a thin box in its own frame)
    vec3 o = ro - C;
    vec3 lo_ = vec3(dot(o, right), dot(o, up), dot(o, N));
    vec3 ld = vec3(dot(rd, right), dot(rd, up), dot(rd, N));
    vec3 nl;
    float ts = W > 0.01 ? boxHit(lo_, ld, vec3(-W * 0.5, -H * 0.5, -TH), vec3(W * 0.5, H * 0.5, TH), nl) : 1e9;


    vec3 col;
    if (ts < 1e8) {
        vec3 q = lo_ + ld * ts;
        if (nl.z > 0.5) {
            vec2 uv = vec2(q.x / W + 0.5, 0.5 - q.y / H);
            float bez = 0.012 / W;
            vec2 e = min(uv, 1.0 - uv);
            float inPic = step(bez, min(e.x, e.y * W / H));
            vec3 pic = yuv(clamp((uv - bez) / (1.0 - 2.0 * bez), 0.0, 1.0));
            if (u_vidok < 0.5) pic = vec3(0.05, 0.06, 0.09) * (0.6 + 0.4 * sin(T * 3.0 + uv.x * 6.0));
            // glass: a faint sheen that moves with the sway
            float sheen = 0.06 * smoothstep(0.3, 0.0, abs(uv.x + uv.y - 0.9 - 0.25 * sin(T * 0.41)));
            col = mix(vec3(0.06, 0.065, 0.075), pic, inPic) + sheen;
        } else {
            // the screen's edges: brushed metal lit from above
            vec3 wn = nl.x * right + nl.y * up + nl.z * N;
            col = vec3(0.5, 0.52, 0.56) * (0.25 + 0.6 * max(dot(wn, normalize(vec3(-0.8, 0.4, 0.45))), 0.0));
        }
    } else {
        col = vec3(0.025, 0.03, 0.045) + vec3(0.03, 0.04, 0.07) * gridLine(faceUV(p, n), 0.1, 0.004);
        // spill: the screen lights the walls around it
        vec3 dc = C - p;
        float near = exp(-length(dc) / 0.22) * max(dot(n, normalize(dc)), 0.0);
        // the picture's colour toward this side of the screen (two luma/chroma taps)
        vec2 side = vec2(clamp(dot(p - C, right) / W + 0.5, 0.2, 0.8), clamp(0.5 - dot(p - C, up) / H, 0.25, 0.75));
        vec3 avg = (yuv(side) + yuv(vec2(0.5))) * 0.5 * u_vidok;
        col += avg * near * 0.55 * grow;
        // soft shadow from a light above and in front
        vec3 L = normalize(vec3(-0.8, 0.4, 0.45));
        vec3 so = p + n * 0.002 - C;
        vec3 sl = vec3(dot(so, right), dot(so, up), dot(so, N)), sd = vec3(dot(L, right), dot(L, up), dot(L, N));
        vec3 sn;
        float sh = boxHit(sl, sd, vec3(-W * 0.5, -H * 0.5, -TH), vec3(W * 0.5, H * 0.5, TH), sn);
        if (sh < 1e8 && W > 0.01) col *= 0.45;
        col += vec3(0.25, 0.3, 0.4) * edgeLines(p, n, 0.005) * 0.5;
    }
    gl_FragColor = vec4(col, 1.0);
}
