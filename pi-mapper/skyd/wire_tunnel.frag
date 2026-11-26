// @common  Wire tunnel (80s set): nested wireframe cube corners rush into the
// vertex like an endless tunnel. Each ring is the edge of a real cube that
// shares the room's corner (max(x, y, z) = d), so it is drawn where it
// really lies on the surfaces and bends exactly at the seams: correct from
// anywhere in the room. Spokes on planes through the corner axis turn around
// it. The tunnel surges on every beat (120 BPM), reverses for a bar every
// eight bars, and the colours roll through a neon palette.

// distance travelled by time T: 0.35/s plus a decaying surge after each beat
float travel(float T) {
    float bt = T * 2.0;
    float k = (1.0 - exp(-6.0)) / 6.0;
    return T * 0.35 + 1.6 * (floor(bt) * k + (1.0 - exp(-6.0 * fract(bt))) / 6.0);
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
    // travel: steady flow plus a surge on each beat; the last bar of every
    // eight runs backwards (kept continuous)
    float u = mod(T, 16.0);
    float T0 = T - max(u - 14.0, 0.0);                     // where the reverse bar started
    float P = travel(T) - 2.0 * travel(2.0) * floor(T / 16.0) - 2.0 * (travel(T) - travel(T0));

    // ring coordinate: the cube shell this point lies on, log-spaced so the
    // rings keep coming out of (or into) the vertex forever
    float m = max(max(p.x, p.y), p.z);
    float lm = log(max(m, 0.002)) * 4.0;
    float rc = lm + P * 2.0;
    float ri = floor(rc);
    float rf = fract(rc);
    float ring = exp(-pow((rf - 0.5) / (0.035 + 0.03 * b), 2.0));
    // fade into the vertex, where the rings crowd together
    float fadeIn = smoothstep(0.025, 0.11, m);

    // spokes: planes through the corner axis (1,1,1), turning around it
    vec3 ax = vec3(0.57735);
    vec3 e1 = normalize(vec3(1.0, -1.0, 0.0)), e2 = cross(ax, e1);
    vec3 q = p - ax * dot(p, ax);
    float ang = atan(dot(q, e2), dot(q, e1));
    float sa = ang * 6.0 / (2.0 * PI) - P * 0.12;
    float sd = abs(fract(sa) - 0.5) * length(q) * (2.0 * PI / 6.0);   // metres to the nearest spoke
    float spoke = exp(-sd * sd / 0.000006) * smoothstep(0.02, 0.1, length(q));

    // colour: each ring its own neon hue, rolling with time
    vec3 rcol = hue(fract(ri * 0.13 + T * 0.05));
    rcol = mix(rcol, vec3(1.0), 0.15);
    vec3 col = vec3(0.01, 0.0, 0.025);
    col += vec3(0.04, 0.0, 0.07) * (1.0 - smoothstep(0.0, 0.5, m));   // faint glow down the tunnel
    col += rcol * ring * fadeIn * (0.8 + 0.8 * b);
    col += vec3(0.2, 0.7, 1.0) * spoke * 0.6;
    col += vec3(0.6, 0.3, 1.0) * edgeLines(p, n, 0.005) * (0.3 + 0.5 * b);
    gl_FragColor = vec4(col, 1.0);
}
