// Night sky, computed live at the viewer's (camera's) pixel coordinates.
// GLSL ES 1.00 for the Pi's VideoCore GPU: keep it cheap.
precision highp float;

varying vec2 v_cam;      // viewer pixel (webcam image, 1280x720)
uniform float u_time;    // seconds
uniform vec4 u_rect;     // window in viewer pixels: x0, y0, x1, y1
uniform float u_snow;    // 0..1 snow amount
uniform float u_speed;   // snowfall speed multiplier
uniform float u_santa;   // seconds since the last fly-by started
uniform sampler2D u_sprite; // sleigh silhouette, two gallop frames stacked

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

void main() {
    vec2 c = v_cam;
    if (c.x < u_rect.x || c.x > u_rect.z || c.y < u_rect.y || c.y > u_rect.w) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }
    vec2 size = u_rect.zw - u_rect.xy;
    vec2 uv = (c - u_rect.xy) / size;            // 0..1 inside the window, y down
    float aspect = size.x / size.y;

    // sky: deep blue at the top, lighter toward the horizon
    vec3 col = mix(vec3(0.02, 0.04, 0.12), vec3(0.08, 0.13, 0.30), uv.y);

    // stars on a jittered grid, twinkling
    vec2 sp = c / 9.0;
    vec2 cell = floor(sp);
    float h = hash(cell);
    if (h > 0.86) {
        vec2 o = vec2(hash(cell + 7.1), hash(cell + 3.7)) * 0.8 + 0.1;
        float d = length(fract(sp) - o);
        float tw = 0.6 + 0.4 * sin(u_time * (1.0 + h * 3.0) + h * 40.0);
        float b = smoothstep(0.16, 0.0, d) * tw * (0.5 + 0.5 * fract(h * 13.0));
        col += vec3(0.85, 0.9, 1.0) * b;
    }

    // moon: round in the viewer's image, upper left of the window
    vec2 mc = u_rect.xy + size * vec2(0.24, 0.32);
    float mr = size.y * 0.16;
    float md = length(c - mc);
    if (md < mr) {
        vec2 q = (c - mc) / mr;
        float limb = sqrt(max(0.0, 1.0 - dot(q, q)));
        float maria = 0.0;   // dark "seas", roughly where they are on the real moon
        maria += 0.9 * smoothstep(0.42, 0.20, length((q - vec2(-0.30, -0.28)) * vec2(1.0, 1.3)));
        maria += 0.8 * smoothstep(0.30, 0.12, length(q - vec2(0.12, -0.32)));
        maria += 0.8 * smoothstep(0.30, 0.10, length((q - vec2(0.30, -0.02)) * vec2(1.2, 1.0)));
        maria += 0.7 * smoothstep(0.40, 0.15, length((q - vec2(-0.52, 0.12)) * vec2(1.4, 0.9)));
        maria += 0.5 * smoothstep(0.18, 0.05, length(q - vec2(0.18, 0.28)));
        maria = min(maria, 1.0) * (0.75 + 0.25 * hash(floor(q * 9.0)));
        vec3 moon = vec3(1.0, 0.98, 0.9) * (0.72 + 0.28 * limb) * (1.0 - 0.22 * maria);
        col = mix(col, moon, smoothstep(mr, mr - 1.5, md));
    } else {
        col += vec3(0.5, 0.55, 0.7) * 0.35 * exp(-(md - mr) / (mr * 0.6));
    }

    // Santa's sleigh: flies right to left across the upper sky, past the moon
    float dur = 10.0;
    if (u_santa > 0.0 && u_santa < dur) {
        float k = u_santa / dur;
        float sh = size.y * 0.24, sw = sh * 4.0;      // one sprite frame is 512x128 (4:1)
        vec2 pos = vec2(mix(u_rect.z + 0.1 * sw, u_rect.x - 1.1 * sw, k),
                        u_rect.y + size.y * (0.10 + 0.10 * sin(k * 3.14159) + 0.06 * k));
        vec2 l = (c - pos) / vec2(sw, sh);
        float frame = mod(floor(u_santa * 7.0), 2.0);
        // sparkle trail behind the sleigh (to its right)
        vec2 tr = (c - (pos + vec2(sw * 0.98, sh * 0.62))) / sh;
        if (tr.x > 0.0 && tr.x < 6.0) {
            vec2 tg = floor(c / 6.0);
            float th = hash(tg + floor(u_santa * 8.0));
            float band = exp(-abs(tr.y + 0.08 * tr.x * tr.x) * 5.0) * exp(-tr.x * 0.6);
            col += vec3(1.0, 0.9, 0.6) * step(0.93, th) * band * 1.4;
        }
        if (l.x > -0.02 && l.x < 1.02 && l.y > -0.05 && l.y < 1.05) {
            vec2 tc = vec2(l.x, (clamp(l.y, 0.0, 1.0) + frame) * 0.5);
            float a = texture2D(u_sprite, tc).r;
            // moonlit rim: coverage nearby minus coverage here
            float rim = 0.0;
            vec2 o = vec2(2.5 / 512.0, 2.5 / 256.0);
            rim = max(max(texture2D(u_sprite, tc + vec2(o.x, 0.0)).r, texture2D(u_sprite, tc - vec2(o.x, 0.0)).r),
                      max(texture2D(u_sprite, tc + vec2(0.0, o.y)).r, texture2D(u_sprite, tc - vec2(0.0, o.y)).r));
            col = mix(col, vec3(0.75, 0.82, 1.0), clamp(rim - a, 0.0, 1.0) * 0.9);
            col = mix(col, vec3(0.01, 0.012, 0.03), a);
        }
    }

    // snow: three layers, nearer ones bigger and faster
    if (u_snow > 0.0) {
        for (int i = 0; i < 3; i++) {
            float fi = float(i);
            float scale = 18.0 + fi * 14.0;               // cells across the window height
            float fall = (0.10 + 0.07 * (2.0 - fi)) * u_speed;
            vec2 p = vec2(uv.x * aspect, uv.y) * scale;
            p.y -= u_time * fall * scale;
            p.x += sin(u_time * 0.7 + fi * 2.0 + p.y * 0.15) * 0.35;
            vec2 g = floor(p);
            float r = hash(g + fi * 17.0);
            if (r < u_snow * 0.6) {
                vec2 o = vec2(hash(g + 1.3 + fi), hash(g + 5.1 + fi)) * 0.6 + 0.2;
                float d = length(fract(p) - o);
                float rad = 0.10 + 0.05 * (2.0 - fi);
                col = mix(col, vec3(1.0), smoothstep(rad, rad * 0.4, d) * (0.6 + 0.2 * (2.0 - fi)));
            }
        }
    }

    // soft vignette at the window edges
    float e = min(min(uv.x, 1.0 - uv.x) * aspect, min(uv.y, 1.0 - uv.y));
    col *= 0.6 + 0.4 * smoothstep(0.0, 0.06, e);

    gl_FragColor = vec4(col, 1.0);
}
