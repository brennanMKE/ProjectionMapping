// @common  Corner flip (2.1): the corner is shaded as an inside corner, then
// the shading inverts so it pops out as a cube corner pointing at the
// viewer (top brightest, sides darker, highlighted edges), then flips back.
// Two tempos in the 15 s loop: one slow flip in muted slate colours, then a
// fast phase that flips on the beat (every 2 beats at 120 BPM) with
// saturated colours that change on every flip, then it settles again.

void main() {
    vec3 ro = u_campos, rd = viewRay(), n;
    float t = roomHit(ro, rd, n);
    if (t > 1e8) { gl_FragColor = vec4(0.0); return; }
    vec3 p = ro + rd * t;
    float mo = maskOut(p, n);
    if (mo > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

    float T = mod(u_time, 15.0);
    // slow phase: one long flip out and back
    float fs = smoothstep(1.0, 3.0, T) * (1.0 - smoothstep(4.5, 6.5, T));
    // fast phase: six quick flips, one per second, 8..14 s
    float ph = T - 8.0;
    float fi = floor(ph), fr = ph - fi;
    float snap = smoothstep(0.0, 0.22, fr);
    float ff = mod(fi, 2.0) < 0.5 ? snap : 1.0 - snap;
    ff *= step(0.0, ph) * step(ph, 6.0);
    float f = max(fs, ff);                                   // 0 concave, 1 convex
    float vib = smoothstep(6.8, 8.0, T) * (1.0 - smoothstep(14.0, 15.0, T));   // 0 muted, 1 vivid
    float b = beat(T) * vib;
    vec2 uv = faceUV(p, n);

    // concave: room light from in front and above-left; corners darken (occlusion)
    vec3 L = normalize(vec3(-0.3 + 0.2 * sin(u_time * 0.3), 0.8, 0.5));
    float concave = 0.18 + 0.5 * max(dot(n, L), 0.0);
    concave *= 0.55 + 0.45 * smoothstep(0.0, 0.12, min(uv.x, uv.y));
    // convex cube: top brightest, left mid, right darkest
    float convex = n.x > 0.5 ? 0.85 : (n.z > 0.5 ? 0.5 : 0.25);
    float shade = mix(concave, convex, f);
    // muted slate, or a bold colour per face that jumps on each flip
    float fid = n.x > 0.5 ? 0.0 : (n.z > 0.5 ? 1.0 : 2.0);
    float hh = fract(max(fi, 0.0) * 0.17 + fid * 0.33 + 0.55);
    vec3 vivid = hue(hh) * (0.2 + 1.1 * shade) * (1.0 + 0.35 * b);
    vec3 col = mix(vec3(0.5, 0.55, 0.62) * shade, vivid, vib);
    // vivid phase: the room grid glows faintly in the face colour
    col += hue(hh) * gridLine(uv, 0.1, 0.004) * 0.25 * vib * (1.0 - f);

    // seams: dark crease when concave, bright edge when convex;
    // the shape's outer edge becomes the cube's outline
    float seam = 1.0 - smoothstep(0.003, 0.01, min(uv.x, uv.y));
    col = mix(col, vec3(0.02), seam * (1.0 - f) * 0.8);
    vec3 edge = mix(vec3(1.0, 0.95, 0.85), vec3(1.0), vib);
    col = mix(col, edge, seam * f);
    float outer = 1.0 - smoothstep(0.003, 0.01, -mo);
    col = mix(col, edge, outer * f);
    col *= mix(0.6, 0.75, vib);   // muted phase stays dark; vivid phase is brighter
    gl_FragColor = vec4(col, 1.0);
}
