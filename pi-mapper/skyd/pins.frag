// @common  Pin screen (2.19): the surfaces become a dense field of pins that
// push out in waves: ripples from the vertex, travelling waves, then a hand
// pressing from behind. Heightfield rendered by a short march toward the
// viewer; pins are lit by one light with cheap occlusion at their bases.

const float HMAX = 0.035;

// one height function (same idea as the membrane push): metres out of the wall
float handSDF(vec2 q) {
    // a simple hand outline: palm plus four fingers and a thumb (capsules)
    float d = length((q - vec2(0.0, 0.0)) * vec2(1.0, 1.15)) - 0.055;
    for (int i = 0; i < 4; i++) {
        float fi = float(i);
        vec2 a = vec2(-0.039 + fi * 0.026, -0.04), b = a + vec2((fi - 1.5) * 0.008, -0.055 - 0.012 * (1.0 - abs(fi - 1.5) / 1.5));
        vec2 pa = q - a, ba = b - a;
        float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        d = min(d, length(pa - ba * h) - 0.011);
    }
    vec2 a = vec2(0.05, 0.0), b = vec2(0.085, -0.04), pa = q - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return min(d, length(pa - ba * h) - 0.012);
}
float height(vec3 c, vec3 n, float T) {
    float r = length(c);
    float ripple = 0.5 + 0.5 * sin(r * 45.0 - T * 4.0);
    ripple *= smoothstep(0.0, 1.0, T) * (1.0 - smoothstep(6.0, 7.5, T));
    float wave = 0.5 + 0.5 * sin(c.x * 30.0 + (c.y - c.z) * 18.0 - T * 3.0);
    wave *= smoothstep(6.0, 7.5, T) * (1.0 - smoothstep(12.0, 13.5, T));
    // the hand presses into the left wall
    float hand = 0.0;
    if (n.z > 0.5) {
        vec2 q = vec2(c.y - 0.55 * u_mask, c.x - 0.6 * u_maskd);
        hand = (1.0 - smoothstep(-0.004, 0.012, handSDF(q))) * smoothstep(12.5, 14.0, T) * (1.0 - smoothstep(17.5, 19.0, T));
    }
    return HMAX * max(max(ripple * 0.8, wave), hand * 1.1) * (1.0 - smoothstep(19.0, 20.0, T));
}

void main() {
    vec3 ro = u_campos, rd = viewRay(), n;
    float t = roomHit(ro, rd, n);
    if (t > 1e8) { gl_FragColor = vec4(0.0); return; }
    vec3 p = ro + rd * t;
    if (maskOut(p, n) > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

    float T = mod(u_time, 20.0);
    float cell = u_mask / 24.0;                     // 24 pins along each seam
    float cosI = max(-dot(rd, n), 0.2);
    vec3 tu, tv;
    faceAxes(n, tu, tv);
    vec3 L = normalize(vec3(-0.7, 0.55, 0.45));

    vec3 col = vec3(0.03, 0.032, 0.04);
    bool hit = false;
    // march from the top of the pin field down to the wall
    for (int i = 0; i < 8; i++) {
        float hgt = HMAX * (1.0 - (float(i) + 0.5) / 8.0);
        vec3 q = p - rd * (hgt / cosI);             // point at this height above the wall
        vec2 uv = faceUV(q, n);
        vec2 id = floor(uv / cell);
        vec2 f = uv / cell - id - 0.5;
        vec3 c = n * 0.0 + tu * (id.x + 0.5) * cell + tv * (id.y + 0.5) * cell;
        float h = height(c, n, T);
        float rr = length(f);
        if (rr < 0.38 && h >= hgt) {
            // top (first sample) or side of a pin
            bool top = h - hgt < HMAX / 8.0;
            vec3 nn = top ? n : normalize(tu * f.x + tv * f.y);
            float diff = max(dot(nn, L), 0.0);
            vec3 base = mix(vec3(0.55, 0.6, 0.7), vec3(0.85, 0.75, 0.6), h / HMAX);
            col = base * (0.12 + 0.8 * diff) * (top ? 1.0 : 0.7);
            hit = true;
            break;
        }
    }
    if (!hit) {
        // the wall between pins: occluded by tall neighbours
        vec2 uv = faceUV(p, n);
        vec2 id = floor(uv / cell);
        vec3 c = tu * (id.x + 0.5) * cell + tv * (id.y + 0.5) * cell;
        float h = height(c, n, T);
        col *= 1.0 - 0.6 * h / HMAX;
        float rr = length(uv / cell - id - 0.5);
        col += vec3(0.12, 0.13, 0.16) * (1.0 - smoothstep(0.33, 0.38, rr)) * (1.0 - h / HMAX);   // flat pin heads
    }
    col += vec3(0.2, 0.22, 0.3) * edgeLines(p, n, 0.005) * 0.5;
    gl_FragColor = vec4(col, 1.0);
}
