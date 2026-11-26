// Per-vertex work for the cube scene: the animation state is the same for
// every pixel, so compute it here (about 15k vertices instead of 900k pixels).
//
// Three acts of 8 s, one per surface (left wall, ceiling, right wall): a
// square hatch opens in the middle of that surface, a cube pushes straight
// out of it, floats a little way out and turns, then slides back in and the
// hatch closes. The cube always stays over ONE surface, well clear of the
// seams and the shape's edges, so its painted image never folds across a
// seam: from off the sweet spot it still reads as a cube on a flat wall.
attribute vec2 a_proj;
attribute vec2 a_cam;
uniform vec2 u_res;
uniform float u_time;
uniform mat3 u_minv;
uniform float u_mask;
uniform float u_maskd;
varying vec3 v_rd;       // ray direction (unnormalized; linear in camera px)
varying vec4 v_box;      // xyz centre, w half size
varying vec3 v_r0, v_r1, v_r2;   // box rotation, rows of R^T (world -> local)
varying vec3 v_light;
varying vec4 v_hole;     // hatch centre (on its surface: one coordinate is 0), w = half size

const float ACT = 8.0;

mat3 rot(vec3 axis, float a) {
    axis = normalize(axis);
    float s = sin(a), c = cos(a), oc = 1.0 - c;
    return mat3(oc*axis.x*axis.x + c,        oc*axis.x*axis.y + axis.z*s, oc*axis.z*axis.x - axis.y*s,
                oc*axis.x*axis.y - axis.z*s, oc*axis.y*axis.y + c,        oc*axis.y*axis.z + axis.x*s,
                oc*axis.z*axis.x + axis.y*s, oc*axis.y*axis.z - axis.x*s, oc*axis.z*axis.z + c);
}

void main() {
    v_rd = u_minv * vec3(a_cam, 1.0);
    float k = mod(u_time, ACT * 3.0);
    float act = floor(k / ACT);
    float a = k - act * ACT;
    float sc = u_mask / 0.6;

    // the surface for this act: normal n, tangent tu, hatch centre hc, light direction
    vec3 n, tu, hc, L;
    if (act < 0.5) {            // left wall (z = 0)
        n = vec3(0.0, 0.0, 1.0); tu = vec3(0.0, 1.0, 0.0);
        hc = vec3(0.6 * u_maskd, 0.54 * u_mask, 0.0);
        L = vec3(-0.35, -0.55, 1.0);       // from in front, a bit up and toward the corner
    } else if (act < 1.5) {     // ceiling (x = 0)
        n = vec3(1.0, 0.0, 0.0); tu = vec3(0.0, 1.0, 0.0);
        hc = vec3(0.0, 0.55 * u_mask, 0.55 * u_mask);
        L = vec3(1.0, -0.45, -0.45);
    } else {                    // right wall (y = 0)
        n = vec3(0.0, 1.0, 0.0); tu = vec3(0.0, 0.0, 1.0);
        hc = vec3(0.6 * u_maskd, 0.0, 0.54 * u_mask);
        L = vec3(-0.35, 1.0, -0.55);
    }
    float h = 0.06 * sc;
    // hatch opens, cube slides out, floats and turns, slides back, hatch closes
    float open = smoothstep(0.2, 1.0, a) * (1.0 - smoothstep(7.0, 7.7, a));
    float out_ = smoothstep(1.0, 2.8, a) * (1.0 - smoothstep(5.6, 7.0, a));
    float turn = smoothstep(2.6, 5.6, a);                 // 0..1 over the float
    float lift = sin(turn * 3.14159);                     // tilt and extra float in the middle
    float cd = mix(-h, 1.7 * h, out_) + 0.25 * h * lift;  // centre distance from the surface
    vec3 tv = cross(n, tu);
    mat3 R = rot(n, turn * 1.5708) * rot(tu, 0.55 * lift) * rot(tv, 0.3 * lift);
    v_r0 = R[0]; v_r1 = R[1]; v_r2 = R[2];
    v_box = vec4(hc + n * cd, h * step(0.01, open + out_));
    v_hole = vec4(hc, (h + 0.004) * open);
    v_light = normalize(L);
    vec2 ndc = a_proj / u_res * 2.0 - 1.0;
    gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
}
