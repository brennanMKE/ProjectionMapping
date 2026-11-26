// @common  Rotor grid (80s set): a TV-studio backdrop of coloured line grids
// that turn in 3D. Each grid is a stack of parallel planes through the room;
// where the planes cut the three surfaces they draw lines, so every line is
// continuous over the seams and correct from anywhere in the room. Two
// stacks at a time make a lattice; it turns smoothly, then every two bars
// it lurches to a new angle on the beat, and the colour pair changes.

// a stack of planes with normal N: lines on the surface (normal n), width w
// measured on the surface whatever the angle between the planes and the surface
float stack(vec3 p, vec3 n, vec3 N, float sp, float off, float w) {
    float g = max(length(N - n * dot(N, n)), 0.15);
    float d = abs(fract(dot(p, N) / sp + off) - 0.5) * sp / g;
    return 1.0 - smoothstep(w * 0.5, w, d);
}

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
    float mo = maskOut(p, n);
    if (mo > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

    float T = u_time;
    float b = beat(T);
    // smooth spin, plus a quick lurch at the start of every 2 bars (4 s)
    float sec = floor(T / 4.0), f = fract(T / 4.0);
    float lurch = sec + smoothstep(0.0, 0.06, f);              // +1 step in a quarter beat
    mat3 R = rotAxis(vec3(0.57735), lurch * 0.7 + T * 0.05) * rotAxis(normalize(vec3(1.0, 0.3, 0.2)), T * 0.18 + lurch * 0.25);
    vec3 N1 = R * vec3(1.0, 0.0, 0.0);
    vec3 N2 = R * vec3(0.0, 0.70710678, 0.70710678);

    float sp = 0.075;
    float w = 0.004 + 0.003 * b;
    float l1 = stack(p, n, N1, sp, T * 0.15, w);
    float l2 = stack(p, n, N2, sp, -T * 0.11, w);
    // a third, sparse stack of thick bars drifting through
    float l3 = stack(p, n, R * vec3(0.0, 0.70710678, -0.70710678), sp * 3.0, T * 0.3, 0.02);

    // colour pair changes every 2 bars
    float h = fract(sec * 0.31 + 0.85);
    vec3 c1 = hue(h), c2 = hue(h + 0.5);
    vec3 col = mix(vec3(0.01, 0.0, 0.03), vec3(0.03, 0.0, 0.06), smoothstep(0.0, 0.6, length(p)));
    col += c1 * l1 * (0.75 + 0.5 * b);
    col += c2 * l2 * (0.75 + 0.5 * b);
    col += mix(c1, c2, 0.5) * l3 * 0.18;
    // lattice crossings flare white
    col += vec3(1.0) * l1 * l2 * (0.4 + 0.6 * b);
    // a flash over everything on the lurch
    col += mix(c1, vec3(1.0), 0.5) * exp(-f * 4.0 * 12.0) * 0.25;
    col += vec3(0.3, 0.3, 0.45) * edgeLines(p, n, 0.005) * 0.5;
    gl_FragColor = vec4(col, 1.0);
}
