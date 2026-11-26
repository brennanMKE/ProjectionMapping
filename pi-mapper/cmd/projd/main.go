// Command projd runs a projector from a headless Pi: it starts mpv on the
// HDMI output (no desktop, no browser), keeps it running, and serves a web
// control page for phones and laptops on the network.
//
// The page picks clips, plays/pauses, blacks out, shows an alignment grid,
// and corner-pins the picture with ffmpeg's perspective filter inside mpv.
//
// Why a CPU filter and not a GPU shader: the Pi Zero 2 W's GPU (VideoCore IV,
// GL 2.1 / GLES 2.0) has no high-bit-depth render targets, so mpv runs in
// "dumb mode" there and ignores user shaders. The perspective filter holds
// 720p30 on the Zero's four cores (about 3 cores busy).
package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

//go:embed web
var webFS embed.FS

type Config struct {
	Addr      string
	W, H      int
	MediaDirs []string
	StateFile string
	Socket    string
	MpvArgs   []string
	NoMpv     bool
	// Projector remote control through the USB HID gadget (headless/projkey.py)
	ProjKey    string
	HDMIKeys   []string
	HDMIOnBoot time.Duration
	// ADB over Wi-Fi to the projector (needs USB debugging enabled on it).
	// Empty = find it via mDNS (_adb._tcp).
	ADB string
	// Real-time renderer (skyd) and its data directory (mesh.bin, rect.json,
	// sky.frag, sleigh.raw).
	Skyd    string
	SkydDir string
}

// State is what survives restarts.
type State struct {
	Corners  [4][2]float64 `json:"corners"` // pixels: TL, TR, BR, BL
	Clip     string        `json:"clip"`
	Paused   bool          `json:"paused"`
	Blackout bool          `json:"blackout"`
	Live     bool          `json:"live"`  // real-time sky (skyd) instead of mpv
	Snow     float64       `json:"snow"`  // 0..1
	Speed    float64       `json:"speed"` // snowfall speed multiplier
	Scene    string        `json:"scene"` // live scene: shader name in the skyd dir (sky, cube)
	Pattern  bool          `json:"pattern"`
}

type Server struct {
	cfg Config
	mpv *Mpv

	procMu  sync.Mutex
	mpvUp   bool      // an mpv process is running
	skydCmd *exec.Cmd // running skyd, if any

	mu    sync.Mutex
	st    State
	seq   int
	saveT *time.Timer
}

func fullScreen(w, h int) [4][2]float64 {
	return [4][2]float64{{0, 0}, {float64(w), 0}, {float64(w), float64(h)}, {0, float64(h)}}
}

func main() {
	home, _ := os.UserHomeDir()
	addr := flag.String("addr", ":8080", "HTTP listen address")
	screen := flag.String("screen", "1280x720", "HDMI output mode, WxH")
	media := flag.String("media", filepath.Join(home, "media")+","+filepath.Join(home, "corner"), "comma-separated media folders")
	state := flag.String("state", filepath.Join(home, ".config", "projd", "state.json"), "state file")
	hwdec := flag.String("hwdec", "v4l2m2m-copy", "mpv --hwdec value")
	connector := flag.String("connector", "HDMI-A-1", "DRM connector")
	skyd := flag.String("skyd", "/usr/local/bin/skyd", "real-time sky renderer")
	skydDir := flag.String("skyd-dir", filepath.Join(home, "skyd"), "skyd data directory")
	adbAddr := flag.String("adb", "", "projector ADB address host[:port] (default: discover via mDNS)")
	noMpv := flag.Bool("no-mpv", false, "don't start mpv (UI development on a laptop)")
	projkey := flag.String("projkey", "/usr/local/bin/projkey", "key-press tool for the projector (USB HID gadget)")
	// The launcher remembers the last tile and hides the highlight when it
	// runs off an edge, so: overshoot up, come back down to the bottom row,
	// overshoot left, come back to the first tile, then step to HDMI.
	hdmiKeys := flag.String("hdmi-keys", "home up up up down down left left left left left right right right right enter",
		"key sequence that selects the projector's HDMI input")
	hdmiOnBoot := flag.Duration("hdmi-on-boot", 30*time.Second,
		"when the projector connects over USB (Pi boot or projector wake), wait this long for Android to settle, then switch to HDMI (0 = off)")
	flag.Parse()

	var w, h int
	if _, err := fmt.Sscanf(*screen, "%dx%d", &w, &h); err != nil {
		log.Fatalf("bad -screen %q", *screen)
	}
	cfg := Config{
		Addr: *addr, W: w, H: h,
		StateFile:  *state,
		Socket:     filepath.Join(os.TempDir(), "projd-mpv.sock"),
		NoMpv:      *noMpv,
		ProjKey:    *projkey,
		HDMIKeys:   strings.Fields(*hdmiKeys),
		HDMIOnBoot: *hdmiOnBoot,
		ADB:        *adbAddr,
		Skyd:       *skyd,
		SkydDir:    *skydDir,
	}
	for _, d := range strings.Split(*media, ",") {
		if d = strings.TrimSpace(d); d != "" {
			cfg.MediaDirs = append(cfg.MediaDirs, d)
		}
	}
	cfg.MpvArgs = []string{
		"--vo=gpu", "--gpu-context=drm", "--drm-connector=" + *connector,
		fmt.Sprintf("--drm-mode=%dx%d", w, h), "--hwdec=" + *hwdec,
		"--keepaspect=no", "--loop-file=inf", "--image-display-duration=inf",
		"--no-audio", "--no-osc", "--osd-level=0", "--idle=yes", "--force-window=yes",
		"--input-ipc-server=" + cfg.Socket,
	}

	s := &Server{cfg: cfg, mpv: &Mpv{socket: cfg.Socket}}
	s.load()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if !cfg.NoMpv {
		go s.runSky(ctx)
		go s.runMpv(ctx)
		go s.watchDisplay(ctx)
	}
	if cfg.HDMIOnBoot > 0 {
		go s.hdmiOnBoot(ctx)
	}

	srv := &http.Server{Addr: cfg.Addr, Handler: s.routes(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		c, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		srv.Shutdown(c)
	}()
	log.Printf("projd on %s, screen %dx%d, media %v", cfg.Addr, w, h, cfg.MediaDirs)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
	s.saveNow()
}

// ---------------------------------------------------------------- state

func (s *Server) load() {
	s.st = State{Corners: fullScreen(s.cfg.W, s.cfg.H), Speed: 1}
	b, err := os.ReadFile(s.cfg.StateFile)
	if err == nil {
		if err := json.Unmarshal(b, &s.st); err != nil {
			log.Printf("state: %v (using defaults)", err)
			s.st = State{Corners: fullScreen(s.cfg.W, s.cfg.H)}
		}
	}
	if s.st.Clip == "" {
		if clips := s.clips(); len(clips) > 0 {
			s.st.Clip = clips[0].Name
		}
	}
}

func (s *Server) saveNow() {
	s.mu.Lock()
	b, _ := json.MarshalIndent(s.st, "", "  ")
	s.mu.Unlock()
	os.MkdirAll(filepath.Dir(s.cfg.StateFile), 0o755)
	tmp := s.cfg.StateFile + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err == nil {
		os.Rename(tmp, s.cfg.StateFile)
	}
}

// save debounces writes (corner drags send many updates).
func (s *Server) save() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.saveT != nil {
		s.saveT.Stop()
	}
	s.saveT = time.AfterFunc(500*time.Millisecond, s.saveNow)
}

type Clip struct {
	Name string `json:"name"` // dir-base/file, unique across media dirs
	Path string `json:"-"`
	Kind string `json:"kind"`
}

func (s *Server) clips() []Clip {
	var out []Clip
	for _, d := range s.cfg.MediaDirs {
		entries, err := os.ReadDir(d)
		if err != nil {
			continue
		}
		for _, e := range entries {
			n := e.Name()
			if e.IsDir() || strings.HasPrefix(n, ".") {
				continue
			}
			kind := ""
			switch strings.ToLower(filepath.Ext(n)) {
			case ".mp4", ".mkv", ".mov", ".m4v", ".webm":
				kind = "video"
			case ".png", ".jpg", ".jpeg":
				kind = "image"
			default:
				continue
			}
			out = append(out, Clip{Name: filepath.Base(d) + "/" + n, Path: filepath.Join(d, n), Kind: kind})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

func (s *Server) clipPath(name string) (string, bool) {
	for _, c := range s.clips() {
		if c.Name == name {
			return c.Path, true
		}
	}
	return "", false
}

// ---------------------------------------------------------------- mpv process

func (s *Server) runMpv(ctx context.Context) {
	for ctx.Err() == nil {
		if s.isLive() {
			time.Sleep(500 * time.Millisecond)
			continue
		}
		os.Remove(s.cfg.Socket)
		cmd := exec.CommandContext(ctx, "mpv", s.cfg.MpvArgs...)
		cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
		if err := cmd.Start(); err != nil {
			log.Printf("mpv: %v", err)
		} else {
			go func() {
				// wait for the IPC socket, then restore the clip and warp
				for i := 0; i < 50; i++ {
					if _, err := s.mpv.Get("idle-active"); err == nil {
						s.restore()
						return
					}
					time.Sleep(200 * time.Millisecond)
				}
				log.Printf("mpv: IPC socket never came up")
			}()
			s.procMu.Lock()
			s.mpvUp = true
			s.procMu.Unlock()
			err := cmd.Wait()
			s.procMu.Lock()
			s.mpvUp = false
			s.procMu.Unlock()
			log.Printf("mpv exited: %v", err)
			if s.isLive() {
				continue // handing the display to skyd
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
}

// watchDisplay restarts mpv when it has no video output while a display is
// connected. That happens when the Pi boots before the projector is on: mpv
// finds no display, gives up on video, and sits idle, so the projector shows
// the Pi's text console instead of the clip.
func (s *Server) watchDisplay(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Second):
		}
		m, _ := filepath.Glob("/sys/class/drm/card*-HDMI-A-1/status")
		if len(m) == 0 {
			continue
		}
		b, _ := os.ReadFile(m[0])
		if strings.TrimSpace(string(b)) != "connected" {
			continue
		}
		// with no video output mpv answers "property unavailable"; a socket
		// error just means mpv isn't up (runMpv handles that)
		vo, err := s.mpv.Get("current-vo")
		if err == nil && vo != nil && vo != "" {
			continue
		}
		if err != nil && !strings.Contains(err.Error(), "unavailable") {
			continue
		}
		log.Printf("display: HDMI connected but mpv has no video output; restarting mpv")
		s.mpv.Cmd("quit")
	}
}

func (s *Server) restore() {
	s.mu.Lock()
	clip, paused := s.st.Clip, s.st.Paused
	s.mu.Unlock()
	if p, ok := s.clipPath(clip); ok {
		s.mpv.Cmd("loadfile", p, "replace")
	}
	s.mpv.Set("pause", paused)
	s.applyVideo()
	log.Printf("mpv: restored clip %q", clip)
}

func (s *Server) isLive() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.st.Live
}

// runSky starts skyd when Live is on (after mpv has released the display) and
// stops it when Live is turned off.
func (s *Server) runSky(ctx context.Context) {
	for ctx.Err() == nil {
		live := s.isLive()
		s.procMu.Lock()
		running, mpvUp := s.skydCmd != nil, s.mpvUp
		s.procMu.Unlock()
		switch {
		case live && !running && !mpvUp:
			s.mu.Lock()
			snow, speed := s.st.Snow, s.st.Speed
			s.mu.Unlock()
			d := s.cfg.SkydDir
			s.mu.Lock()
			scene := s.st.Scene
			s.mu.Unlock()
			if scene == "" {
				scene = "sky"
			}
			cmd := exec.Command(s.cfg.Skyd, filepath.Join(d, "mesh.bin"), filepath.Join(d, "rect.json"),
				filepath.Join(d, scene+".frag"), filepath.Join(d, "sleigh.raw"))
			cmd.Env = append(os.Environ(), fmt.Sprintf("SKYD_SNOW=%g", snow), fmt.Sprintf("SKYD_SPEED=%g", speed),
				"SKYD_UNIFORMS="+filepath.Join(d, "uniforms.txt"))
			if scene == "cube" {
				cmd.Env = append(cmd.Env, "SKYD_SCALE=0.5") // ray tracing: render at half size
			}
			cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
			if err := cmd.Start(); err != nil {
				log.Printf("skyd: %v", err)
				time.Sleep(5 * time.Second)
				continue
			}
			s.procMu.Lock()
			s.skydCmd = cmd
			s.procMu.Unlock()
			log.Printf("skyd: started")
			go func() {
				err := cmd.Wait()
				log.Printf("skyd exited: %v", err)
				s.procMu.Lock()
				s.skydCmd = nil
				s.procMu.Unlock()
			}()
		case live && mpvUp:
			s.mpv.Cmd("quit") // release the display for skyd
		case !live && running:
			s.procMu.Lock()
			if s.skydCmd != nil && s.skydCmd.Process != nil {
				s.skydCmd.Process.Signal(syscall.SIGTERM)
			}
			s.procMu.Unlock()
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(400 * time.Millisecond):
		}
	}
}

// skySend sends a control command to skyd (UDP 127.0.0.1:8766).
func skySend(cmd string) error {
	c, err := net.Dial("udp", "127.0.0.1:8766")
	if err != nil {
		return err
	}
	defer c.Close()
	_, err = c.Write([]byte(cmd))
	return err
}

// applyVideo sets mpv's filter chain (alignment grid, corner pin) and the
// blackout (video track off, which costs nothing).
func (s *Server) applyVideo() error {
	s.mu.Lock()
	st := s.st
	s.mu.Unlock()

	vid := "auto"
	if st.Blackout {
		vid = "no"
	}
	if err := s.mpv.Set("vid", vid); err != nil {
		return err
	}
	graph := filterGraph(st, s.cfg.W, s.cfg.H)
	if graph == "" {
		_, err := s.mpv.Cmd("vf", "clr", "")
		return err
	}
	_, err := s.mpv.Cmd("vf", "set", "lavfi=["+graph+"]")
	return err
}

// filterGraph builds the ffmpeg filter chain. Corners are screen pixels;
// perspective works in the clip's own pixels, so each value is scaled by
// W/screenW or H/screenH (W and H are the clip size inside the expression).
func filterGraph(st State, sw, sh int) string {
	var chain []string
	if st.Pattern {
		chain = append(chain,
			"drawgrid=w=iw/10:h=ih/10:t=2:c=white@0.8",
			"drawbox=x=0:y=0:w=iw*0.08:h=ih*0.08:t=fill:c=0xff3b30",
			"drawbox=x=iw*0.92:y=0:w=iw*0.08:h=ih*0.08:t=fill:c=0x34c759",
			"drawbox=x=iw*0.92:y=ih*0.92:w=iw*0.08:h=ih*0.08:t=fill:c=0x0a84ff",
			"drawbox=x=0:y=ih*0.92:w=iw*0.08:h=ih*0.08:t=fill:c=0xffcc00",
			"drawbox=x=0:y=0:w=iw:h=ih:t=6:c=white")
	}
	if st.Corners != fullScreen(sw, sh) {
		c := st.Corners
		x := func(v float64) string { return strconv.FormatFloat(v/float64(sw), 'f', 6, 64) + "*W" }
		y := func(v float64) string { return strconv.FormatFloat(v/float64(sh), 'f', 6, 64) + "*H" }
		// a black frame edge, so pixels outside the quad (which perspective
		// fills from the nearest edge) come out black
		chain = append(chain, "drawbox=x=0:y=0:w=iw:h=ih:t=3:c=black",
			// perspective's order is top-left, top-right, bottom-left, bottom-right
			fmt.Sprintf("perspective=x0=%s:y0=%s:x1=%s:y1=%s:x2=%s:y2=%s:x3=%s:y3=%s:sense=destination:interpolation=linear",
				x(c[0][0]), y(c[0][1]), x(c[1][0]), y(c[1][1]), x(c[3][0]), y(c[3][1]), x(c[2][0]), y(c[2][1])))
	}
	return strings.Join(chain, ",")
}

// ---------------------------------------------------------------- projector remote

var keyMu sync.Mutex // one key sequence at a time

func (s *Server) pressKeys(keys ...string) error {
	keyMu.Lock()
	defer keyMu.Unlock()
	args := append([]string{"--delay", "0.7"}, keys...)
	out, err := exec.Command(s.cfg.ProjKey, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("projkey: %v: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// usbState is the USB gadget's state: "configured" when the projector sees it.
func usbState() string {
	m, _ := filepath.Glob("/sys/class/udc/*/state")
	if len(m) == 0 {
		return "no USB gadget"
	}
	b, _ := os.ReadFile(m[0])
	return strings.TrimSpace(string(b))
}

// hdmiOnConnect switches the projector to HDMI whenever it (re)connects over
// USB: after the Pi boots, and after the projector wakes from standby (its
// USB host goes away in standby and comes back on wake). A connection that is
// already up when projd starts (e.g. a deploy restart) is left alone, unless
// the Pi itself has only just booted.
func (s *Server) hdmiOnBoot(ctx context.Context) {
	prev := usbState()
	if b, err := os.ReadFile("/proc/uptime"); err == nil {
		if up, _ := strconv.ParseFloat(strings.Fields(string(b))[0], 64); up < 180 {
			prev = "not attached"
		}
	}
	for ctx.Err() == nil {
		cur := usbState()
		if cur == "configured" && prev != "configured" {
			log.Printf("hdmi: projector connected over USB; switching to HDMI in %s", s.cfg.HDMIOnBoot)
			select {
			case <-ctx.Done():
				return
			case <-time.After(s.cfg.HDMIOnBoot):
			}
			if usbState() == "configured" {
				if how, err := s.switchHDMIAfterConnect(ctx, 2*time.Minute); err != nil {
					log.Printf("hdmi: %v", err)
				} else {
					log.Printf("hdmi: switched via %s", how)
				}
			}
			cur = usbState()
		}
		prev = cur
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
}

// ---------------------------------------------------------------- ADB

// The HDMI input is shown by this activity (Allwinner H713 "AwLiveTv");
// starting it switches straight to HDMI. Started cold without the
// input_source extra it crashes ("otherIntentSource must not be null").
const hdmiActivity = "com.softwinner.awlivetv/.MainActivity --es input_source HDMI1"

var adbMu sync.Mutex

// adbTarget returns host:port for the projector, discovering it via mDNS.
func (s *Server) adbTarget() (string, error) {
	if s.cfg.ADB != "" {
		if strings.Contains(s.cfg.ADB, ":") {
			return s.cfg.ADB, nil
		}
		return s.cfg.ADB + ":5555", nil
	}
	out, err := exec.Command("avahi-browse", "-rpt", "_adb._tcp").Output()
	if err != nil {
		return "", fmt.Errorf("mDNS browse: %v", err)
	}
	for _, line := range strings.Split(string(out), "\n") {
		f := strings.Split(line, ";")
		if len(f) >= 9 && f[0] == "=" && f[2] == "IPv4" {
			return f[7] + ":" + f[8], nil
		}
	}
	return "", errors.New("projector not found via mDNS (is USB debugging on?)")
}

func adbRun(timeout time.Duration, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, "adb", args...).CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

// adbShell runs a shell command on the projector, connecting first if needed.
func (s *Server) adbShell(cmd string) (string, error) {
	adbMu.Lock()
	defer adbMu.Unlock()
	t, err := s.adbTarget()
	if err != nil {
		return "", err
	}
	if st, _ := adbRun(5*time.Second, "-s", t, "get-state"); st != "device" {
		// a connection left over from before a projector reboot shows as
		// "offline" and never recovers on its own: drop it and reconnect
		adbRun(5*time.Second, "disconnect", t)
		adbRun(8*time.Second, "connect", t)
		if st, _ := adbRun(5*time.Second, "-s", t, "get-state"); st != "device" {
			return "", fmt.Errorf("adb %s: %s", t, st)
		}
	}
	return adbRun(10*time.Second, "-s", t, "shell", cmd)
}

func (s *Server) adbState() string {
	adbMu.Lock()
	defer adbMu.Unlock()
	t, err := s.adbTarget()
	if err != nil {
		return "not found"
	}
	st, _ := adbRun(4*time.Second, "-s", t, "get-state")
	if strings.Contains(st, "unauthorized") {
		return "unauthorized (accept the prompt on the projector)"
	}
	if st == "" || strings.Contains(st, "error") {
		return "not connected"
	}
	return st
}

// hdmiInFront reports whether the HDMI activity is the resumed one.
func (s *Server) hdmiInFront() bool {
	out, err := s.adbShell("dumpsys activity activities | grep -m1 mResumedActivity")
	return err == nil && strings.Contains(out, "com.softwinner.awlivetv/")
}

// switchHDMIAfterConnect is used when the projector has just connected (Pi
// boot or projector wake): wait up to maxWait for Android to finish booting
// and ADB to answer, switch over ADB and confirm; keys only as a last resort.
func (s *Server) switchHDMIAfterConnect(ctx context.Context, maxWait time.Duration) (string, error) {
	deadline := time.Now().Add(maxWait)
	for time.Now().Before(deadline) && ctx.Err() == nil {
		out, err := s.adbShell("getprop sys.boot_completed")
		if err != nil && strings.Contains(err.Error(), "unauthorized") {
			// the projector forgot this Pi's key (e.g. "Always allow" wasn't
			// ticked); waiting won't help, someone must accept the prompt
			log.Printf("hdmi: adb unauthorized: accept the debugging prompt on the projector (tick Always allow)")
			break
		}
		if err == nil && strings.TrimSpace(out) == "1" {
			for try := 0; try < 3; try++ {
				s.adbShell("am start -n " + hdmiActivity)
				time.Sleep(3 * time.Second)
				if s.hdmiInFront() {
					return "adb", nil
				}
			}
		}
		time.Sleep(5 * time.Second)
	}
	log.Printf("hdmi: adb not available; using key sequence")
	return "keys", s.pressKeys(s.cfg.HDMIKeys...)
}

// switchHDMI opens the HDMI input over ADB (instant), falling back to the
// USB keyboard menu sequence (about 12 s).
func (s *Server) switchHDMI() (string, error) {
	if out, err := s.adbShell("am start -n " + hdmiActivity); err == nil && !strings.Contains(out, "Error") {
		return "adb", nil
	} else if err != nil {
		log.Printf("hdmi: adb unavailable (%v); using key sequence", err)
	}
	return "keys", s.pressKeys(s.cfg.HDMIKeys...)
}

// ---------------------------------------------------------------- HTTP

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	sub, _ := fs.Sub(webFS, "web")
	mux.Handle("GET /", http.FileServer(http.FS(sub)))
	mux.HandleFunc("GET /api/state", s.handleState)
	mux.HandleFunc("GET /api/status", s.handleStatus)
	mux.HandleFunc("POST /api/{action}", s.handleAction)
	return mux
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(v)
}

func (s *Server) handleState(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	st := s.st
	s.mu.Unlock()
	writeJSON(w, map[string]any{"state": st, "screen": [2]int{s.cfg.W, s.cfg.H}, "clips": s.clips()})
}

func (s *Server) handleAction(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Clip    string         `json:"clip"`
		On      *bool          `json:"on"`
		Corners *[4][2]float64 `json:"corners"`
		Key     string         `json:"key"`
		Snow    *float64       `json:"snow"`
		Speed   *float64       `json:"speed"`
		Santa   bool           `json:"santa"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	var err error
	warp := false

	s.mu.Lock()
	switch r.PathValue("action") {
	case "live":
		s.st.Live = !s.st.Live
		if body.On != nil {
			s.st.Live = *body.On
		}
	case "scene":
		if body.Clip == "" || strings.ContainsAny(body.Clip, "/.") {
			err = errors.New("scene name required")
			break
		}
		s.st.Scene, s.st.Live = body.Clip, true
		s.procMu.Lock()
		if s.skydCmd != nil && s.skydCmd.Process != nil {
			s.skydCmd.Process.Signal(syscall.SIGTERM) // runSky restarts it with the new scene
		}
		s.procMu.Unlock()
	case "sky":
		if body.Snow != nil {
			s.st.Snow = math.Max(0, math.Min(1, *body.Snow))
			skySend(fmt.Sprintf("snow %g", s.st.Snow))
		}
		if body.Speed != nil {
			s.st.Speed = math.Max(0.1, math.Min(5, *body.Speed))
			skySend(fmt.Sprintf("speed %g", s.st.Speed))
		}
		if body.Santa {
			skySend("santa")
		}
	case "play": // load a clip (or restart the current one) from the beginning
		s.st.Live = false
		if body.Clip != "" {
			s.st.Clip = body.Clip
		}
		s.st.Paused = false
		clip := s.st.Clip
		s.mu.Unlock()
		if p, ok := s.clipPath(clip); ok {
			_, err = s.mpv.Cmd("loadfile", p, "replace")
			s.mpv.Set("pause", false)
		} else {
			err = fmt.Errorf("no clip %q", clip)
		}
		s.mu.Lock()
	case "pause":
		s.st.Paused = !s.st.Paused
		if body.On != nil {
			s.st.Paused = *body.On
		}
		p := s.st.Paused
		s.mu.Unlock()
		err = s.mpv.Set("pause", p)
		s.mu.Lock()
	case "next", "prev":
		s.st.Live = false
		clips := s.clips()
		idx := 0
		for i, c := range clips {
			if c.Name == s.st.Clip {
				idx = i
			}
		}
		if len(clips) > 0 {
			step := 1
			if r.PathValue("action") == "prev" {
				step = len(clips) - 1
			}
			c := clips[(idx+step)%len(clips)]
			s.st.Clip, s.st.Paused = c.Name, false
			s.mu.Unlock()
			_, err = s.mpv.Cmd("loadfile", c.Path, "replace")
			s.mpv.Set("pause", false)
			s.mu.Lock()
		}
	case "blackout":
		s.st.Blackout = !s.st.Blackout
		if body.On != nil {
			s.st.Blackout = *body.On
		}
		warp = true
	case "pattern":
		s.st.Pattern = !s.st.Pattern
		if body.On != nil {
			s.st.Pattern = *body.On
		}
		warp = true
	case "corners":
		if body.Corners == nil {
			err = errors.New("corners required")
			break
		}
		s.st.Corners = *body.Corners
		warp = true
	case "hdmi", "key":
		if r.PathValue("action") == "hdmi" {
			s.mu.Unlock()
			_, err = s.switchHDMI()
			s.mu.Lock()
			break
		}
		var keys []string
		if r.PathValue("action") == "key" {
			allowed := map[string]bool{"home": true, "back": true, "up": true, "down": true, "left": true,
				"right": true, "enter": true, "sleep": true, "wake": true, "power": true}
			if !allowed[body.Key] {
				s.mu.Unlock()
				http.Error(w, "unknown key", 400)
				return
			}
			keys = []string{body.Key}
		}
		s.mu.Unlock()
		err = s.pressKeys(keys...)
		s.mu.Lock()
	case "reset":
		s.st.Corners = fullScreen(s.cfg.W, s.cfg.H)
		warp = true
	default:
		s.mu.Unlock()
		http.Error(w, "unknown action", 404)
		return
	}
	s.mu.Unlock()
	if warp && err == nil {
		err = s.applyVideo()
	}
	s.save()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	s.handleState(w, r)
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"time": time.Now().UnixMilli()}
	host, _ := os.Hostname()
	out["host"] = host
	if b, err := os.ReadFile("/sys/class/thermal/thermal_zone0/temp"); err == nil {
		if v, err := strconv.ParseFloat(strings.TrimSpace(string(b)), 64); err == nil {
			out["tempC"] = math.Round(v/100) / 10
		}
	}
	if b, err := os.ReadFile("/proc/loadavg"); err == nil {
		out["load"] = strings.Fields(string(b))[0]
	}
	if b, err := exec.Command("vcgencmd", "get_throttled").Output(); err == nil {
		out["throttled"] = strings.TrimPrefix(strings.TrimSpace(string(b)), "throttled=")
	}
	mp := map[string]any{}
	for _, p := range []string{"hwdec-current", "estimated-vf-fps", "frame-drop-count", "decoder-frame-drop-count", "time-pos", "duration", "pause", "filename"} {
		if v, err := s.mpv.Get(p); err == nil {
			mp[p] = v
		}
	}
	out["mpv"] = mp
	out["usb"] = usbState()
	s.procMu.Lock()
	out["skyd"] = s.skydCmd != nil
	s.procMu.Unlock()
	out["adb"] = s.adbState()
	out["mpvRunning"] = len(mp) > 0
	writeJSON(w, out)
}
