// @common  Spotlight reveal (2.17): the corner is dark. A spotlight beam sweeps
// around on a slow Lissajous path; wherever it lands, hidden carved relief
// shows, lit by the beam itself so its shadows move with it. Low average
// brightness by design. Ends with the beam widening to light everything.

// hidden layer: embossed rosettes and rings on a diamond lattice
float relief(vec2 uv) {
    vec2 c = uv / 0.11;
    vec2 cell = floor(c + 0.5), f = c - cell;
    float odd = mod(cell.x + cell.y, 2.0);
    float r = length(f);
    float ang = atan(f.y, f.x);
    float petals = 0.5 + 0.5 * cos(ang * (odd > 0.5 ? 6.0 : 8.0));
    float rosette = smoothstep(0.30 + 0.12 * petals, 0.24 + 0.12 * petals, r);
    float ring = smoothstep(0.05, 0.02, abs(r - 0.42));
    float diamond = smoothstep(0.05, 0.02, abs(abs(f.x) + abs(f.y) - 0.62));
    return 0.006 * max(rosette, max(ring, diamond) * 0.7);
}

void main() {
    vec3 ro = u_campos, rd = viewRay(), n;
    float t = roomHit(ro, rd, n);
    if (t > 1e8) { gl_FragColor = vec4(0.0); return; }
    vec3 p = ro + rd * t;
    if (maskOut(p, n) > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

    float T = u_time;
    // the lamp: up and to the side of the viewer, in front of the corner
    vec3 S = u_campos * 0.55 + vec3(-0.35, 0.25, -0.15);
    vec3 target = vec3(u_maskd * (0.45 + 0.4 * sin(T * 0.53)),
                       u_mask * (0.45 + 0.42 * sin(T * 0.37 + 1.0)),
                       u_mask * (0.45 + 0.42 * cos(T * 0.29)));
    vec3 axis = normalize(target - S);
    float widen = smoothstep(11.5, 14.5, mod(T, 15.0)) * step(15.0, 15.0);
    float cone = mix(0.07, 0.9, widen) * smoothstep(0.0, 1.5, T);   // half-angle, radians

    // footprint on the surface: soft cone
    vec3 sp = p - S;
    float ca = dot(normalize(sp), axis);
    float lit = smoothstep(cos(cone * 1.15), cos(cone * 0.85), ca);

    vec3 col = vec3(0.008, 0.009, 0.014);
    if (lit > 0.001) {
        vec2 uv = faceUV(p, n);
        vec3 tu, tv;
        faceAxes(n, tu, tv);
        float e = 0.003;
        float h = relief(uv);
        vec2 g = vec2(relief(uv + vec2(e, 0.0)) - h, relief(uv + vec2(0.0, e)) - h) / e;
        vec3 nn = normalize(n - tu * g.x - tv * g.y);
        vec3 Ld = normalize(S - p);
        float diff = max(dot(nn, Ld), 0.0);
        // self-shadow: step toward the lamp across the relief
        vec2 ld = vec2(dot(Ld, tu), dot(Ld, tv));
        float sh = 1.0;
        for (int i = 1; i <= 3; i++) {
            float s = float(i) * 0.006;
            if (relief(uv + ld * s) > h + s * dot(Ld, n) * 0.5 + 0.0005) sh = 0.3;
        }
        float fall = 1.0 / (1.0 + dot(sp, sp) * 0.6);
        col += vec3(1.0, 0.9, 0.72) * lit * (0.08 + 0.9 * diff * sh) * fall * 0.75;
    }
    // the beam in the air: brightness by how close the view ray passes the axis
    vec3 w0 = ro - S;
    float b = dot(rd, axis), d = dot(rd, w0), e2 = dot(axis, w0);
    float den = max(1.0 - b * b, 1e-4);
    float tr = clamp((b * e2 - d) / den, 0.0, t);          // along the view ray, before the wall
    float ta = max((e2 - b * d) / den, 0.0);                // along the beam
    vec3 pr = ro + rd * tr, pa = S + axis * ta;
    float rad = max(ta * tan(cone), 0.005);
    col += vec3(0.5, 0.45, 0.38) * exp(-pow(length(pr - pa) / rad, 2.0) * 2.0) * 0.10 * (1.0 - widen);
    gl_FragColor = vec4(col, 1.0);
}
