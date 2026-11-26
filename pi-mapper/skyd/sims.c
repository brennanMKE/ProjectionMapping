// Per-frame simulations for the Part 3 scenes (corner-illusions-demo-3.md).
// Included by skyd.c. Every scene's state is the same for every pixel, so it
// is computed here once per frame and handed to the shader as uniforms; the
// GPU only draws. All of it is deterministic: physics steps at a fixed 120 Hz
// from the scene's start and uses a seeded generator, so a scene looks the
// same every time it runs.
//
// Room coordinates (meters): x down the vertical seam, y along the left
// wall/ceiling seam, z along the right one. Ceiling x=0, left wall z=0,
// right wall y=0; the room is x, y, z >= 0.

#define SIM_DT (1.0f / 120.0f)

typedef struct { float x, y, z; } V3;
static V3 v3(float x, float y, float z) { V3 r = {x, y, z}; return r; }
static V3 vadd(V3 a, V3 b) { return v3(a.x + b.x, a.y + b.y, a.z + b.z); }
static V3 vsub(V3 a, V3 b) { return v3(a.x - b.x, a.y - b.y, a.z - b.z); }
static V3 vmul(V3 a, float k) { return v3(a.x * k, a.y * k, a.z * k); }
static float vdot(V3 a, V3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
static float vlen(V3 a) { return sqrtf(vdot(a, a)); }
static V3 vnorm(V3 a) { float l = vlen(a); return l > 1e-9f ? vmul(a, 1 / l) : a; }
static V3 vlerp(V3 a, V3 b, float t) { return vadd(a, vmul(vsub(b, a), t)); }
static float sstep(float a, float b, float x) { float t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
static float clampf(float v, float lo, float hi) { return v < lo ? lo : v > hi ? hi : v; }

static unsigned sim_seed;
static float rnd(void) { sim_seed = sim_seed * 1664525u + 1013904223u; return (sim_seed >> 8) / 16777216.0f; }

static void sim_mask(GLuint prog, float *mask, float *maskd) {
    *mask = 0.6f; *maskd = 0.4f;
    GLint a = glGetUniformLocation(prog, "u_mask"), b = glGetUniformLocation(prog, "u_maskd");
    if (a >= 0) glGetUniformfv(prog, a, mask);
    if (b >= 0) glGetUniformfv(prog, b, maskd);
}
static void set4(GLuint prog, const char *name, const float *v, int n) {
    GLint loc = glGetUniformLocation(prog, name);
    if (loc >= 0) glUniform4fv(loc, n, v);
}
static void set3(GLuint prog, const char *name, V3 v) {
    GLint loc = glGetUniformLocation(prog, name);
    if (loc >= 0) glUniform3f(loc, v.x, v.y, v.z);
}
static void set1(GLuint prog, const char *name, float v) {
    GLint loc = glGetUniformLocation(prog, name);
    if (loc >= 0) glUniform1f(loc, v);
}

// ------------------------------------------------------------ gravity carousel (2.23)
// Balls and blocks rest on one face as if it were the floor; gravity swings
// to the next face, they slide, tumble over the seam and settle there.
#define CN 6     // the Pi's GPU silently drops larger unrolled loops
static struct { V3 p, v; float r; int box; } cb[CN];
static float c_t = -1;

static V3 carousel_g(float t) {
    // floor: left wall (-z), ceiling (-x), right wall (-y), back to the left wall
    static const float hold = 3.5f, swing = 2.8f;
    V3 dirs[4] = {v3(0, 0, -1), v3(-1, 0, 0), v3(0, -1, 0), v3(0, 0, -1)};
    float tt = fmodf(t, 25.0f);
    for (int i = 0; i < 3; i++) {
        float s0 = hold + i * (hold + swing + 1.0f);
        if (tt < s0) return dirs[i];
        if (tt < s0 + swing) {
            float k = sstep(0, 1, (tt - s0) / swing);
            k = k * k;   // ease in: slide slowly, then fall
            return vnorm(vlerp(dirs[i], dirs[i + 1], k));
        }
    }
    return dirs[3];
}

static void carousel_update(GLuint prog, float st) {
    float mask, maskd;
    sim_mask(prog, &mask, &maskd);
    V3 hi = v3(maskd * 0.95f, mask * 0.92f, mask * 0.92f);
    if (st < c_t || c_t < 0) {
        sim_seed = 23;
        for (int i = 0; i < CN; i++) {
            cb[i].box = i % 3 == 2;
            cb[i].r = 0.034f + 0.016f * rnd();
            cb[i].p = v3(0.06f + rnd() * (maskd - 0.12f), 0.08f + rnd() * (mask - 0.16f), cb[i].r + 0.03f * rnd());
            cb[i].v = v3(0, 0, 0);
        }
        c_t = 0;
    }
    int steps = 0;
    while (c_t < st && steps++ < 1200) {
        V3 g = vmul(carousel_g(c_t), 1.4f);
        for (int i = 0; i < CN; i++) {
            cb[i].v = vadd(cb[i].v, vmul(g, SIM_DT));
            cb[i].p = vadd(cb[i].p, vmul(cb[i].v, SIM_DT));
            float r = cb[i].r;
            float *P = &cb[i].p.x, *Vv = &cb[i].v.x, H[3] = {hi.x, hi.y, hi.z};
            for (int a = 0; a < 3; a++) {
                int hit = 0;
                if (P[a] < r) { P[a] = r; if (Vv[a] < 0) Vv[a] *= -0.25f; hit = 1; }
                if (P[a] > H[a] - r) { P[a] = H[a] - r; if (Vv[a] > 0) Vv[a] *= -0.25f; hit = 1; }
                if (hit)   // friction on the other two axes while in contact
                    for (int b = 0; b < 3; b++) if (b != a) Vv[b] *= 1.0f - 2.5f * SIM_DT;
            }
        }
        for (int i = 0; i < CN; i++)
            for (int j = i + 1; j < CN; j++) {
                V3 d = vsub(cb[j].p, cb[i].p);
                float dist = vlen(d), m = cb[i].r + cb[j].r;
                if (dist < m && dist > 1e-6f) {
                    V3 n = vmul(d, 1 / dist);
                    float push = (m - dist) * 0.5f;
                    cb[i].p = vsub(cb[i].p, vmul(n, push));
                    cb[j].p = vadd(cb[j].p, vmul(n, push));
                    float vr = vdot(vsub(cb[j].v, cb[i].v), n);
                    if (vr < 0) {
                        V3 imp = vmul(n, -vr * 0.6f);
                        cb[i].v = vsub(cb[i].v, imp);
                        cb[j].v = vadd(cb[j].v, imp);
                    }
                }
            }
        // settle: no creeping or jitter once nearly still
        for (int i = 0; i < CN; i++) if (vlen(cb[i].v) < 0.004f) cb[i].v = v3(0, 0, 0);
        c_t += SIM_DT;
    }
    float u[CN * 4];
    for (int i = 0; i < CN; i++) {
        u[i * 4] = cb[i].p.x; u[i * 4 + 1] = cb[i].p.y; u[i * 4 + 2] = cb[i].p.z;
        u[i * 4 + 3] = cb[i].box ? -cb[i].r : cb[i].r;   // negative radius: a block
    }
    set4(prog, "u_obj", u, CN);
    set3(prog, "u_grav", carousel_g(st));
}

// ------------------------------------------------------------ portal juggle (2.24)
// Three portals, one per face. A ball comes out of one, arcs through the air
// and drops into the next; it comes out of the linked portal and so on.
// Closed-form ballistic arcs solved to land in the portal: no misses.
static V3 jportal(int i, float mask, float maskd) {
    if (i == 0) return v3(0.62f * maskd, 0.58f * mask, 0);      // left wall
    if (i == 1) return v3(0, 0.50f * mask, 0.50f * mask);       // ceiling
    return v3(0.62f * maskd, 0, 0.58f * mask);                   // right wall
}
#define JN 4
#define JT 1.25f   // flight time of one hop
#define JG 0.55f
static void juggle_update(GLuint prog, float st) {
    float mask, maskd;
    sim_mask(prog, &mask, &maskd);
    // hops: left -> ceiling, (out of) right -> left, (out of) ceiling -> right
    static const int from[3] = {0, 2, 1}, to[3] = {1, 0, 2};
    float u[JN * 4], flash[4] = {0, 0, 0, 0};
    for (int k = 0; k < JN; k++) {
        float start = 0.8f + k * 2.0f;                    // balls join on the beat
        float t = st - start;
        u[k * 4] = u[k * 4 + 1] = u[k * 4 + 2] = 0; u[k * 4 + 3] = -1;
        if (t < 0) continue;
        int hop = (int)floorf(t / JT);
        float s = t - hop * JT;
        float last = 17.5f - start;                       // drop out on the last bars
        if (hop * JT > last) continue;
        int h = (hop + k) % 3;
        V3 A = jportal(from[h], mask, maskd), B = jportal(to[h], mask, maskd);
        V3 g = v3(JG, 0, 0);
        V3 v0 = vmul(vsub(vsub(B, A), vmul(g, 0.5f * JT * JT)), 1 / JT);
        V3 p = vadd(vadd(A, vmul(v0, s)), vmul(g, 0.5f * s * s));
        u[k * 4] = p.x; u[k * 4 + 1] = p.y; u[k * 4 + 2] = p.z; u[k * 4 + 3] = 1;
        // contact cue: a portal flashes as a ball leaves or enters it
        flash[from[h]] = fmaxf(flash[from[h]], expf(-s * 6));
        flash[to[h]] = fmaxf(flash[to[h]], expf(-(JT - s) * 6));
    }
    set4(prog, "u_obj", u, JN);
    GLint loc = glGetUniformLocation(prog, "u_flash");
    if (loc >= 0) glUniform3f(loc, flash[0], flash[1], flash[2]);
    float pp[12];
    for (int i = 0; i < 3; i++) { V3 q = jportal(i, mask, maskd); pp[i * 4] = q.x; pp[i * 4 + 1] = q.y; pp[i * 4 + 2] = q.z; pp[i * 4 + 3] = 0; }
    set4(prog, "u_portal", pp, 3);
}

// ------------------------------------------------------------ three-wall breakout (2.26)
// Bricks on all three faces; a ball bounces between the faces, aimed at a
// remaining brick each time; a hit brick shatters into falling shards.
// Brick state goes to the shader as a small texture (unit 5): 255 = intact,
// otherwise time since the hit in 10 ms steps (capped at 254).
#define BK_A 5    // bricks along each seam
#define BK_D 3    // bricks down each wall
#define BK_N (BK_A * BK_D * 2 + BK_A * BK_A)
#define SH_N 6
static float bk_hit[BK_N];
static struct { V3 p, v; float age; } shard[SH_N];
static V3 bo_p, bo_v;
static float bo_t = -1, bo_hits[4][4];
static int bo_face, bo_target;
static GLuint bk_tex;
static unsigned char bk_tex_data[BK_A * 3 * BK_A];

// brick k: face 0 left wall (z=0), 1 right wall (y=0), 2 ceiling (x=0); centre on the face
static V3 brick_centre(int k, float mask, float maskd, int *face) {
    float ca = mask / BK_A, cd = maskd / BK_D;
    if (k < BK_A * BK_D) { *face = 0; int a = k % BK_A, d = k / BK_A; return v3((d + 0.5f) * cd, (a + 0.5f) * ca, 0); }
    k -= BK_A * BK_D;
    if (k < BK_A * BK_D) { *face = 1; int a = k % BK_A, d = k / BK_A; return v3((d + 0.5f) * cd, 0, (a + 0.5f) * ca); }
    k -= BK_A * BK_D;
    *face = 2;
    int a = k % BK_A, b = k / BK_A;
    return v3(0, (a + 0.5f) * ca, (b + 0.5f) * ca);
}

static void breakout_pick(float mask, float maskd) {
    int cand[BK_N], nc = 0, face;
    for (int k = 0; k < BK_N; k++) {
        brick_centre(k, mask, maskd, &face);
        if (bk_hit[k] < 0 && face != bo_face) cand[nc++] = k;
    }
    if (!nc) { bo_target = -1; return; }
    bo_target = cand[(int)(rnd() * nc) % nc];
    V3 c = brick_centre(bo_target, mask, maskd, &face);
    // aim at the brick, arriving 2.5 cm in front of it (the ball's radius)
    V3 n = face == 0 ? v3(0, 0, 1) : face == 1 ? v3(0, 1, 0) : v3(1, 0, 0);
    V3 aim = vadd(c, vmul(n, 0.025f));
    bo_v = vmul(vnorm(vsub(aim, bo_p)), 0.95f);
}

static void breakout_update(GLuint prog, float st) {
    float mask, maskd;
    sim_mask(prog, &mask, &maskd);
    if (!bk_tex) {
        glGenTextures(1, &bk_tex);
        glActiveTexture(GL_TEXTURE5);
        glBindTexture(GL_TEXTURE_2D, bk_tex);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_LUMINANCE, BK_A * 3, BK_A, 0, GL_LUMINANCE, GL_UNSIGNED_BYTE, NULL);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        glActiveTexture(GL_TEXTURE0);
    }
    if (st < bo_t || bo_t < 0) {
        sim_seed = 7;
        for (int k = 0; k < BK_N; k++) bk_hit[k] = -1;
        for (int i = 0; i < SH_N; i++) shard[i].age = 99;
        memset(bo_hits, 0, sizeof bo_hits);
        for (int i = 0; i < 4; i++) bo_hits[i][3] = 99;
        bo_p = v3(maskd * 0.5f, mask * 0.5f, mask * 0.5f);
        bo_face = -1;
        breakout_pick(mask, maskd);
        bo_t = 0;
    }
    int steps = 0;
    while (bo_t < st && steps++ < 1200) {
        bo_t += SIM_DT;
        for (int i = 0; i < SH_N; i++) {
            if (shard[i].age > 3) continue;
            shard[i].age += SIM_DT;
            shard[i].v.x += 1.2f * SIM_DT;   // shards fall
            shard[i].p = vadd(shard[i].p, vmul(shard[i].v, SIM_DT));
        }
        for (int i = 0; i < 4; i++) bo_hits[i][3] += SIM_DT;
        if (bo_t < 1.0f || bo_t > 21.0f || bo_target < 0) continue;   // still at the start, or rebuilding
        bo_p = vadd(bo_p, vmul(bo_v, SIM_DT));
        int face;
        V3 c = brick_centre(bo_target, mask, maskd, &face);
        float h = face == 0 ? bo_p.z : face == 1 ? bo_p.y : bo_p.x;
        if (h <= 0.025f) {
            // hit: the brick shatters, the ball bounces off toward another brick
            bk_hit[bo_target] = bo_t;
            for (int i = 0, made = 0; i < SH_N && made < 3; i++) {
                if (shard[i].age < 1.6f) continue;
                V3 n = face == 0 ? v3(0, 0, 1) : face == 1 ? v3(0, 1, 0) : v3(1, 0, 0);
                shard[i].p = vadd(c, v3((rnd() - 0.5f) * 0.05f, (rnd() - 0.5f) * 0.05f, (rnd() - 0.5f) * 0.05f));
                if (face == 0) shard[i].p.z = 0.01f; else if (face == 1) shard[i].p.y = 0.01f; else shard[i].p.x = 0.01f;
                shard[i].v = vadd(vmul(n, 0.15f + 0.2f * rnd()), v3((rnd() - 0.5f) * 0.2f, (rnd() - 0.5f) * 0.2f, (rnd() - 0.5f) * 0.2f));
                shard[i].age = 0;
                made++;
            }
            memmove(bo_hits[1], bo_hits[0], sizeof(float) * 12);
            bo_hits[0][0] = c.x; bo_hits[0][1] = c.y; bo_hits[0][2] = c.z; bo_hits[0][3] = 0;
            bo_face = face;
            breakout_pick(mask, maskd);
        }
    }
    // brick texture: row b, columns (face * BK_A + a)
    for (int k = 0; k < BK_N; k++) {
        int face; V3 c = brick_centre(k, mask, maskd, &face);
        int a, b;
        float ca = mask / BK_A, cd = maskd / BK_D;
        if (face == 0) { a = (int)(c.y / ca); b = (int)(c.x / cd); }
        else if (face == 1) { a = (int)(c.z / ca); b = (int)(c.x / cd); }
        else { a = (int)(c.y / ca); b = (int)(c.z / ca); }
        float age = bk_hit[k] < 0 ? -1 : st - bk_hit[k];
        bk_tex_data[b * BK_A * 3 + face * BK_A + a] = age < 0 ? 255 : (unsigned char)fminf(254, age * 100);
    }
    glActiveTexture(GL_TEXTURE5);
    glBindTexture(GL_TEXTURE_2D, bk_tex);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, BK_A * 3, BK_A, GL_LUMINANCE, GL_UNSIGNED_BYTE, bk_tex_data);
    glActiveTexture(GL_TEXTURE0);
    GLint ls = glGetUniformLocation(prog, "u_bricks");
    if (ls >= 0) glUniform1i(ls, 5);
    float sh[SH_N * 4];
    for (int i = 0; i < SH_N; i++) {
        sh[i * 4] = shard[i].p.x; sh[i * 4 + 1] = shard[i].p.y; sh[i * 4 + 2] = shard[i].p.z;
        sh[i * 4 + 3] = shard[i].age < 1.6f ? shard[i].age : -1;
    }
    set4(prog, "u_shard", sh, SH_N);
    set4(prog, "u_hit", &bo_hits[0][0], 4);
    float ball[4] = {bo_p.x, bo_p.y, bo_p.z, (st > 1.0f && st < 21.0f) ? 1.0f : 0.0f};
    set4(prog, "u_obj", ball, 1);
}

// ------------------------------------------------------------ corner marble run (2.25)
// A marble drops from the ceiling onto a ramp on the left wall, zigzags down,
// jumps the seam onto the right wall, rolls into a funnel at the vertical
// seam, spirals down a clear tube around it and drops out. The track builds
// itself first. Marbles follow a precomputed path (speed from gravity).
// Track, in wall coordinates (a along from the corner, d down), times mask/maskd:
static const float MR_RAMPS[4][5] = {
    // face (0 left, 1 right), a0, d0, a1, d1
    {0, 0.30f, 0.16f, 0.85f, 0.30f},
    {0, 0.80f, 0.42f, 0.16f, 0.55f},
    {1, 0.14f, 0.60f, 0.70f, 0.70f},
    {1, 0.75f, 0.80f, 0.25f, 0.88f},
};
#define MR_R 0.014f      // marble radius
#define MR_TUBE 0.07f    // tube axis distance from the seam (y = z = TUBE)

static V3 wallpt(int face, float a, float d, float out) {
    return face == 0 ? v3(d, a, out) : v3(d, out, a);
}

// marble position at time u since it was released; *alive = 0 once gone
static V3 marble_at(float u, float mask, float maskd, int *alive) {
    *alive = 1;
    const float g = 0.7f, roll = 0.16f;
    // drop from the ceiling onto ramp 0's start
    V3 r0a = wallpt(0, MR_RAMPS[0][1] * mask, MR_RAMPS[0][2] * maskd - MR_R, MR_R + 0.004f);
    float tdrop = sqrtf(2 * r0a.x / g);
    if (u < tdrop) return v3(0.5f * g * u * u, r0a.y, r0a.z);
    u -= tdrop;
    for (int i = 0; i < 4; i++) {
        int f = (int)MR_RAMPS[i][0];
        V3 A = wallpt(f, MR_RAMPS[i][1] * mask, MR_RAMPS[i][2] * maskd - MR_R, MR_R + 0.004f);
        V3 B = wallpt(f, MR_RAMPS[i][3] * mask, MR_RAMPS[i][4] * maskd - MR_R, MR_R + 0.004f);
        float len = vlen(vsub(B, A)), tr = len / roll;
        if (u < tr) return vlerp(A, B, u / tr);
        u -= tr;
        // to the next piece: a short arc (with the seam jump between ramps 1 and 2)
        V3 C;
        if (i < 3) {
            int f2 = (int)MR_RAMPS[i + 1][0];
            C = wallpt(f2, MR_RAMPS[i + 1][1] * mask, MR_RAMPS[i + 1][2] * maskd - MR_R, MR_R + 0.004f);
        } else {
            C = v3(B.x + 0.02f, MR_TUBE + 0.03f, MR_TUBE + 0.03f);   // into the funnel
        }
        float ta = i == 1 ? 0.55f : 0.35f;
        if (u < ta) {
            float k = u / ta;
            V3 p = vlerp(B, C, k);
            p.x -= (i == 1 ? 0.06f : 0.015f) * 4 * k * (1 - k);        // a hop (x up is negative)
            if (i == 1) { p.y += 0.06f * 4 * k * (1 - k); p.z += 0.06f * 4 * k * (1 - k); }   // around the corner, out in front
            return p;
        }
        u -= ta;
    }
    // funnel and helix: spiral around the tube axis down to the bottom
    float x0 = MR_RAMPS[3][4] * maskd - MR_R + 0.02f, x1 = maskd * 1.05f;
    float th = 2.4f;   // seconds in the spiral
    if (u < th) {
        float k = u / th;
        float rad = (k < 0.25f ? 0.045f - 0.1f * k : 0.02f);
        float ang = 0.785f + k * 6.2832f * 3.0f;
        float x = x0 + (x1 - x0) * k * k;
        return v3(x, MR_TUBE + rad * cosf(ang), MR_TUBE + rad * sinf(ang));
    }
    *alive = 0;
    return v3(-1, 0, 0);
}

static void marble_update(GLuint prog, float st) {
    float mask, maskd;
    sim_mask(prog, &mask, &maskd);
    float u[4 * 4];
    for (int k = 0; k < 4; k++) {
        float rel = st - (4.0f + k * 5.5f);   // the track builds for 4 s, then marbles every 5.5 s
        int alive = 0;
        V3 p = rel >= 0 && st < 28.0f ? marble_at(rel, mask, maskd, &alive) : v3(-1, 0, 0);
        u[k * 4] = p.x; u[k * 4 + 1] = p.y; u[k * 4 + 2] = p.z; u[k * 4 + 3] = alive ? 1.0f : -1.0f;
    }
    set4(prog, "u_obj", u, 4);
    float r[16];
    for (int i = 0; i < 4; i++) {
        r[i * 4] = MR_RAMPS[i][1] * mask * (MR_RAMPS[i][0] > 0.5f ? -1 : 1);   // sign carries the face
        r[i * 4 + 1] = MR_RAMPS[i][2] * maskd;
        r[i * 4 + 2] = MR_RAMPS[i][3] * mask;
        r[i * 4 + 3] = MR_RAMPS[i][4] * maskd;
    }
    set4(prog, "u_ramp", r, 4);
}

// ------------------------------------------------------------ corner crawlers (2.27)
// Small geometric bugs walk loops that cross the seams constantly, so they
// wrap from wall to wall and onto the ceiling. One drops on a thread.
#define CRN 6
// a loop of waypoints on the surfaces, in fractions of (maskd, mask, mask)
static const float CR_LOOP[6][3] = {
    {0.55f, 0.55f, 0.0f},   // left wall
    {0.30f, 0.0f, 0.0f},    // the vertical seam
    {0.45f, 0.0f, 0.50f},   // right wall
    {0.0f, 0.0f, 0.45f},    // right seam onto the ceiling
    {0.0f, 0.50f, 0.30f},   // ceiling
    {0.0f, 0.55f, 0.0f},    // left seam, back down the left wall
};
static V3 cr_point(int i, float s, float mask, float maskd) {
    // each crawler's loop is scaled and shifted a little so they spread out
    float sc = 0.75f + 0.25f * s;
    const float *w = CR_LOOP[i % 6];
    return v3(w[0] * maskd * sc + (w[0] > 0 ? 0.03f * s : 0), w[1] * mask * sc + (w[1] > 0 ? 0.04f * (1 - s) : 0), w[2] * mask * sc + (w[2] > 0 ? 0.04f * s : 0));
}
static V3 face_normal(V3 p) {
    // the face a point lies on (smallest coordinate)
    if (p.x <= p.y && p.x <= p.z) return v3(1, 0, 0);
    if (p.y <= p.z) return v3(0, 1, 0);
    return v3(0, 0, 1);
}

static void crawlers_update(GLuint prog, float st) {
    float mask, maskd;
    sim_mask(prog, &mask, &maskd);
    float pos[CRN * 4], hd[CRN * 4];
    V3 thread_anchor = v3(0, 0.30f * mask, 0.62f * mask);
    float thread = -1;
    int inAir = 0;
    for (int c = 0; c < CRN; c++) {
        float s = c / (float)(CRN - 1);
        float speed = 0.055f + 0.02f * s;
        int dir = c % 2 ? 1 : -1;
        // length of this crawler's loop
        float L = 0, seg[6];
        for (int i = 0; i < 6; i++) { seg[i] = vlen(vsub(cr_point(i + 1, s, mask, maskd), cr_point(i, s, mask, maskd))); L += seg[i]; }
        float d = fmodf(st * speed + s * L * 0.9f, L);
        if (dir < 0) d = L - d;
        int i = 0;
        while (i < 5 && d > seg[i]) { d -= seg[i]; i++; }
        V3 A = cr_point(i, s, mask, maskd), B = cr_point(i + 1, s, mask, maskd);
        V3 p = vlerp(A, B, d / fmaxf(seg[i], 1e-5f));
        V3 h = vnorm(vmul(vsub(B, A), (float)dir));
        V3 n = face_normal(p);
        // near a seam the body bends round it: blend the heading's normal part away
        h = vnorm(vsub(h, vmul(n, vdot(h, n))));
        float phase = st * 9.0f + c;
        // crawler 0 drops from the ceiling on a thread and swings, every 20 s
        if (c == 0) {
            float k = fmodf(st, 20.0f);
            if (k > 6.0f && k < 14.0f) {
                float drop = sstep(6.0f, 8.0f, k) * 0.22f;
                float sw = 0.35f * sinf((k - 6.0f) * 2.2f) * sstep(7.0f, 8.5f, k);
                p = v3(thread_anchor.x + drop * cosf(sw), thread_anchor.y - drop * sinf(sw) * 0.7f, thread_anchor.z - drop * sinf(sw) * 0.7f);
                if (k > 12.5f) {   // lands on the left wall
                    float l = sstep(12.5f, 14.0f, k);
                    p = vlerp(p, v3(p.x, p.y, 0.003f), l);
                }
                h = v3(1, 0, 0);
                n = vnorm(vsub(v3(p.x, p.y, p.z + 1), p));
                thread = 1;
                inAir = 1;
            }
        }
        pos[c * 4] = p.x; pos[c * 4 + 1] = p.y; pos[c * 4 + 2] = p.z;
        // w: leg phase; negative while hanging in the air (crawler 0 on its thread)
        pos[c * 4 + 3] = (c == 0 && inAir) ? -1.0f - fmodf(phase, 100.0f) : fmodf(phase, 100.0f);
        hd[c * 4] = h.x; hd[c * 4 + 1] = h.y; hd[c * 4 + 2] = h.z; hd[c * 4 + 3] = 0.6f + 0.4f * s;   // size
    }
    set4(prog, "u_obj", pos, CRN);
    set4(prog, "u_head", hd, CRN);
    float th[4] = {thread_anchor.x, thread_anchor.y, thread_anchor.z, thread};
    set4(prog, "u_thread", th, 1);
}

// ------------------------------------------------------------ dispatch
static void sims_update(const char *name, GLuint prog, float st) {
    if (!strcmp(name, "balls")) balls_update(prog, st);
    else if (!strcmp(name, "carousel")) carousel_update(prog, st);
    else if (!strcmp(name, "juggle")) juggle_update(prog, st);
    else if (!strcmp(name, "breakout")) breakout_update(prog, st);
    else if (!strcmp(name, "marble")) marble_update(prog, st);
    else if (!strcmp(name, "crawlers")) crawlers_update(prog, st);
}
