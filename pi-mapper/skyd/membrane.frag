// @common  Membrane push (2.4): the surfaces look like stretched fabric with a
// grid. Something presses from behind and bulges it toward the viewer,
// wandering around, then pushes hard near the corner. The grid bends with
// the bulge (parallax), shaded from one light.

void main() {
    vec3 ro = u_campos, rd = viewRay(), n;
    float t = roomHit(ro, rd, n);
    if (t > 1e8) { gl_FragColor = vec4(0.0); return; }
    vec3 p = ro + rd * t;
    if (maskOut(p, n) > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

    float T = mod(u_time, 15.0);
    // the pressing point wanders over the three surfaces, then settles near the vertex
    float a = T * 0.7;
    vec3 c = vec3(0.16 + 0.1 * sin(a * 1.3), 0.18 + 0.12 * sin(a), 0.18 + 0.12 * cos(a * 0.8));
    c = mix(c, vec3(0.06), smoothstep(10.0, 13.0, T));
    float amp = 0.05 * (0.6 + 0.4 * sin(T * 1.7)) * smoothstep(0.0, 2.0, T) * (1.0 + 1.5 * smoothstep(10.0, 13.5, T))
              * (1.0 - smoothstep(13.5, 15.0, T));
    float sig = 0.09;

    // bump measured in 3D from the pressing point, projected onto the surface
    vec3 tu, tv;
    faceAxes(n, tu, tv);
    vec3 dp = p - c;
    vec3 dpt = dp - n * dot(dp, n);
    float h = amp * exp(-dot(dpt, dpt) / (sig * sig));
    // parallax: the bulged surface is met earlier along the ray
    vec3 ps = p - rd * (h / max(abs(dot(rd, n)), 0.2));
    vec2 uv = faceUV(ps, n);
    // normal from the bump's gradient
    vec3 grad = dpt * (-2.0 * h / (sig * sig));
    vec3 nn = normalize(n - grad);
    vec3 L = normalize(vec3(-0.6, 0.7, 0.4));
    float diff = max(dot(nn, L), 0.0);

    vec3 col = vec3(0.07, 0.08, 0.11) * (0.5 + 1.2 * diff);
    col += vec3(0.25, 0.4, 0.7) * gridLine(uv, 0.04, 0.0025) * (0.4 + 0.8 * diff);
    col += vec3(0.25, 0.3, 0.4) * edgeLines(p, n, 0.006);
    gl_FragColor = vec4(col, 1.0);
}
