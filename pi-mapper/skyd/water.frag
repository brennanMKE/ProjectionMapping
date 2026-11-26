// @common  Water fill (2.7): the corner fills with water. One waterline on
// all three surfaces at once (view-independent), ripples, caustics below,
// shimmering light above; drains quickly when it reaches the ceiling.

float caustic(vec2 q, float t) {
    float c = 0.0;
    c += sin(q.x * 31.0 + t * 1.7 + sin(q.y * 23.0 - t));
    c += sin(q.y * 29.0 - t * 1.3 + sin(q.x * 19.0 + t * 0.7));
    c += sin((q.x + q.y) * 21.0 + t * 0.9);
    return pow(max(0.0, c / 3.0), 3.0);
}

void main() {
    vec3 ro = u_campos, rd = viewRay(), n;
    float t = roomHit(ro, rd, n);
    if (t > 1e8) { gl_FragColor = vec4(0.0); return; }
    vec3 p = ro + rd * t;
    if (maskOut(p, n) > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

    // level measured down from the ceiling: rises from the bottom over 14 s,
    // holds full for 2 s, drains in 3 s
    float T = mod(u_time, 20.0);
    float fill = smoothstep(0.0, 14.0, T) * (1.0 - smoothstep(16.0, 19.0, T));
    float level = u_maskd * 1.05 * (1.0 - fill) - 0.02;
    float ripple = 0.006 * sin(p.y * 40.0 + u_time * 3.0) + 0.006 * sin(p.z * 37.0 - u_time * 2.6);
    float d = p.x - (level + ripple);          // > 0 under water

    vec3 col = vec3(0.025, 0.03, 0.045) + vec3(0.04, 0.05, 0.08) * gridLine(faceUV(p, n), 0.2, 0.006);
    // light reflected off the water surface dancing on the walls above it
    if (d < 0.0 && level > 0.0) col += vec3(0.25, 0.45, 0.6) * caustic(p.yz + p.x, u_time) * exp(d * 12.0) * 0.6;
    if (d > 0.0) {
        float depth = d;
        col = mix(col, vec3(0.0, 0.12, 0.25), 0.85);
        col += vec3(0.2, 0.55, 0.75) * caustic(p.yz * 1.3 + vec2(0.0, p.x), u_time * 1.2) * exp(-depth * 3.0) * 0.8;
        col *= exp(-depth * 1.2);
    }
    col += vec3(0.7, 0.95, 1.0) * exp(-d * d / 0.00002);   // the waterline
    col += vec3(0.25, 0.3, 0.4) * edgeLines(p, n, 0.006);
    gl_FragColor = vec4(col, 1.0);
}
