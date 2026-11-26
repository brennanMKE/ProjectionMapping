// Corner calibration: four markers in projector pixels, set live by projd.
//   u_v  the vertex (where the two walls meet the ceiling)  white
//   u_l  a point on the left wall / ceiling seam            red
//   u_r  a point on the right wall / ceiling seam           blue
//   u_d  a point on the wall / wall seam                    yellow
// A line runs from the vertex through each point to the edge of the picture:
// line them up with the real edges.
precision highp float;
uniform vec2 u_res;
uniform vec2 u_v, u_d, u_l, u_r;
uniform vec2 u_cursor;   // pointer from the web editor (offscreen when not hovering)
uniform float u_time;

float ray(vec2 p, vec2 a, vec2 b, float w) {      // half-line from a through b
    vec2 d = normalize(b - a);
    float t = max(dot(p - a, d), 0.0);
    return 1.0 - smoothstep(w * 0.5, w, length(p - (a + d * t)));
}

float dot_(vec2 p, vec2 c, float r) {
    float d = length(p - c);
    return max(1.0 - smoothstep(r - 1.5, r, d), (1.0 - smoothstep(1.0, 2.5, abs(d - r - 6.0))));
}

void main() {
    vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
    vec3 col = vec3(0.0);
    col += vec3(1.0, 0.25, 0.2) * ray(p, u_v, u_l, 3.0);
    col += vec3(0.25, 0.45, 1.0) * ray(p, u_v, u_r, 3.0);
    col += vec3(1.0, 0.85, 0.2) * ray(p, u_v, u_d, 3.0);
    float pulse = 0.75 + 0.25 * sin(u_time * 4.0);
    col = max(col, vec3(1.0, 0.25, 0.2) * dot_(p, u_l, 9.0));
    col = max(col, vec3(0.25, 0.45, 1.0) * dot_(p, u_r, 9.0));
    col = max(col, vec3(1.0, 0.85, 0.2) * dot_(p, u_d, 9.0));
    col = max(col, vec3(1.0) * dot_(p, u_v, 11.0) * pulse);
    // the web editor's pointer: green crosshair with a gap in the middle
    vec2 q = abs(p - u_cursor);
    float arm = (q.x < 1.2 && q.y > 6.0 && q.y < 28.0) || (q.y < 1.2 && q.x > 6.0 && q.x < 28.0) ? 1.0 : 0.0;
    float ring = 1.0 - smoothstep(0.8, 2.0, abs(length(p - u_cursor) - 18.0));
    col = max(col, vec3(0.3, 1.0, 0.45) * max(arm, ring * 0.7));
    // faint frame so the picture edge is visible
    vec2 e = min(p, u_res - p);
    col = max(col, vec3(0.15) * (1.0 - smoothstep(1.0, 3.0, min(e.x, e.y))));
    gl_FragColor = vec4(col, 1.0);
}
