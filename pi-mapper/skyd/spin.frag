// @common  Corner spin (2.12): a virtual copy of the corner (tinted faces and
// grid) turns about the axis from the vertex toward the viewer, painted onto
// the real surfaces, so walls and ceiling seem to trade places. The real
// seams stay as faint lines.

mat3 rot(vec3 axis, float a) {
    axis = normalize(axis);
    float s = sin(a), c = cos(a), oc = 1.0 - c;
    return mat3(oc*axis.x*axis.x + c,        oc*axis.x*axis.y + axis.z*s, oc*axis.z*axis.x - axis.y*s,
                oc*axis.x*axis.y - axis.z*s, oc*axis.y*axis.y + c,        oc*axis.y*axis.z + axis.x*s,
                oc*axis.z*axis.x + axis.y*s, oc*axis.y*axis.z - axis.x*s, oc*axis.z*axis.z + c);
}

void main() {
    vec3 ro = u_campos, rd = viewRay(), n;
    float t = roomHit(ro, rd, n);
    if (t > 1e8) { gl_FragColor = vec4(0.0); return; }
    vec3 p = ro + rd * t;
    if (maskOut(p, n) > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

    float T = mod(u_time, 15.0);
    // turn one third (faces swap places), pause, turn back
    float ang = (2.0 * PI / 3.0) * (smoothstep(2.0, 6.0, T) - smoothstep(9.0, 13.0, T));
    mat3 R = rot(u_campos, ang);              // about the vertex -> viewer axis
    mat3 Ri = mat3(R[0].x, R[1].x, R[2].x, R[0].y, R[1].y, R[2].y, R[0].z, R[1].z, R[2].z);
    // trace the virtual corner: the room rotated by R (work in its own frame)
    vec3 vro = Ri * ro, vrd = Ri * rd, vn;
    float vt = roomHit(vro, vrd, vn);
    vec3 col = vec3(0.0);
    if (vt < 1e8) {
        vec3 q = vro + vrd * vt;
        vec3 tint = vn.x > 0.5 ? vec3(0.55, 0.25, 0.2) : (vn.z > 0.5 ? vec3(0.2, 0.3, 0.6) : vec3(0.2, 0.5, 0.3));
        float g = gridLine(faceUV(q, vn), 0.1, 0.005);
        col = tint * 0.35 + tint * g * 0.9;
        vec2 quv = faceUV(q, vn);
        col += vec3(1.0, 0.9, 0.7) * (1.0 - smoothstep(0.003, 0.009, min(quv.x, quv.y)));  // virtual seams
    }
    col += vec3(0.2, 0.22, 0.28) * edgeLines(p, n, 0.004);     // real seams, faint
    gl_FragColor = vec4(col * 0.8, 1.0);
}
