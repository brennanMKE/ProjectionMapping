// @common  Equalizer (80s set): segmented LED bars rise from the bottom edge of
// both walls to a synthetic 120 BPM beat (kick, snare, hats, a little
// melody). Bass sits at the vertical seam, treble at the outer edges, so
// the two walls mirror each other around the corner. A loud bar climbs all
// the way to the ceiling seam and folds over onto the ceiling, where the
// bars from the two walls cross into a lattice. Peaks hold and fall.
// Everything lies on the surfaces, continuous over the seams: correct from
// anywhere in the room.

const float NB = 8.0;          // bars per wall
const float SEG = 0.026;       // LED segment pitch (m)

// level 0..1 for band i (0 bass .. 1 treble) on channel ch at time T
float level(float i, float ch, float T) {
    float bt = T * 2.0;
    float ph = fract(bt), bi = floor(bt);
    float kick = exp(-ph * 5.0);
    float snare = step(0.5, mod(bi, 2.0)) * exp(-ph * 4.0);
    float hat = exp(-fract(T * 4.0) * 7.0);
    float m8 = floor(T * 4.0);
    float mel = hash(vec2(m8, i * 3.0 + ch * 17.0));
    float wob = 0.5 + 0.5 * sin(T * (2.0 + i * 3.0) + i * 4.0 + ch * 2.0);
    float build = 0.75 + 0.25 * sin(T * PI / 16.0);              // swells over 8 bars
    float lv = 0.1 + (1.0 - i) * 0.8 * kick
             + exp(-pow((i - 0.45) * 3.5, 2.0)) * 0.6 * snare
             + i * 0.4 * hat + 0.22 * mel * wob;
    return clamp(lv * build, 0.0, 1.0);
}

// peak hold: the highest of the last few levels, falling at a fixed rate
float peak(float i, float ch, float T) {
    float pk = level(i, ch, T);
    for (int k = 1; k < 5; k++) {
        float dt = float(k) * 0.12;
        pk = max(pk, level(i, ch, T - dt) - dt * 0.9);
    }
    return pk;
}

// one bar: pixel at distance s along the bar's path (0 at the bottom edge),
// a across it (0..1 inside its cell); returns colour
vec3 bar(float s, float a, float i, float ch, float T, float H) {
    float lv = level(i, ch, T) * H;
    float pk = peak(i, ch, T) * H;
    float inBar = step(0.15, a) * step(a, 0.85);
    float seg = step(fract(s / SEG), 0.72);
    // colour by height: green, through yellow, to hot magenta past the ceiling seam
    float hgt = s / H;
    vec3 c = mix(vec3(0.1, 1.0, 0.35), vec3(1.0, 0.85, 0.1), smoothstep(0.3, 0.55, hgt));
    c = mix(c, vec3(1.0, 0.1, 0.55), smoothstep(0.62, 0.75, hgt));
    float on = step(s, lv);
    vec3 col = c * inBar * seg * (on * 1.1 + 0.07);            // unlit LEDs show faintly
    col += vec3(1.0) * inBar * (1.0 - smoothstep(0.002, 0.005, abs(s - pk - 0.004))) * step(0.02, pk);
    return col;
}

void main() {
    vec3 ro = u_campos, rd = viewRay(), n;
    float t = roomHit(ro, rd, n);
    if (t > 1e8) { gl_FragColor = vec4(0.0); return; }
    vec3 p = ro + rd * t;
    float mo = maskOut(p, n);
    if (mo > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

    float T = u_time;
    float cw = u_mask / NB;
    float H = u_maskd + 0.45 * u_mask;           // full scale: up the wall and well onto the ceiling
    vec3 col = vec3(0.012, 0.0, 0.03);
    // faint floor-glow along the bottom edge, pumping with the kick
    float kick = beat(T);
    if (n.x < 0.5) col += vec3(0.25, 0.0, 0.4) * exp(-(u_maskd - p.x) / 0.04) * (0.3 + 0.7 * kick);

    if (n.z > 0.5) {            // left wall: bars along y, rising up x
        float g = p.y / cw;
        col += bar(u_maskd - p.x, fract(g), floor(g) / (NB - 1.0), 0.0, T, H);
    } else if (n.y > 0.5) {     // right wall: bars along z
        float g = p.z / cw;
        col += bar(u_maskd - p.x, fract(g), floor(g) / (NB - 1.0), 1.0, T, H);
    } else {                    // ceiling: both walls' bars fold over and cross
        float gy = p.y / cw, gz = p.z / cw;
        col += bar(u_maskd + p.z, fract(gy), floor(gy) / (NB - 1.0), 0.0, T, H);
        col += bar(u_maskd + p.y, fract(gz), floor(gz) / (NB - 1.0), 1.0, T, H);
    }
    col += vec3(0.35, 0.2, 0.6) * edgeLines(p, n, 0.005) * (0.4 + 0.4 * kick);
    gl_FragColor = vec4(col, 1.0);
}
