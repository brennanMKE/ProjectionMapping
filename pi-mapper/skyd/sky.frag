// @common  Night sky through the corner: moon, stars, snow and a sleigh
// fly-by, drawn in the viewer's image and clipped to the room-aligned frame.

uniform vec4 u_rect;     // window in viewer pixels: x0, y0, x1, y1 (sizes the snow and sleigh)
uniform float u_snow;    // 0..1 snow amount
uniform float u_speed;   // snowfall speed multiplier (eased)
uniform float u_fall;    // how far the snow has fallen: integral of speed over time
uniform float u_snowold; // snow amount before the last change...
uniform float u_snowat;  // ...which happened when u_fall was this
uniform float u_santa;   // seconds since the last fly-by started
uniform sampler2D u_sprite; // sleigh silhouette, two gallop frames stacked
uniform vec3 u_moon;        // wall (0 left, 1 right), fraction along the seam, fraction down
uniform float u_moonsize;   // angular radius (rad)
uniform float u_santay;     // sleigh path height relative to the moon, in moon diameters

void main() {
    vec2 c = v_cam;
    vec3 rd = viewRay(), nrm;
    float tw = roomHit(u_campos, rd, nrm);
    vec3 wp = u_campos + rd * tw;
    float mo = tw > 1e8 ? 1.0 : maskOut(wp, nrm);
    if (mo > 0.0) {
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

    // moon: at a point on a wall, placed from the web UI; round as seen from the viewer
    vec3 mv = (u_moon.y + u_moon.z) > 0.0 ? u_moon : vec3(0.0, 0.55, 0.55);
    vec3 mp = mv.x < 0.5 ? vec3(mv.z * u_maskd, mv.y * u_mask, 0.0) : vec3(mv.z * u_maskd, 0.0, mv.y * u_mask);
    vec3 md3 = normalize(mp - u_campos);
    float mr = u_moonsize > 0.0 ? u_moonsize : 0.065;  // angular radius (rad)
    float ang = acos(clamp(dot(rd, md3), -1.0, 1.0));
    // screen-aligned axes around the moon: right and up as the viewer sees them
    vec3 sr = u_minv[0]; sr = normalize(sr - md3 * dot(sr, md3));
    vec3 su = -u_minv[1]; su = normalize(su - md3 * dot(su, md3));
    vec2 tq = vec2(dot(rd - md3, sr), dot(rd - md3, su));   // ~ angle from the moon centre
    if (ang < mr) {
        vec2 q = vec2(tq.x, -tq.y) / mr;
        float limb = sqrt(max(0.0, 1.0 - dot(q, q)));
        float maria = 0.0;
        maria += 0.9 * smoothstep(0.42, 0.20, length((q - vec2(-0.30, -0.28)) * vec2(1.0, 1.3)));
        maria += 0.8 * smoothstep(0.30, 0.12, length(q - vec2(0.12, -0.32)));
        maria += 0.8 * smoothstep(0.30, 0.10, length((q - vec2(0.30, -0.02)) * vec2(1.2, 1.0)));
        maria += 0.7 * smoothstep(0.40, 0.15, length((q - vec2(-0.52, 0.12)) * vec2(1.4, 0.9)));
        maria += 0.5 * smoothstep(0.18, 0.05, length(q - vec2(0.18, 0.28)));
        maria = min(maria, 1.0) * (0.75 + 0.25 * hash(floor(q * 9.0)));
        vec3 moon = vec3(1.0, 0.98, 0.9) * (0.72 + 0.28 * limb) * (1.0 - 0.22 * maria);
        col = mix(col, moon, smoothstep(mr, mr * 0.97, ang));
    } else {
        col += vec3(0.5, 0.55, 0.7) * 0.35 * exp(-(ang - mr) / (mr * 0.6));
    }

    // Santa's sleigh: flies right to left across the moon (height from the web UI)
    float dur = 10.0;
    if (u_santa > 0.0 && u_santa < dur) {
        float k = u_santa / dur;
        float sh = mr * 1.4, sw = sh * 4.0;            // one sprite frame is 512x128 (4:1)
        float span = 0.55;                              // radians either side of the moon
        vec2 pos = vec2(mix(span, -span, k), u_santay * 2.0 * mr + 0.15 * mr * sin(k * 6.2832));
        vec2 l = vec2((tq.x - pos.x) / sw + 0.5, 0.5 - (tq.y - pos.y) / sh);
        float frame = mod(floor(u_santa * 7.0), 2.0);
        // sparkle trail behind the sleigh (to its right)
        vec2 tr = vec2(tq.x - (pos.x + 0.5 * sw), tq.y - pos.y) / sh;
        if (tr.x > 0.0 && tr.x < 6.0) {
            float th = hash(floor(c / 6.0) + floor(u_santa * 8.0));
            float band = exp(-abs(tr.y - 0.1 + 0.08 * tr.x * tr.x) * 5.0) * exp(-tr.x * 0.6);
            col += vec3(1.0, 0.9, 0.6) * step(0.93, th) * band * 1.4;
        }
        if (l.x > -0.02 && l.x < 1.02 && l.y > -0.05 && l.y < 1.05) {
            vec2 tc = vec2(l.x, (clamp(l.y, 0.0, 1.0) + frame) * 0.5);
            float a = texture2D(u_sprite, tc).r;
            vec2 o = vec2(2.5 / 512.0, 2.5 / 256.0);
            float rim = max(max(texture2D(u_sprite, tc + vec2(o.x, 0.0)).r, texture2D(u_sprite, tc - vec2(o.x, 0.0)).r),
                            max(texture2D(u_sprite, tc + vec2(0.0, o.y)).r, texture2D(u_sprite, tc - vec2(0.0, o.y)).r));
            col = mix(col, vec3(0.75, 0.82, 1.0), clamp(rim - a, 0.0, 1.0) * 0.9);
            col = mix(col, vec3(0.01, 0.012, 0.03), a);
        }
    }

    // snow: three layers, nearer ones bigger and faster
    if (max(u_snow, u_snowold) > 0.0) {
        for (int i = 0; i < 3; i++) {
            float fi = float(i);
            float scale = 18.0 + fi * 14.0;               // cells across the window height
            float fall = 0.10 + 0.07 * (2.0 - fi);
            vec2 p = vec2(uv.x * aspect, uv.y) * scale;
            p.y -= u_fall * fall * scale;
            p.x += sin(u_time * 0.7 + fi * 2.0 + p.y * 0.15) * 0.35;
            vec2 g = floor(p);
            float r = hash(g + fi * 17.0);
            // a row of flakes enters at the top when the fall reaches -row;
            // rows that entered before the last change keep the old amount
            float born = -(g.y + 1.0) / (fall * scale);
            float amount = born > u_snowat ? u_snow : u_snowold;
            if (r < amount * 0.6) {
                vec2 o = vec2(hash(g + 1.3 + fi), hash(g + 5.1 + fi)) * 0.6 + 0.2;
                float d = length(fract(p) - o);
                float rad = 0.10 + 0.05 * (2.0 - fi);
                col = mix(col, vec3(1.0), smoothstep(rad, rad * 0.4, d) * (0.6 + 0.2 * (2.0 - fi)));
            }
        }
    }

    // fine outline along the frame, like the other scenes
    col += vec3(0.25, 0.3, 0.4) * (1.0 - smoothstep(0.004, 0.009, -mo));

    gl_FragColor = vec4(col, 1.0);
}
