// @common  Vortex at the vertex (2.13): the room grid spirals into the corner
// as if a black hole opened there, then collapses and snaps back flat.

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

    float T = mod(u_time, 15.0);
    // strength ramps up, peaks, collapses at 12 s, then the grid snaps back with a wobble
    float S = smoothstep(1.0, 9.0, T) * (1.0 - smoothstep(11.6, 12.2, T));
    float snap = T > 12.0 ? -0.35 * exp(-(T - 12.0) * 3.0) * sin((T - 12.0) * 22.0) : 0.0;
    float s = S + snap;

    vec3 axis = normalize(u_campos);
    float r = length(p);
    float swirl = s * 7.0 * exp(-r / 0.16);                 // radians, strongest at the vertex
    float pull = s * 0.7 * exp(-r / 0.22);                  // radial stretch toward the vertex
    vec3 q = rotAxis(axis, -swirl - u_time * 0.6 * s) * p * (1.0 + pull * 2.0);

    // grid lines from the two in-plane coordinates of the swirled point
    vec3 g = abs(fract(q * 12.0 + 0.5) - 0.5) / 12.0;
    float gm = min(n.x > 0.5 ? 1.0 : g.x, min(n.y > 0.5 ? 1.0 : g.y, n.z > 0.5 ? 1.0 : g.z));
    float w = 0.0025 * (1.0 + 2.5 * s * exp(-r / 0.1));      // lines thicken as they're pulled in
    float line = 1.0 - smoothstep(w * 0.5, w, gm);
    vec3 col = vec3(0.02, 0.022, 0.035) + vec3(0.25, 0.45, 0.9) * line * (0.5 + 0.6 * s * exp(-r / 0.2));

    // streaks sucked in along the seams
    vec2 uv = faceUV(p, n);
    float seam = 1.0 - smoothstep(0.003, 0.012, min(uv.x, uv.y));
    float streak = pow(fract(r * 9.0 + u_time * 2.5 * (0.3 + s)), 6.0);
    col += vec3(0.9, 0.6, 1.0) * seam * streak * S * 0.9;

    // the hole: a black disc facing the viewer with a thin bright ring
    float d = length(cross(rd, -ro));                       // ray's closest distance to the vertex
    float R = 0.045 * s * (1.0 + 0.08 * sin(u_time * 9.0));
    if (R > 0.002) {
        col *= smoothstep(R * 0.92, R * 1.05, d);
        col += vec3(1.0, 0.85, 0.6) * exp(-pow((d - R) / 0.004, 2.0)) * S;
        col += vec3(0.5, 0.3, 0.9) * exp(-max(d - R, 0.0) / 0.03) * 0.25 * S;
    }
    col += vec3(0.2, 0.22, 0.3) * edgeLines(p, n, 0.005) * 0.6;
    gl_FragColor = vec4(col, 1.0);
}
