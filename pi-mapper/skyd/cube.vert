// Per-vertex work for the cube scene: the animation state is the same for
// every pixel, so compute it here (about 15k vertices instead of 900k pixels).
attribute vec2 a_proj;
attribute vec2 a_cam;
uniform vec2 u_res;
uniform float u_time;
uniform mat3 u_minv;
varying vec3 v_rd;       // ray direction (unnormalized; linear in camera px)
varying vec4 v_box;      // xyz centre, w half size
varying vec3 v_r0, v_r1, v_r2;   // box rotation, rows of R^T (world -> local)
varying vec3 v_light;

const float PERIOD = 24.0;

mat3 rot(vec3 axis, float a) {
    axis = normalize(axis);
    float s = sin(a), c = cos(a), oc = 1.0 - c;
    return mat3(oc*axis.x*axis.x + c,        oc*axis.x*axis.y + axis.z*s, oc*axis.z*axis.x - axis.y*s,
                oc*axis.x*axis.y - axis.z*s, oc*axis.y*axis.y + c,        oc*axis.y*axis.z + axis.x*s,
                oc*axis.z*axis.x + axis.y*s, oc*axis.y*axis.z - axis.x*s, oc*axis.z*axis.z + c);
}

void main() {
    v_rd = u_minv * vec3(a_cam, 1.0);
    float k = mod(u_time, PERIOD);
    float grow = smoothstep(0.0, 5.0, k) * (1.0 - smoothstep(21.0, 24.0, k));
    float h = 0.17 * grow;
    float fly = smoothstep(7.0, 10.0, k) * (1.0 - smoothstep(17.0, 20.0, k));
    vec3 c = mix(vec3(h), vec3(0.50, 0.42, 0.42), fly);
    mat3 R = rot(vec3(1.0, 0.7, 0.4), fly * (k - 7.0) * 0.7);
    // rows of R^T are the columns of R
    v_r0 = R[0]; v_r1 = R[1]; v_r2 = R[2];
    v_box = vec4(c, h);
    float la = u_time * 0.25;
    v_light = normalize(vec3(-1.0, 0.55 + 0.35 * sin(la), 0.55 + 0.35 * cos(la)));
    vec2 ndc = a_proj / u_res * 2.0 - 1.0;
    gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
}
