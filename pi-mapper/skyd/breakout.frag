// @common  Three-wall breakout (2.26): every face is covered in bricks. A ball
// bounces between the ceiling and both walls; each brick it hits shatters and
// falls away. When they're gone the bricks rebuild from the vertex outward.
// Ball, bricks and shards come from skyd (sims.c).

uniform sampler2D u_bricks;  // per brick: 1 intact, else time since hit (x 100 / 255)
uniform vec4 u_obj[1];       // ball centre, w > 0 in play
uniform vec4 u_shard[6];    // falling shards, w = age (< 0: none)
uniform vec4 u_hit[4];       // recent impacts, w = age

const float BA = 5.0, BD = 3.0;   // bricks along / down (match sims.c)

void main() {
    vec3 ro = u_campos, rd = viewRay(), n;
    float t = roomHit(ro, rd, n);
    if (t > 1e8) { gl_FragColor = vec4(0.0); return; }
    vec3 p = ro + rd * t;
    if (maskOut(p, n) > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    vec3 L = normalize(vec3(-0.6, 0.55, 0.5));
    float T = u_time;

    // ball and shards in front of the walls
    float tb = 1e9; vec3 nb = vec3(0.0); float what = 0.0;
    if (u_obj[0].w > 0.0) {
        tb = sphereHit(ro, rd, u_obj[0].xyz, 0.025);
        if (tb < 1e8) { nb = normalize(ro + rd * tb - u_obj[0].xyz); what = 1.0; }
    }
    for (int i = 0; i < 6; i++) {
        float tt = u_shard[i].w < 0.0 ? 1e9 : sphereHit(ro, rd, u_shard[i].xyz, 0.014 * (1.0 - u_shard[i].w * 0.4));
        if (tt < tb) { tb = tt; nb = normalize(ro + rd * tt - u_shard[i].xyz); what = 2.0; }
    }
    vec3 col;
    if (tb < t) {
        if (what > 1.5) col = vec3(0.85, 0.45, 0.25) * (0.3 + 0.8 * max(dot(nb, L), 0.0));
        else col = vec3(1.0, 0.95, 0.8) * (0.5 + 0.6 * max(dot(nb, L), 0.0));
    } else {
        vec2 uv = faceUV(p, n);
        float face = n.z > 0.5 ? 0.0 : n.y > 0.5 ? 1.0 : 2.0;
        vec2 cs = face < 1.5 ? vec2(u_mask / BA, u_maskd / BD) : vec2(u_mask / BA);
        vec2 cell = floor(uv / cs), f = uv / cs - cell;
        float v = texture2D(u_bricks, vec2((face * BA + cell.x + 0.5) / (BA * 3.0), (cell.y + 0.5) / BA)).r;
        float age = v > 0.99 ? -1.0 : v * 2.55;
        // rebuild from the vertex outward at the end
        bool rebuild = T > 21.0 && length((cell + 0.5) * cs) < (T - 21.0) * 0.22;
        bool intact = age < 0.0 || rebuild;
        vec3 wall = vec3(0.02, 0.022, 0.03) + vec3(0.04, 0.05, 0.08) * gridLine(uv, 0.1, 0.003);
        vec3 base = face < 0.5 ? vec3(0.75, 0.28, 0.2) : face < 1.5 ? vec3(0.22, 0.55, 0.75) : vec3(0.8, 0.6, 0.25);
        base *= 0.85 + 0.3 * hash(cell + face * 7.0);
        vec2 e = min(f, 1.0 - f) * cs;
        float edge = min(e.x, e.y);
        float mortar = smoothstep(0.003, 0.006, edge);
        float bevel = 1.0 + 0.35 * (1.0 - smoothstep(0.006, 0.014, edge)) * (f.x + f.y < 1.0 ? 1.0 : -0.6);
        col = intact ? mix(wall, base * 0.55 * bevel, mortar) : wall;
        if (!intact) col = mix(col, vec3(1.0), (1.0 - smoothstep(0.0, 0.15, age)) * mortar);   // hit flash
        if (rebuild && age >= 0.0) col += vec3(0.5) * (1.0 - smoothstep(0.0, 0.3, (T - 21.0) * 0.22 - length((cell + 0.5) * cs)));
        // ball shadow and contact rings
        if (u_obj[0].w > 0.0) col *= sphereShadow(p, L, u_obj[0].xyz, 0.025);
        for (int i = 0; i < 4; i++) {
            float a = min(u_hit[i].w, 3.0);
            float d = length(p - u_hit[i].xyz);
            col += vec3(1.0, 0.9, 0.7) * exp(-pow((d - 0.02 - a * 0.18) / 0.005, 2.0)) * exp(-a * 4.0) * step(a, 1.0);
        }
        col += vec3(0.22, 0.25, 0.33) * edgeLines(p, n, 0.005) * 0.5;
    }
    gl_FragColor = vec4(col, 1.0);
}
