// @common  Neon grid (80s set): a Tron-style laser grid on all three surfaces,
// lines at fixed room coordinates so every line runs straight over the seams.
// A laser front sweeps the grid every two bars, lighting the lines it
// crosses (down from the ceiling, along each seam, then a shell out of the
// vertex). Light-cycle trails race along the grid lines and turn the corner
// at the seams, from wall to wall and from the ceiling down a wall.
// All view-independent: correct from anywhere in the room. 120 BPM.

const float SP = 0.1;   // grid spacing (m)

// a light cycle on a path that bends over one seam: s < 0 on the first face,
// s > 0 on the second; returns the glow at this pixel
float cycle(float s, float dist, float head, float len) {
    float behind = head - s;
    float trail = step(0.0, behind) * exp(-behind / len);
    float core = exp(-dist * dist / 0.00001) * 1.3;
    float halo = exp(-dist / 0.01) * 0.5;
    float headGlow = exp(-(behind * behind + dist * dist) / 0.0002);
    return (core + halo) * trail + headGlow * 2.0;
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
    vec2 uv = faceUV(p, n);

    // the grid: thin lines plus a soft halo
    vec2 g = abs(fract(uv / SP + 0.5) - 0.5) * SP;
    float gm = min(g.x, g.y);
    float line = 1.0 - smoothstep(0.0012, 0.0028, gm);
    float halo = exp(-gm / 0.006);

    // the sweeping laser front: a new direction every 4 s (2 bars)
    float k = mod(floor(T / 4.0), 4.0), f = fract(T / 4.0);
    float coord;
    if (k < 0.5) coord = p.x / u_maskd;                       // down from the ceiling
    else if (k < 1.5) coord = p.y / u_mask;                   // out along the left seam
    else if (k < 2.5) coord = p.z / u_mask;                   // out along the right seam
    else coord = length(p) / (u_mask * 1.15);                 // a shell out of the vertex
    float front = coord - (f * 1.4 - 0.2);
    float lit = exp(-front * front / 0.0016) + step(front, 0.0) * exp(front * 6.0) * 0.35;
    float edge = exp(-front * front / 0.00012);               // the front itself, a thin bright line

    vec3 col = vec3(0.0, 0.006, 0.018) + vec3(0.0, 0.03, 0.06) * halo;
    col += vec3(0.05, 0.45, 0.85) * line * (0.28 + 0.25 * b + 1.6 * lit);
    col += vec3(0.6, 0.95, 1.0) * edge * 0.8;

    // light cycles: snapped to grid lines, one new run every 3 s each
    vec3 cc = vec3(0.0);
    for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float per = 3.0 + fi * 0.37;
        float run = floor((T + fi * 1.3) / per);
        float ft = fract((T + fi * 1.3) / per);
        float r = hash(vec2(run, fi * 3.1));
        float lane = (1.0 + floor(r * 3.0)) * SP;              // which grid line
        float head = mix(-u_mask, u_mask, ft * 1.25);
        float s = 9.0, dist = 9.0;
        float ty = mod(fi, 3.0);
        if (ty < 0.5) {                     // around the walls at height lane: left wall -> right wall
            float ln = min(lane, u_maskd - SP * 0.5);
            if (n.z > 0.5) { s = -p.y; dist = abs(p.x - ln); }
            if (n.y > 0.5) { s = p.z;  dist = abs(p.x - ln); }
        } else if (ty < 1.5) {              // over the ceiling, then down the left wall (y = lane)
            if (n.x > 0.5) { s = -p.z; dist = abs(p.y - lane - SP); }
            if (n.z > 0.5) { s = p.x; dist = abs(p.y - lane - SP); }
        } else {                            // over the ceiling, then down the right wall (z = lane)
            if (n.x > 0.5) { s = -p.y; dist = abs(p.z - lane - SP); }
            if (n.y > 0.5) { s = p.x; dist = abs(p.z - lane - SP); }
        }
        float c = cycle(s, dist, head, 0.35);
        cc += hue(fract(0.07 + fi * 0.42)) * c;                // orange, cyan, magenta, green
    }
    col += cc;
    col += vec3(0.3, 0.5, 0.7) * edgeLines(p, n, 0.005) * (0.4 + 0.4 * b);
    gl_FragColor = vec4(col, 1.0);
}
