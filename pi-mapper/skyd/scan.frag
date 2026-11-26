// @common  Scanning planes (2.8): thin planes of light sweep through the room;
// each draws a line where it cuts each surface, continuous across the seams.
// View-independent: correct from anywhere in the room.

float plane(vec3 p, vec3 n, float d, float w) {
    float x = abs(dot(p, normalize(n)) - d);
    return exp(-x * x / (w * w)) + 0.25 * exp(-x / (w * 6.0));
}

void main() {
    vec3 ro = u_campos, rd = viewRay(), n;
    float t = roomHit(ro, rd, n);
    if (t > 1e8) { gl_FragColor = vec4(0.0); return; }
    vec3 p = ro + rd * t;
    float mo = maskOut(p, n);
    if (mo > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

    float T = u_time;
    vec3 col = vec3(0.02, 0.025, 0.04);
    col += vec3(0.05, 0.07, 0.12) * gridLine(faceUV(p, n), 0.2, 0.006);
    float b = beat(T);
    // horizontal plane falling from the ceiling
    float hd = fract(T / 4.0) * u_maskd;   // fades in as it leaves the ceiling, so it doesn't flood it
    col += vec3(0.1, 0.9, 1.0) * plane(p, vec3(1, 0, 0), hd, 0.006) * (0.7 + 0.5 * b) * smoothstep(0.0, 0.05, hd);
    // vertical plane rotating about the vertical seam
    float a = T * 0.6;
    col += vec3(1.0, 0.25, 0.8) * plane(p, vec3(0.0, cos(a), sin(a)), 0.12 * sin(T * 0.9), 0.006);
    // tilted plane, perpendicular to the room diagonal, moving out from the corner
    col += vec3(1.0, 0.75, 0.2) * plane(p, vec3(1, 1, 1), fract(T / 3.0) * u_mask * 1.6, 0.007) * (0.6 + 0.6 * b);
    col += vec3(0.3, 0.35, 0.45) * edgeLines(p, n, 0.006);
    gl_FragColor = vec4(col, 1.0);
}
