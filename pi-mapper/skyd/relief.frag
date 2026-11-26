// @common  Relief panels (2.6): the surfaces become bevelled panels laid out so
// whole panels end exactly at the seams and at the shape's outer and bottom
// edges (5 along each seam, as many as fit down the walls). The panels press
// in and push out in patterns that run across all three surfaces and over
// the seams: a ripple out of the vertex, then a checkerboard on the beat,
// then panels popping out one by one. A coloured point light circles in
// front of the corner; panels catch it and cast shadows on their neighbours.

const float NA = 5.0;          // panels along each seam
const float AMP = 0.014;       // how far a panel moves in or out (m)

vec2 CELL;                     // panel size on this face (along, across)
float FID;                     // face id
float Tg;                      // loop time
vec3 W;                        // weights of the three patterns (ripple, checkerboard, pop)
float CHK;                     // checkerboard swing

// panel displacement: + out of the surface, - into it
float panel(vec2 id) {
    vec2 c = (id + 0.5) * CELL;                       // panel centre on the face; the 3D distance
    float r = length(c);                              // from the vertex is the same, so it runs over the seams
    float T = Tg;
    float ripple = sin(r * 16.0 - T * 3.2);
    float chk = (mod(id.x + id.y + FID, 2.0) * 2.0 - 1.0) * CHK;          // swaps every 2 beats
    float hp = hash(id + FID * 7.31);
    float pop = exp(-pow((fract(T * 0.45 + hp) - 0.5) * 7.0, 2.0)) * 1.4 - 0.25;
    return AMP * (W.x * ripple + W.y * chk + W.z * pop);
}

// metric distance to the panel's edge -> bevelled profile
float height(vec2 uv) {
    vec2 g = uv / CELL;
    vec2 id = floor(g);
    vec2 d = (0.5 - abs(fract(g) - 0.5)) * CELL;
    float prof = smoothstep(0.003, 0.014, min(d.x, d.y));
    return prof * panel(id);
}

void main() {
    vec3 ro = u_campos, rd = viewRay(), n;
    float t = roomHit(ro, rd, n);
    if (t > 1e8) { gl_FragColor = vec4(0.0); return; }
    vec3 p = ro + rd * t;
    float mo = maskOut(p, n);
    if (mo > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

    Tg = mod(u_time, 15.0);
    W = vec3(1.0 - smoothstep(4.0, 5.5, Tg) + smoothstep(13.5, 15.0, Tg),
             smoothstep(4.0, 5.5, Tg) * (1.0 - smoothstep(9.0, 10.5, Tg)),
             smoothstep(9.0, 10.5, Tg) * (1.0 - smoothstep(13.5, 15.0, Tg)));
    CHK = sin(Tg * PI);
    float ca = u_mask / NA;
    // walls: whole panels down to the bottom edge (u_maskd)
    float nd = max(floor(u_maskd / ca + 0.5), 1.0);
    CELL = n.x > 0.5 ? vec2(ca) : vec2(ca, u_maskd / nd);
    FID = n.x > 0.5 ? 0.0 : (n.z > 0.5 ? 1.0 : 2.0);

    vec3 tu, tv;
    faceAxes(n, tu, tv);
    vec2 uv0 = faceUV(p, n);
    // parallax toward the viewer for the raised parts (pressed-in parts sink away)
    float cosv = max(abs(dot(rd, n)), 0.25);
    float h0 = height(uv0);
    vec2 uv = faceUV(p - rd * (h0 / cosv), n);
    float h = height(uv);
    float e = 0.003;
    vec2 g = vec2(height(uv + vec2(e, 0.0)) - h, height(uv + vec2(0.0, e)) - h) / e;
    vec3 nn = normalize(n - tu * g.x - tv * g.y);

    // a point light circling in front of the corner, slowly changing colour
    float a = u_time * 0.7;
    vec3 Lp = vec3(0.12 + 0.08 * sin(a * 1.3), 0.2 + 0.18 * cos(a), 0.2 + 0.18 * sin(a)) * (u_mask / 0.6);
    vec3 ps = p + n * h;
    vec3 Lv = Lp - ps;
    float ld2 = dot(Lv, Lv);
    vec3 L = Lv * inversesqrt(ld2);
    vec3 lc = mix(vec3(1.0, 0.8, 0.55), hue(u_time * 0.04), 0.45);
    float diff = max(dot(nn, L), 0.0);
    float att = 0.1 / (0.1 + ld2 * 2.0);

    // shadows cast by neighbouring raised panels, marching along the light
    vec2 ldir = vec2(dot(L, tu), dot(L, tv));
    float lt = max(length(ldir), 0.05);
    ldir /= lt;
    float rise = dot(L, n) / lt;
    float sh = 1.0;
    for (int i = 1; i <= 4; i++) {
        float s = float(i) * 0.007;
        if (height(uv + ldir * s) > h + s * rise + 0.0006) sh = 0.3;
    }

    // panels out are warm stone, panels in are cool; grout stays dark
    vec2 cid = floor(uv / CELL);
    float hp = panel(cid) / AMP;                      // -1..1
    vec3 alb = mix(vec3(0.3, 0.45, 0.55), vec3(0.75, 0.6, 0.45), 0.5 + 0.5 * clamp(hp, -1.0, 1.0));
    vec2 dd = (0.5 - abs(fract(uv / CELL) - 0.5)) * CELL;
    float grout = 1.0 - smoothstep(0.0015, 0.004, min(dd.x, dd.y));
    vec3 col = alb * (0.1 + 1.5 * diff * sh * att * lc);
    col *= 1.0 - 0.6 * grout;
    // the grout glows on the beat during the checkerboard
    col += hue(0.55 + FID * 0.08) * grout * beat(u_time) * W.y * 0.5;
    col += vec3(0.25, 0.3, 0.4) * edgeLines(p, n, 0.005) * 0.5;
    gl_FragColor = vec4(col, 1.0);
}
