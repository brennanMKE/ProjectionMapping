// skyd: real-time, viewer-correct night sky for a projector on a Raspberry Pi.
//
// Draws straight to HDMI with KMS/DRM + GBM + EGL + OpenGL ES 2.0 (no desktop,
// no mpv). A mesh maps every projector pixel to the viewer's (webcam's) image
// coordinates, measured with structured light (corner/structured-light/
// planefit.py). The fragment shader computes the sky at those viewer
// coordinates, so from the viewer's position the picture looks flat and
// undistorted even though it lands on two walls and the ceiling.
//
#define _GNU_SOURCE
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES2/gl2.h>
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <gbm.h>
#include <math.h>
#include <netinet/in.h>
#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#include <xf86drm.h>
#include <xf86drmMode.h>

static int drm_fd;
static drmModeModeInfo mode;
static uint32_t crtc_id, conn_id;
static struct gbm_device *gbm;
static struct gbm_surface *gsurf;
static EGLDisplay dpy;
static EGLSurface esurf;
static volatile sig_atomic_t running = 1;

static void die(const char *m) { perror(m); exit(1); }
static void on_signal(int s) { (void)s; running = 0; }

static double now(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec + ts.tv_nsec / 1e9;
}

// ---------------------------------------------------------------- KMS

static void init_drm(int want_w, int want_h) {
    const char *cards[] = {"/dev/dri/card0", "/dev/dri/card1", "/dev/dri/card2"};
    drmModeRes *res = NULL;
    drmModeConnector *conn = NULL;
    for (int c = 0; c < 3 && !conn; c++) {
        drm_fd = open(cards[c], O_RDWR | O_CLOEXEC);
        if (drm_fd < 0) continue;
        res = drmModeGetResources(drm_fd);
        if (!res) { close(drm_fd); continue; }
        for (int i = 0; i < res->count_connectors; i++) {
            drmModeConnector *k = drmModeGetConnector(drm_fd, res->connectors[i]);
            if (k && k->connection == DRM_MODE_CONNECTED && k->count_modes > 0) { conn = k; break; }
            drmModeFreeConnector(k);
        }
        if (!conn) { drmModeFreeResources(res); close(drm_fd); }
    }
    if (!conn) { fprintf(stderr, "no connected display\n"); exit(1); }
    conn_id = conn->connector_id;
    mode = conn->modes[0];
    for (int i = 0; i < conn->count_modes; i++) {
        drmModeModeInfo *m = &conn->modes[i];
        if (m->hdisplay == want_w && m->vdisplay == want_h && m->vrefresh == 60) { mode = *m; break; }
        if (m->hdisplay == want_w && m->vdisplay == want_h) mode = *m;
    }
    drmModeEncoder *enc = conn->encoder_id ? drmModeGetEncoder(drm_fd, conn->encoder_id) : NULL;
    if (enc && enc->crtc_id) crtc_id = enc->crtc_id;
    else {
        for (int e = 0; e < conn->count_encoders && !crtc_id; e++) {
            drmModeEncoder *en = drmModeGetEncoder(drm_fd, conn->encoders[e]);
            for (int c = 0; c < res->count_crtcs; c++)
                if (en && (en->possible_crtcs & (1 << c))) { crtc_id = res->crtcs[c]; break; }
            drmModeFreeEncoder(en);
        }
    }
    if (!crtc_id) { fprintf(stderr, "no crtc\n"); exit(1); }
    fprintf(stderr, "skyd: display %dx%d@%d\n", mode.hdisplay, mode.vdisplay, mode.vrefresh);
}

static void init_egl(void) {
    gbm = gbm_create_device(drm_fd);
    gsurf = gbm_surface_create(gbm, mode.hdisplay, mode.vdisplay, GBM_FORMAT_XRGB8888,
                               GBM_BO_USE_SCANOUT | GBM_BO_USE_RENDERING);
    if (!gsurf) die("gbm_surface_create");
    PFNEGLGETPLATFORMDISPLAYEXTPROC getdpy = (void *)eglGetProcAddress("eglGetPlatformDisplayEXT");
    dpy = getdpy ? getdpy(EGL_PLATFORM_GBM_KHR, gbm, NULL) : eglGetDisplay((EGLNativeDisplayType)gbm);
    if (!eglInitialize(dpy, NULL, NULL)) die("eglInitialize");
    eglBindAPI(EGL_OPENGL_ES_API);
    EGLint attr[] = {EGL_SURFACE_TYPE, EGL_WINDOW_BIT, EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8,
                     EGL_ALPHA_SIZE, 0, EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT, EGL_NONE};
    EGLConfig cfgs[64];
    EGLint n = 0;
    eglChooseConfig(dpy, attr, cfgs, 64, &n);
    EGLConfig cfg = NULL;
    for (int i = 0; i < n; i++) {
        EGLint id;
        eglGetConfigAttrib(dpy, cfgs[i], EGL_NATIVE_VISUAL_ID, &id);
        if (id == GBM_FORMAT_XRGB8888) { cfg = cfgs[i]; break; }
    }
    if (!cfg) { fprintf(stderr, "no XRGB8888 EGL config\n"); exit(1); }
    EGLint cattr[] = {EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};
    EGLContext ctx = eglCreateContext(dpy, cfg, EGL_NO_CONTEXT, cattr);
    esurf = eglCreateWindowSurface(dpy, cfg, (EGLNativeWindowType)gsurf, NULL);
    if (!ctx || esurf == EGL_NO_SURFACE) die("egl context/surface");
    eglMakeCurrent(dpy, esurf, esurf, ctx);
    eglSwapInterval(dpy, 1);
}

static void fb_destroy(struct gbm_bo *bo, void *data) {
    uint32_t fb = (uint32_t)(uintptr_t)data;
    if (fb) drmModeRmFB(drm_fd, fb);
    (void)bo;
}

static uint32_t bo_fb(struct gbm_bo *bo) {
    uint32_t fb = (uint32_t)(uintptr_t)gbm_bo_get_user_data(bo);
    if (fb) return fb;
    uint32_t handle = gbm_bo_get_handle(bo).u32, stride = gbm_bo_get_stride(bo);
    if (drmModeAddFB(drm_fd, gbm_bo_get_width(bo), gbm_bo_get_height(bo), 24, 32, stride, handle, &fb))
        die("drmModeAddFB");
    gbm_bo_set_user_data(bo, (void *)(uintptr_t)fb, fb_destroy);
    return fb;
}

static void flip_done(int fd, unsigned f, unsigned s, unsigned us, void *data) {
    (void)fd; (void)f; (void)s; (void)us;
    *(int *)data = 0;
}

// ---------------------------------------------------------------- GL

static GLuint compile(GLenum type, const char *src) {
    GLuint s = glCreateShader(type);
    glShaderSource(s, 1, &src, NULL);
    glCompileShader(s);
    GLint ok;
    glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char log[4096];
        glGetShaderInfoLog(s, sizeof log, NULL, log);
        fprintf(stderr, "shader error:\n%s\n", log);
        exit(1);
    }
    return s;
}

static char *slurp(const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) die(path);
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *b = malloc(n + 1);
    if (fread(b, 1, n, f) != (size_t)n) die("read");
    b[n] = 0;
    fclose(f);
    return b;
}

static const char *VERT_DEFAULT =
    "attribute vec2 a_proj;\n"   // projector pixel
    "attribute vec2 a_cam;\n"    // viewer (camera) pixel
    "uniform vec2 u_res;\n"
    "varying vec2 v_cam;\n"
    "void main() {\n"
    "  v_cam = a_cam;\n"
    "  vec2 ndc = a_proj / u_res * 2.0 - 1.0;\n"
    "  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);\n"
    "}\n";

// ---------------------------------------------------------------- scenes

typedef struct {
    char name[64];
    float seconds;   // duration in the demo loop
    float scale;     // render scale (0.5 = half resolution, then stretched)
    int loop;        // which demo loop it belongs to (1 or 2)
    GLuint prog;
    GLint u_res, u_time, u_rect, u_snow, u_speed, u_santa, u_fall, u_snowold, u_snowat;
} Scene;

#define MAXSCENES 32
static Scene scenes[MAXSCENES];
static int nscenes;

static void apply_uniform_file(GLuint prog, const char *path) {
    FILE *uf = fopen(path, "r");
    char line[512];
    while (uf && fgets(line, sizeof line, uf)) {
        char name[64];
        float v[9];
        int off = 0, n = 0, used;
        if (sscanf(line, "%63s%n", name, &off) != 1 || name[0] == '#') continue;
        char *q = line + off;
        while (n < 9 && sscanf(q, "%f%n", &v[n], &used) == 1) { q += used; n++; }
        GLint loc = glGetUniformLocation(prog, name);
        if (loc < 0) continue;
        if (n == 1) glUniform1f(loc, v[0]);
        else if (n == 2) glUniform2f(loc, v[0], v[1]);
        else if (n == 3) glUniform3f(loc, v[0], v[1], v[2]);
        else if (n == 4) glUniform4f(loc, v[0], v[1], v[2], v[3]);
        else if (n == 9) {
            float m[9] = {v[0], v[3], v[6], v[1], v[4], v[7], v[2], v[5], v[8]};
            glUniformMatrix3fv(loc, 1, GL_FALSE, m);
        }
    }
    if (uf) fclose(uf);
}

static GLuint link_program(const char *vs, const char **fs, int nfs) {
    GLuint prog = glCreateProgram();
    glAttachShader(prog, compile(GL_VERTEX_SHADER, vs));
    GLuint f = glCreateShader(GL_FRAGMENT_SHADER);
    glShaderSource(f, nfs, fs, NULL);
    glCompileShader(f);
    GLint ok;
    glGetShaderiv(f, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char log[4096];
        glGetShaderInfoLog(f, sizeof log, NULL, log);
        fprintf(stderr, "fragment shader error:\n%s\n", log);
        return 0;
    }
    glAttachShader(prog, f);
    glBindAttribLocation(prog, 0, "a_proj");
    glBindAttribLocation(prog, 1, "a_cam");
    glLinkProgram(prog);
    glGetProgramiv(prog, GL_LINK_STATUS, &ok);
    if (!ok) {
        char log[4096];
        glGetProgramInfoLog(prog, sizeof log, NULL, log);
        fprintf(stderr, "link error:\n%s\n", log);
        return 0;
    }
    return prog;
}

// next scene in a demo mode after cur (-1: the first). 1/2: that loop,
// 8: all loops in order, 9: shuffle (any scene with a duration, not cur)
static int plist[MAXSCENES], nplist;   // "demo list a,b,c": a chosen playlist (mode 10)
static void set_playlist(const char *csv) {
    char buf[600];
    snprintf(buf, sizeof buf, "%s", csv);
    nplist = 0;
    for (char *t = strtok(buf, ", "); t && nplist < MAXSCENES; t = strtok(NULL, ", ")) {
        for (int k = 0; k < nscenes; k++)
            if (!strcmp(scenes[k].name, t)) { plist[nplist++] = k; break; }
    }
}
static int in_mode(int k, int mode) {
    return scenes[k].seconds > 0 && (mode >= 8 || scenes[k].loop == mode);
}
static int next_scene(int cur, int mode) {
    if (mode == 10) {
        if (!nplist) return -1;
        int at = -1;
        for (int i = 0; i < nplist; i++) if (plist[i] == cur) at = i;
        return plist[(at + 1) % nplist];
    }
    if (mode == 9) {
        int cand[MAXSCENES], nc = 0;
        for (int k = 0; k < nscenes; k++)
            if (in_mode(k, 9) && k != cur) cand[nc++] = k;
        return nc ? cand[rand() % nc] : -1;
    }
    for (int i = 1; i <= nscenes; i++) {
        int k = ((cur < 0 ? -1 : cur) + i + nscenes) % nscenes;
        if (in_mode(k, mode)) return k;
    }
    return -1;
}

// ---------------------------------------------------------------- balls physics
// The bouncing balls scene's state is the same for every pixel, so it is
// computed here once per frame (as the shader would, closed form) and passed
// as uniforms u_b0..u_b3 (centre xyz, squash w; x < -2 when not in play).
// Ledge positions must match ledgeBox() in common.glsl.
#define BG 0.6f
#define BE 0.55f
#define BR 0.034f
#define BV 0.10f
#define BP 6.0f
static float bhash(float x, float y) {   // same as hash() in common.glsl
    float px = x * 123.34f, py = y * 456.21f;
    px -= floorf(px); py -= floorf(py);
    float d = px * (px + 45.32f) + py * (py + 45.32f);
    px += d; py += d;
    float v = px * py;
    return v - floorf(v);
}
static float bbounce(float tau, float v, float *sq) {
    float v0 = v * BE, c = 2 * v0 / BG, x = 1 - tau * (1 - BE) / c;
    *sq = 0;
    if (x <= 0) return 0;
    float k = floorf(logf(x) / logf(BE));
    if (k > 7) return 0;
    float ek = powf(BE, k), u = tau - c * (1 - ek) / (1 - BE), vk = v0 * ek;
    *sq = 0.45f * ek * expf(-u * 28);
    float h = vk * u - 0.5f * BG * u * u;
    return h > 0 ? h : 0;
}
static void balls_update(GLuint prog, float time) {
    static GLint lm = -2, ld;
    float mask = 0.6f, maskd = 0.4f;
    if (lm == -2) { lm = glGetUniformLocation(prog, "u_mask"); ld = glGetUniformLocation(prog, "u_maskd"); }
    if (lm >= 0) glGetUniformfv(prog, lm, &mask);
    if (ld >= 0) glGetUniformfv(prog, ld, &maskd);
    for (int i = 0; i < 4; i++) {
        float out[4] = {-5, 0, 0, 0};
        float tt = time - i * 1.5f;
        if (tt >= 0) {
            float cyc = floorf(tt / BP), tau = fmodf(tt, BP), jit = bhash(cyc, (float)i);
            int path = (int)fmodf(cyc + i, 2);
            // ledges (top x, along start/end): 0 left high, 1 right mid, 2 left low
            float top1 = path == 0 ? 0.50f * maskd : 0.62f * maskd;
            float end1 = path == 0 ? 0.30f * mask : 0.08f * mask;
            float top2 = 0.86f * maskd, end2 = 0.04f * mask;
            float a0 = path == 0 ? (0.62f + 0.16f * jit) * mask : (0.42f + 0.14f * jit) * mask;
            float a = a0 - BV * tau, xa = top1 - BR, x0 = -BR, sq = 0, x;
            float tf1 = sqrtf(2 * (xa - x0) / BG), tl1 = (a0 - end1) / BV;
            if (tau < tf1) x = x0 + 0.5f * BG * tau * tau;
            else if (tau < tl1) x = xa - bbounce(tau - tf1, BG * tf1, &sq);
            else {
                float u = tau - tl1, xb = top2 - BR;
                x = xa + 0.5f * BG * u * u;
                if (path == 0 && x > xb) {
                    float tf2 = sqrtf(2 * (xb - xa) / BG), tl2 = tl1 + (end1 - end2) / BV;
                    if (tau < tl2) x = xb - bbounce(u - tf2, BG * tf2, &sq);
                    else { float w = tau - tl2; x = xb + 0.5f * BG * w * w; }
                }
            }
            out[0] = x; out[3] = sq;
            if (path == 0) { out[1] = a; out[2] = BR + 0.001f; }
            else { out[1] = BR + 0.001f; out[2] = a; }
        }
        char nm[8];
        snprintf(nm, sizeof nm, "u_b%d", i);
        GLint loc = glGetUniformLocation(prog, nm);
        if (loc >= 0) glUniform4f(loc, out[0], out[1], out[2], out[3]);
    }
}

// ---------------------------------------------------------------- video
// "video <audio 0|1> <loop 0|1> <path>": ffmpeg decodes the file in real time
// (-re) to 640x360 yuv420p on a pipe, and plays its audio over HDMI. Each
// complete frame is uploaded to three luminance textures on units 2, 3, 4
// (Y, U, V) for the video scene (u_vy, u_vu, u_vv).
#define VW 640
#define VH 360
#define VFS (VW * VH * 3 / 2)
static pid_t vid_pid = -1;
static int vid_fd = -1, vid_frames, vid_ended, vid_paused;
// a reader thread pulls whole frames off the pipe as fast as the decoder makes
// them (so the decoder, and with it the audio, never waits on the renderer);
// the render loop uploads the newest complete frame
static unsigned char vid_back[VFS], vid_buf[VFS];
static pthread_t vid_thr;
static int vid_thr_on, vid_ready, vid_eof;
static pthread_mutex_t vid_mu = PTHREAD_MUTEX_INITIALIZER;

static void *video_reader(void *arg) {
    int fd = (int)(intptr_t)arg;
    for (;;) {
        size_t have = 0;
        while (have < VFS) {
            ssize_t r = read(fd, vid_back + have, VFS - have);
            if (r <= 0) {
                if (r < 0 && errno == EINTR) continue;
                pthread_mutex_lock(&vid_mu);
                vid_eof = 1;
                pthread_mutex_unlock(&vid_mu);
                return NULL;
            }
            have += r;
        }
        pthread_mutex_lock(&vid_mu);
        memcpy(vid_buf, vid_back, VFS);
        vid_ready = 1;
        pthread_mutex_unlock(&vid_mu);
    }
}
static GLuint vtex[3];
static double vid_t0 = -1, vid_end_t = -1;
static int vid_return = -1, vid_return_demo;   // what to go back to when it ends

static void video_stop(void) {
    if (vid_pid > 0) {
        // never block the renderer on the decoder: ask, then insist
        kill(vid_pid, SIGCONT);
        kill(vid_pid, SIGTERM);
        int done = 0;
        for (int i = 0; i < 20 && !done; i++) {
            done = waitpid(vid_pid, NULL, WNOHANG) != 0;
            if (!done) usleep(10000);
        }
        if (!done) { kill(vid_pid, SIGKILL); waitpid(vid_pid, NULL, 0); }
    }
    vid_pid = -1;
    if (vid_thr_on) { pthread_join(vid_thr, NULL); vid_thr_on = 0; }   // the decoder is gone: EOF
    if (vid_fd >= 0) close(vid_fd);
    vid_fd = -1;
    vid_ready = vid_eof = 0;
    vid_paused = 0;
}

static void video_start(const char *path, int audio, int loop) {
    video_stop();
    int fds[2];
    if (pipe(fds)) return;
    pid_t pid = fork();
    if (pid == 0) {
        prctl(PR_SET_PDEATHSIG, SIGTERM);   // don't outlive skyd
        dup2(fds[1], 1);
        close(fds[0]);
        close(fds[1]);
        int dn = open("/dev/null", O_RDONLY);
        if (dn >= 0) dup2(dn, 0);
        const char *a[48];
        int n = 0;
        a[n++] = "ffmpeg"; a[n++] = "-nostdin"; a[n++] = "-hide_banner"; a[n++] = "-loglevel"; a[n++] = "error";
        if (loop) { a[n++] = "-stream_loop"; a[n++] = "-1"; }
        a[n++] = "-re"; a[n++] = "-threads"; a[n++] = "2"; a[n++] = "-i"; a[n++] = path;
        a[n++] = "-map"; a[n++] = "0:v:0";
        a[n++] = "-vf"; a[n++] = "scale=640:360:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=640:360:(ow-iw)/2:(oh-ih)/2";
        a[n++] = "-pix_fmt"; a[n++] = "yuv420p"; a[n++] = "-f"; a[n++] = "rawvideo"; a[n++] = "pipe:1";
        if (audio) {
            a[n++] = "-map"; a[n++] = "0:a:0"; a[n++] = "-ac"; a[n++] = "2";
            a[n++] = "-f"; a[n++] = "alsa"; a[n++] = "default:CARD=vc4hdmi";
        }
        a[n] = NULL;
        execvp("ffmpeg", (char *const *)a);
        _exit(127);
    }
    close(fds[1]);
    if (pid < 0) { close(fds[0]); return; }
    vid_fd = fds[0];
    fcntl(vid_fd, F_SETPIPE_SZ, 1 << 20);   // room for a few frames
    vid_pid = pid;
    vid_ready = vid_eof = 0;
    vid_thr_on = pthread_create(&vid_thr, NULL, video_reader, (void *)(intptr_t)vid_fd) == 0;
    vid_t0 = now();
    vid_frames = 0;
    vid_ended = 0;
    fprintf(stderr, "skyd: video %s (audio %d, loop %d)\n", path, audio, loop);
}

static void video_upload(void) {
    glActiveTexture(GL_TEXTURE2);
    glBindTexture(GL_TEXTURE_2D, vtex[0]);
    glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, VW, VH, GL_LUMINANCE, GL_UNSIGNED_BYTE, vid_buf);
    glActiveTexture(GL_TEXTURE3);
    glBindTexture(GL_TEXTURE_2D, vtex[1]);
    glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, VW / 2, VH / 2, GL_LUMINANCE, GL_UNSIGNED_BYTE, vid_buf + VW * VH);
    glActiveTexture(GL_TEXTURE4);
    glBindTexture(GL_TEXTURE_2D, vtex[2]);
    glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, VW / 2, VH / 2, GL_LUMINANCE, GL_UNSIGNED_BYTE, vid_buf + VW * VH * 5 / 4);
    glActiveTexture(GL_TEXTURE0);
    vid_frames++;
}

// upload the newest complete frame; notice the end of the file
static void video_poll(void) {
    if (vid_fd < 0) return;
    pthread_mutex_lock(&vid_mu);
    int ready = vid_ready, eof = vid_eof;
    if (ready) { video_upload(); vid_ready = 0; }
    pthread_mutex_unlock(&vid_mu);
    if (eof && !ready) {
        video_stop();
        vid_ended = 1;
        vid_end_t = now();
        fprintf(stderr, "skyd: video ended\n");
    }
}

static void video_init(void) {
    glGenTextures(3, vtex);
    for (int i = 0; i < 3; i++) {
        int w = i ? VW / 2 : VW, h = i ? VH / 2 : VH;
        glActiveTexture(GL_TEXTURE2 + i);
        glBindTexture(GL_TEXTURE_2D, vtex[i]);
        unsigned char *z = malloc(w * h);
        memset(z, i ? 128 : 16, w * h);
        glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_LUMINANCE, w, h, 0, GL_LUMINANCE, GL_UNSIGNED_BYTE, z);
        free(z);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    }
    glActiveTexture(GL_TEXTURE0);
}

#include "sims.c"

static int find_scene(const char *name) {
    for (int i = 0; i < nscenes; i++)
        if (!strcmp(scenes[i].name, name)) return i;
    return -1;
}

// skyd <dir> <scenes>
//   dir:    mesh.bin, rect.json, uniforms.txt, sleigh.raw, common.glsl, <scene>.frag [.vert]
//   scenes: comma-separated name[:seconds[:scale]], in demo-loop order
// Control (UDP 127.0.0.1:8766): scene <name> | demo on|off | snow <0..1> |
//   speed <x> | santa | quit
int main(int argc, char **argv) {
    if (argc < 3) { fprintf(stderr, "usage: skyd <dir> <scene[:sec[:scale]],...>\n"); return 2; }
    srand((unsigned)time(NULL));
    signal(SIGINT, on_signal);
    signal(SIGTERM, on_signal);
    const char *dir = argv[1];
    char path[1024];

    // mesh
    snprintf(path, sizeof path, "%s/mesh.bin", dir);
    FILE *mf = fopen(path, "rb");
    if (!mf) die(path);
    int32_t cols, rows;
    if (fread(&cols, 4, 1, mf) != 1 || fread(&rows, 4, 1, mf) != 1) die("mesh header");
    float *verts = malloc(sizeof(float) * 4 * cols * rows);
    if (fread(verts, sizeof(float) * 4, cols * rows, mf) != (size_t)(cols * rows)) die("mesh data");
    fclose(mf);

    // window rect (camera px)
    snprintf(path, sizeof path, "%s/rect.json", dir);
    char *rj = slurp(path);
    float rx0 = 0, ry0 = 0, rx1 = 0, ry1 = 0;
    char *p;
    if ((p = strstr(rj, "\"x0\""))) sscanf(strchr(p, ':') + 1, "%f", &rx0);
    if ((p = strstr(rj, "\"y0\""))) sscanf(strchr(p, ':') + 1, "%f", &ry0);
    if ((p = strstr(rj, "\"x1\""))) sscanf(strchr(p, ':') + 1, "%f", &rx1);
    if ((p = strstr(rj, "\"y1\""))) sscanf(strchr(p, ':') + 1, "%f", &ry1);

    init_drm(1280, 720);
    init_egl();

    snprintf(path, sizeof path, "%s/common.glsl", dir);
    char *common = access(path, R_OK) == 0 ? slurp(path) : "";
    char uniforms_path[1024];
    snprintf(uniforms_path, sizeof uniforms_path, "%s/uniforms.txt", dir);

    // scenes
    char *list = strdup(argv[2]);
    for (char *tok = strtok(list, ","); tok && nscenes < MAXSCENES; tok = strtok(NULL, ",")) {
        Scene *s = &scenes[nscenes];
        memset(s, 0, sizeof *s);
        s->seconds = 20;
        s->scale = 1;
        s->loop = 1;
        char *c1 = strchr(tok, ':');
        if (c1) {
            *c1 = 0;
            s->seconds = atof(c1 + 1);
            char *c2 = strchr(c1 + 1, ':');
            if (c2) {
                s->scale = atof(c2 + 1);
                char *c3 = strchr(c2 + 1, ':');
                if (c3) s->loop = atoi(c3 + 1);
            }
        }
        snprintf(s->name, sizeof s->name, "%s", tok);
        snprintf(path, sizeof path, "%s/%s.frag", dir, s->name);
        if (access(path, R_OK) != 0) { fprintf(stderr, "skyd: no %s, skipping\n", path); continue; }
        char *frag = slurp(path);
        snprintf(path, sizeof path, "%s/%s.vert", dir, s->name);
        const char *vert = access(path, R_OK) == 0 ? slurp(path) : VERT_DEFAULT;
        const char *parts[2] = {common, frag};
        s->prog = strstr(frag, "@common") ? link_program(vert, parts, 2) : link_program(vert, parts + 1, 1);
        if (!s->prog) { fprintf(stderr, "skyd: scene %s failed to build\n", s->name); continue; }
        glUseProgram(s->prog);
        s->u_res = glGetUniformLocation(s->prog, "u_res");
        s->u_time = glGetUniformLocation(s->prog, "u_time");
        s->u_rect = glGetUniformLocation(s->prog, "u_rect");
        s->u_snow = glGetUniformLocation(s->prog, "u_snow");
        s->u_speed = glGetUniformLocation(s->prog, "u_speed");
        s->u_santa = glGetUniformLocation(s->prog, "u_santa");
        s->u_fall = glGetUniformLocation(s->prog, "u_fall");
        s->u_snowold = glGetUniformLocation(s->prog, "u_snowold");
        s->u_snowat = glGetUniformLocation(s->prog, "u_snowat");
        glUniform2f(s->u_res, mode.hdisplay, mode.vdisplay);
        glUniform4f(s->u_rect, rx0, ry0, rx1, ry1);
        glUniform1i(glGetUniformLocation(s->prog, "u_sprite"), 0);
        glUniform1i(glGetUniformLocation(s->prog, "u_vy"), 2);
        glUniform1i(glGetUniformLocation(s->prog, "u_vu"), 3);
        glUniform1i(glGetUniformLocation(s->prog, "u_vv"), 4);
        apply_uniform_file(s->prog, uniforms_path);
        fprintf(stderr, "skyd: scene %s (%.0f s, scale %.2f, loop %d)\n", s->name, s->seconds, s->scale, s->loop);
        nscenes++;
    }
    if (!nscenes) { fprintf(stderr, "skyd: no scenes\n"); return 1; }

    // sprite (sleigh): uint32 w, h, then w*h coverage bytes, on texture unit 0
    snprintf(path, sizeof path, "%s/sleigh.raw", dir);
    FILE *sf = fopen(path, "rb");
    uint32_t sw, sh;
    if (sf && fread(&sw, 4, 1, sf) == 1 && fread(&sh, 4, 1, sf) == 1) {
        unsigned char *px = malloc(sw * sh);
        if (fread(px, 1, sw * sh, sf) == sw * sh) {
            GLuint tex;
            glGenTextures(1, &tex);
            glActiveTexture(GL_TEXTURE0);
            glBindTexture(GL_TEXTURE_2D, tex);
            glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
            glTexImage2D(GL_TEXTURE_2D, 0, GL_LUMINANCE, sw, sh, 0, GL_LUMINANCE, GL_UNSIGNED_BYTE, px);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        }
        free(px);
    }
    if (sf) fclose(sf);

    // mesh buffers; GLES2 guarantees only 16-bit indices, so draw in row strips
    GLuint vbo;
    glGenBuffers(1, &vbo);
    glBindBuffer(GL_ARRAY_BUFFER, vbo);
    glBufferData(GL_ARRAY_BUFFER, sizeof(float) * 4 * cols * rows, verts, GL_STATIC_DRAW);
    int strip_rows = 65535 / cols - 1;
    if (strip_rows < 1) strip_rows = 1;
    int nstrips = (rows - 1 + strip_rows - 1) / strip_rows;
    GLuint *ibos = malloc(sizeof(GLuint) * nstrips);
    int *icounts = malloc(sizeof(int) * nstrips), *ibase = malloc(sizeof(int) * nstrips);
    glGenBuffers(nstrips, ibos);
    for (int s = 0; s < nstrips; s++) {
        int r0 = s * strip_rows, r1 = r0 + strip_rows;
        if (r1 > rows - 1) r1 = rows - 1;
        int n = (r1 - r0) * (cols - 1) * 6, q = 0;
        GLushort *ix = malloc(sizeof(GLushort) * n);
        for (int r = r0; r < r1; r++)
            for (int c = 0; c < cols - 1; c++) {
                GLushort a = (r - r0) * cols + c, b = a + 1, d = a + cols, e = d + 1;
                ix[q++] = a; ix[q++] = b; ix[q++] = d;
                ix[q++] = b; ix[q++] = e; ix[q++] = d;
            }
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ibos[s]);
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, sizeof(GLushort) * n, ix, GL_STATIC_DRAW);
        icounts[s] = n;
        ibase[s] = r0 * cols;
        free(ix);
    }

    video_init();
    signal(SIGPIPE, SIG_IGN);

    // half-size offscreen target for heavy scenes, plus blit and fade programs
    int hw = mode.hdisplay / 2, hh = mode.vdisplay / 2;
    GLuint fbo = 0, ftex = 0;
    glGenTextures(1, &ftex);
    glActiveTexture(GL_TEXTURE1);
    glBindTexture(GL_TEXTURE_2D, ftex);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, hw, hh, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glGenFramebuffers(1, &fbo);
    glBindFramebuffer(GL_FRAMEBUFFER, fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, ftex, 0);
    int have_fbo = glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE;
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    if (!have_fbo) fprintf(stderr, "skyd: offscreen buffer unsupported; all scenes at full size\n");
    const char *qv = "attribute vec2 a_proj; varying vec2 v_t;\n"
                     "void main(){ v_t = a_proj * 0.5 + 0.5; gl_Position = vec4(a_proj, 0.0, 1.0); }\n";
    const char *bf[] = {"precision mediump float; varying vec2 v_t; uniform sampler2D u_tex; uniform vec2 u_uv;\n"
                        "void main(){ gl_FragColor = texture2D(u_tex, v_t * u_uv); }\n"};
    const char *ff[] = {"precision mediump float; varying vec2 v_t; uniform float u_a;\n"
                        "void main(){ gl_FragColor = vec4(0.0, 0.0, 0.0, u_a); }\n"};
    GLuint blit = link_program(qv, bf, 1), fade = link_program(qv, ff, 1);
    glUseProgram(blit);
    glUniform1i(glGetUniformLocation(blit, "u_tex"), 1);
    GLint u_fade = glGetUniformLocation(fade, "u_a"), u_uv = glGetUniformLocation(blit, "u_uv");
    float quad[] = {-1, -1, 1, -1, -1, 1, 1, 1};
    GLuint qbuf;
    glGenBuffers(1, &qbuf);
    glBindBuffer(GL_ARRAY_BUFFER, qbuf);
    glBufferData(GL_ARRAY_BUFFER, sizeof quad, quad, GL_STATIC_DRAW);

    // control socket
    int sock = socket(AF_INET, SOCK_DGRAM | SOCK_NONBLOCK, 0);
    struct sockaddr_in addr = {.sin_family = AF_INET, .sin_port = htons(8766), .sin_addr.s_addr = htonl(INADDR_LOOPBACK)};
    if (bind(sock, (struct sockaddr *)&addr, sizeof addr)) perror("bind 8766 (control disabled)");
    float snow = getenv("SKYD_SNOW") ? atof(getenv("SKYD_SNOW")) : 0;
    float speed = getenv("SKYD_SPEED") ? atof(getenv("SKYD_SPEED")) : 1;
    // snow changes apply to new flakes only: the shader knows how far the snow
    // had fallen (fall) when the amount changed (snow_at), and the old amount.
    // Speed eases toward its target and only changes the rate of fall.
    float speed_now = speed, snow_old = snow;
    double fall = 0, snow_at = 0, last_frame = now();
    int cur = 0, demo = 0;
    if (getenv("SKYD_SCENE")) {
        if (!strcmp(getenv("SKYD_SCENE"), "demo")) demo = 1;
        else if (!strcmp(getenv("SKYD_SCENE"), "demo2")) demo = 2;
        else if (!strcmp(getenv("SKYD_SCENE"), "demo3")) demo = 3;
        else if (!strcmp(getenv("SKYD_SCENE"), "demo4")) demo = 4;
        else if (!strcmp(getenv("SKYD_SCENE"), "top") && getenv("SKYD_PLAYLIST")) { set_playlist(getenv("SKYD_PLAYLIST")); demo = 10; }
        else if (!strcmp(getenv("SKYD_SCENE"), "demoall")) demo = 8;
        else if (!strcmp(getenv("SKYD_SCENE"), "shuffle")) demo = 9;
        else if (find_scene(getenv("SKYD_SCENE")) >= 0) cur = find_scene(getenv("SKYD_SCENE"));
    }

    struct gbm_bo *prev = NULL;
    int waiting = 0;
    drmEventContext ev = {.version = 2, .page_flip_handler = flip_done};
    double t0 = now(), scene_t0 = t0, santa_t0 = -1000, last_report = t0;
    int frames = 0, pending = -1;   // pending: scene to switch to after fading out
    const double FADE = 0.6;
    while (running) {
        char cmd[600];
        ssize_t got;
        while ((got = recv(sock, cmd, sizeof cmd - 1, 0)) > 0) {
            cmd[got] = 0;
            char *nl = strchr(cmd, '\n');
            if (nl) *nl = 0;
            float v;
            char name[64];
            int va, vl, vo;
            if (sscanf(cmd, "video %d %d %n", &va, &vl, &vo) == 2 && vo > 0) {
                if (strcmp(scenes[cur].name, "video")) { vid_return = cur; vid_return_demo = demo; }
                video_start(cmd + vo, va, vl);
                int k = find_scene("video");
                if (k >= 0) { demo = 0; if (k != cur) pending = k; }
            } else if (!strcmp(cmd, "video pause")) {
                if (vid_pid > 0 && !vid_paused) { kill(vid_pid, SIGSTOP); vid_paused = 1; }
            } else if (!strcmp(cmd, "video resume")) {
                if (vid_pid > 0 && vid_paused) { kill(vid_pid, SIGCONT); vid_paused = 0; }
            } else if (!strcmp(cmd, "video stop")) {
                video_stop();
                vid_ended = 1;
            } else if (sscanf(cmd, "snow %f", &v) == 1) {
                if (v != snow) { snow_old = snow; snow_at = fall; snow = v; }
            }
            else if (sscanf(cmd, "speed %f", &v) == 1) speed = v;
            else if (!strncmp(cmd, "santa", 5)) santa_t0 = now();
            else if (!strcmp(cmd, "demo on") || !strcmp(cmd, "demo 1") || !strcmp(cmd, "demo 2") || !strcmp(cmd, "demo 3") || !strcmp(cmd, "demo 4") ||
                     !strcmp(cmd, "demo all") || !strcmp(cmd, "demo shuffle")) {
                demo = !strcmp(cmd, "demo 2") ? 2 : !strcmp(cmd, "demo 3") ? 3 : !strcmp(cmd, "demo 4") ? 4 : !strcmp(cmd, "demo all") ? 8 : !strcmp(cmd, "demo shuffle") ? 9 : 1;
                pending = next_scene(-1, demo);
                if (pending < 0) demo = 0;
            }
            else if (!strcmp(cmd, "demo off")) demo = 0;
            else if (!strncmp(cmd, "demo list ", 10)) {
                set_playlist(cmd + 10);
                demo = 10;
                pending = next_scene(-1, 10);
                if (pending < 0) demo = 0;
            }
            else if (sscanf(cmd, "scene %63s", name) == 1) {
                int k = find_scene(name);
                if (k >= 0) { demo = 0; pending = k; }
            } else if (!strncmp(cmd, "set ", 4)) {
                // set <uniform> v1 [v2 ...] on every scene that has it
                char un[64];
                float v[4];
                int off = 0, n = 0, used;
                if (sscanf(cmd + 4, "%63s%n", un, &off) == 1) {
                    char *q = cmd + 4 + off;
                    while (n < 4 && sscanf(q, "%f%n", &v[n], &used) == 1) { q += used; n++; }
                    for (int k = 0; k < nscenes; k++) {
                        GLint loc = glGetUniformLocation(scenes[k].prog, un);
                        if (loc < 0) continue;
                        glUseProgram(scenes[k].prog);
                        if (n == 1) glUniform1f(loc, v[0]);
                        else if (n == 2) glUniform2f(loc, v[0], v[1]);
                        else if (n == 3) glUniform3f(loc, v[0], v[1], v[2]);
                        else if (n == 4) glUniform4f(loc, v[0], v[1], v[2], v[3]);
                    }
                }
            } else if (!strncmp(cmd, "reload", 6)) {
                // new calibration: reload mesh, window and uniforms without
                // restarting (a restart would reset the HDMI signal)
                snprintf(path, sizeof path, "%s/mesh.bin", dir);
                FILE *rf = fopen(path, "rb");
                int32_t c2, r2;
                if (rf && fread(&c2, 4, 1, rf) == 1 && fread(&r2, 4, 1, rf) == 1 && c2 == cols && r2 == rows &&
                    fread(verts, sizeof(float) * 4, cols * rows, rf) == (size_t)(cols * rows)) {
                    glBindBuffer(GL_ARRAY_BUFFER, vbo);
                    glBufferSubData(GL_ARRAY_BUFFER, 0, sizeof(float) * 4 * cols * rows, verts);
                }
                if (rf) fclose(rf);
                snprintf(path, sizeof path, "%s/rect.json", dir);
                char *rj2 = slurp(path);
                if ((p = strstr(rj2, "\"x0\""))) sscanf(strchr(p, ':') + 1, "%f", &rx0);
                if ((p = strstr(rj2, "\"y0\""))) sscanf(strchr(p, ':') + 1, "%f", &ry0);
                if ((p = strstr(rj2, "\"x1\""))) sscanf(strchr(p, ':') + 1, "%f", &rx1);
                if ((p = strstr(rj2, "\"y1\""))) sscanf(strchr(p, ':') + 1, "%f", &ry1);
                free(rj2);
                for (int k = 0; k < nscenes; k++) {
                    glUseProgram(scenes[k].prog);
                    glUniform4f(scenes[k].u_rect, rx0, ry0, rx1, ry1);
                    apply_uniform_file(scenes[k].prog, uniforms_path);
                }
                fprintf(stderr, "skyd: reloaded calibration\n");
            } else if (!strncmp(cmd, "quit", 4)) running = 0;
        }
        double tn = now();
        double st = tn - scene_t0;
        {
            double dt = fmin(tn - last_frame, 0.1);
            last_frame = tn;
            speed_now += (speed - speed_now) * (float)(1.0 - exp(-dt / 1.2));
            fall += dt * speed_now;
        }
        Scene *s = &scenes[cur];
        // a finished video hands back to what was showing before it
        if (!strcmp(s->name, "video") && vid_ended && vid_end_t > 0 && tn - vid_end_t > 1.5 && pending < 0) {
            vid_end_t = -1;
            demo = vid_return_demo;
            pending = vid_return >= 0 ? vid_return : (demo ? next_scene(-1, demo) : find_scene("sky"));
        }
        // demo loop: move on when the scene's time is up
        if (demo && pending < 0 && (st > s->seconds || s->seconds <= 0)) {
            int nx = next_scene(cur, demo);
            if (nx >= 0) pending = nx;
        }
        // fade: in at the start of a scene, out before a switch
        float alpha = (float)(1.0 - fmin(1.0, st / FADE));
        static double fade_out_t0 = -1;
        if (pending >= 0) {
            if (fade_out_t0 < 0) fade_out_t0 = tn;
            alpha = (float)fmin(1.0, (tn - fade_out_t0) / FADE);
            if (tn - fade_out_t0 >= FADE) {
                cur = pending;
                pending = -1;
                if (strcmp(scenes[cur].name, "video")) { video_stop(); vid_t0 = -1; vid_ended = 0; }
                fade_out_t0 = -1;
                scene_t0 = tn;
                st = 0;
                s = &scenes[cur];
                alpha = 1;
                // the sky scene in the demo: Santa flies by after a few seconds
                if (demo && !strcmp(s->name, "sky")) santa_t0 = tn + 6;
            }
        }

        // scale < 1 renders into the half-size buffer (or a corner of it, below 0.5)
        int half = have_fbo && s->scale < 0.99f;
        float fs = s->scale < 0.5f ? s->scale / 0.5f : 1.0f;
        int fw = (int)(hw * fs), fh = (int)(hh * fs);
        glBindFramebuffer(GL_FRAMEBUFFER, half ? fbo : 0);
        glViewport(0, 0, half ? fw : mode.hdisplay, half ? fh : mode.vdisplay);
        glDisable(GL_BLEND);
        glClearColor(0, 0, 0, 1);
        glClear(GL_COLOR_BUFFER_BIT);
        glUseProgram(s->prog);
        glUniform1f(s->u_time, (float)st);
        sims_update(s->name, s->prog, (float)st);
        if (!strcmp(s->name, "video")) {
            video_poll();
            glUniform1f(glGetUniformLocation(s->prog, "u_vidt"), vid_t0 < 0 ? -1.0f : (float)(tn - vid_t0));
            glUniform1f(glGetUniformLocation(s->prog, "u_vidok"), vid_frames > 0 ? 1.0f : 0.0f);
            glUniform1f(glGetUniformLocation(s->prog, "u_vidend"), vid_ended ? 1.0f : 0.0f);
            for (int i = 0; i < 3; i++) { glActiveTexture(GL_TEXTURE2 + i); glBindTexture(GL_TEXTURE_2D, vtex[i]); }
            glActiveTexture(GL_TEXTURE0);
        }
        glUniform1f(s->u_snow, snow);
        glUniform1f(s->u_speed, speed_now);
        glUniform1f(s->u_fall, (float)fall);
        glUniform1f(s->u_snowold, snow_old);
        glUniform1f(s->u_snowat, (float)snow_at);
        glUniform1f(s->u_santa, (float)(tn - santa_t0));
        glBindBuffer(GL_ARRAY_BUFFER, vbo);
        glEnableVertexAttribArray(0);
        glEnableVertexAttribArray(1);
        for (int k = 0; k < nstrips; k++) {
            glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 16, (void *)(uintptr_t)(ibase[k] * 16));
            glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 16, (void *)(uintptr_t)(ibase[k] * 16 + 8));
            glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ibos[k]);
            glDrawElements(GL_TRIANGLES, icounts[k], GL_UNSIGNED_SHORT, 0);
        }
        glDisableVertexAttribArray(1);
        glBindBuffer(GL_ARRAY_BUFFER, qbuf);
        glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 8, 0);
        if (half) {
            glBindFramebuffer(GL_FRAMEBUFFER, 0);
            glViewport(0, 0, mode.hdisplay, mode.vdisplay);
            glUseProgram(blit);
            glUniform2f(u_uv, (float)fw / hw, (float)fh / hh);
            glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
        }
        if (alpha > 0.002f) {
            glEnable(GL_BLEND);
            glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
            glUseProgram(fade);
            glUniform1f(u_fade, alpha);
            glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
        }

        eglSwapBuffers(dpy, esurf);
        struct gbm_bo *bo = gbm_surface_lock_front_buffer(gsurf);
        uint32_t fb = bo_fb(bo);
        if (!prev) {
            if (drmModeSetCrtc(drm_fd, crtc_id, fb, 0, 0, &conn_id, 1, &mode)) die("drmModeSetCrtc");
        } else {
            waiting = 1;
            if (drmModePageFlip(drm_fd, crtc_id, fb, DRM_MODE_PAGE_FLIP_EVENT, &waiting)) {
                perror("page flip");
                waiting = 0;
            }
            while (waiting) {
                fd_set fds;
                FD_ZERO(&fds);
                FD_SET(drm_fd, &fds);
                if (select(drm_fd + 1, &fds, NULL, NULL, NULL) < 0) { if (errno == EINTR) break; die("select"); }
                drmHandleEvent(drm_fd, &ev);
            }
            gbm_surface_release_buffer(gsurf, prev);
        }
        prev = bo;
        frames++;
        if (tn - last_report >= 10) {
            fprintf(stderr, "skyd: %s %.1f fps\n", s->name, frames / (tn - last_report));
            frames = 0;
            last_report = tn;
        }
    }
    video_stop();
    return 0;
}
