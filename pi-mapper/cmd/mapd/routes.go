package main

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var startTime = time.Now()

func routes(cfg Config, hub *Hub, store *Store) http.Handler {
	mux := http.NewServeMux()
	web := http.FileServer(http.Dir(cfg.WebDir))

	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		noCache(w)
		http.ServeFile(w, r, filepath.Join(cfg.WebDir, "index.html"))
	})
	mux.HandleFunc("GET /control", func(w http.ResponseWriter, r *http.Request) {
		noCache(w)
		http.ServeFile(w, r, filepath.Join(cfg.WebDir, "control.html"))
	})
	mux.HandleFunc("GET /favicon.ico", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.Handle("GET /js/", noCacheHandler(web))
	// http.FileServer supports Range requests, which <video> needs for seeking.
	mux.Handle("GET /media/", http.StripPrefix("/media/", http.FileServer(http.Dir(cfg.MediaDir))))

	mux.HandleFunc("GET /ws", hub.ServeWS)

	mux.HandleFunc("GET /api/time", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"now": nowMs()})
	})
	mux.HandleFunc("GET /api/status", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, hub.Status())
	})
	mux.HandleFunc("GET /api/media", func(w http.ResponseWriter, r *http.Request) {
		files, err := listMedia(cfg.MediaDir)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		writeJSON(w, files)
	})
	mux.HandleFunc("GET /api/layouts", func(w http.ResponseWriter, r *http.Request) {
		names, err := store.List()
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		writeJSON(w, map[string]any{"layouts": names, "active": store.ActiveName()})
	})
	mux.HandleFunc("GET /api/layouts/{name}", func(w http.ResponseWriter, r *http.Request) {
		body, err := store.Get(r.PathValue("name"))
		if err != nil {
			http.Error(w, err.Error(), 404)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(body)
	})
	mux.HandleFunc("PUT /api/layouts/{name}", func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		body, err := io.ReadAll(io.LimitReader(r.Body, 4<<20))
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if err := store.Save(name, body); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if name == store.ActiveName() {
			hub.broadcast(hub.layoutMsg(), nil)
		}
		hub.broadcast(hub.layoutsMsg(), nil)
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("DELETE /api/layouts/{name}", func(w http.ResponseWriter, r *http.Request) {
		if err := store.Delete(r.PathValue("name")); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		hub.broadcast(hub.layoutsMsg(), nil)
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /api/active", func(w http.ResponseWriter, r *http.Request) {
		name, layout := store.Active()
		writeJSON(w, map[string]any{"name": name, "layout": layout})
	})
	mux.HandleFunc("PUT /api/active", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if err := store.Activate(req.Name); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		hub.broadcast(hub.layoutMsg(), nil)
		hub.broadcast(hub.layoutsMsg(), nil)
		w.WriteHeader(http.StatusNoContent)
	})
	// Cues over plain HTTP, handy for curl and scripts:
	//   curl -X POST localhost:8080/api/cue/play
	mux.HandleFunc("POST /api/cue/{cue}", func(w http.ResponseWriter, r *http.Request) {
		var value json.RawMessage
		if v := r.URL.Query().Get("value"); v != "" {
			value = json.RawMessage(v)
		}
		hub.Cue(r.PathValue("cue"), value, false)
		w.WriteHeader(http.StatusNoContent)
	})

	return logRequests(mux)
}

func noCache(w http.ResponseWriter) { w.Header().Set("Cache-Control", "no-cache") }

func noCacheHandler(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		noCache(w)
		h.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(v)
}

func logRequests(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if os.Getenv("MAPD_LOG_HTTP") != "" {
			fmt.Fprintf(os.Stderr, "%s %s\n", r.Method, r.URL.Path)
		}
		h.ServeHTTP(w, r)
	})
}

type mediaFile struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
	Kind string `json:"kind"` // video | image | other
}

func mediaKind(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".mp4", ".m4v", ".mov", ".webm", ".mkv":
		return "video"
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg":
		return "image"
	}
	return "other"
}

func listMedia(dir string) ([]mediaFile, error) {
	files := []mediaFile{}
	if real, err := filepath.EvalSymlinks(dir); err == nil {
		dir = real
	}
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if strings.HasPrefix(d.Name(), ".") && path != dir {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(dir, path)
		rel = filepath.ToSlash(rel)
		files = append(files, mediaFile{Name: rel, Size: info.Size(), Kind: mediaKind(rel)})
		return nil
	})
	sort.Slice(files, func(i, j int) bool { return files[i].Name < files[j].Name })
	return files, err
}

// Status reports Pi health plus the latest projector reports.
func (h *Hub) Status() map[string]any {
	s := map[string]any{
		"pi":         h.cfg.Name,
		"role":       h.cfg.Role,
		"os":         runtime.GOOS + "/" + runtime.GOARCH,
		"time":       nowMs(),
		"uptimeSec":  int(time.Since(startTime).Seconds()),
		"cpuTempC":   cpuTemp(),
		"load":       loadAvg(),
		"layoutName": h.store.ActiveName(),
		"cueDelayMs": h.cfg.CueDelayMs,
	}
	h.mu.Lock()
	reports := make([]Report, 0, len(h.reports))
	for _, r := range h.reports {
		reports = append(reports, r)
	}
	counts := map[string]int{}
	for c := range h.clients {
		counts[c.role]++
	}
	s["clients"] = counts
	s["edit"] = h.edit
	s["pattern"] = h.pattern
	s["blackout"] = h.blackout
	s["clip"] = h.clip
	s["lastCue"] = h.lastCue
	h.mu.Unlock()
	sort.Slice(reports, func(i, j int) bool { return reports[i].From < reports[j].From })
	s["projectors"] = reports
	if h.peer != nil {
		s["peer"] = h.peer.status()
	}
	// Inter-Pi offset: difference between two Pis' drift against the shared cue time.
	if len(reports) == 2 && reports[0].DriftMs != nil && reports[1].DriftMs != nil &&
		absI64(reports[0].Received-reports[1].Received) < 5000 {
		s["interPiOffsetMs"] = *reports[0].DriftMs - *reports[1].DriftMs
	}
	return s
}

func absI64(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}

func cpuTemp() *float64 {
	b, err := os.ReadFile("/sys/class/thermal/thermal_zone0/temp")
	if err != nil {
		return nil
	}
	milli, err := strconv.ParseFloat(strings.TrimSpace(string(b)), 64)
	if err != nil {
		return nil
	}
	c := milli / 1000
	return &c
}

func loadAvg() []float64 {
	b, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return nil
	}
	fields := strings.Fields(string(b))
	var out []float64
	for i := 0; i < 3 && i < len(fields); i++ {
		v, _ := strconv.ParseFloat(fields[i], 64)
		out = append(out, v)
	}
	return out
}

// DriftLog appends projector drift reports to a CSV file.
type DriftLog struct {
	mu sync.Mutex
	f  *os.File
	w  *csv.Writer
}

func NewDriftLog(path string) (*DriftLog, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, err
	}
	d := &DriftLog{f: f, w: csv.NewWriter(f)}
	if info, err := f.Stat(); err == nil && info.Size() == 0 {
		d.w.Write([]string{"time", "pi", "drift_ms", "fps", "dropped_frames", "total_frames"})
		d.w.Flush()
	}
	return d, nil
}

func (d *DriftLog) Write(r Report) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.w.Write([]string{
		time.UnixMilli(r.Received).Format(time.RFC3339Nano),
		r.From,
		strconv.FormatFloat(*r.DriftMs, 'f', 1, 64),
		strconv.FormatFloat(r.FPS, 'f', 1, 64),
		strconv.Itoa(r.Dropped),
		strconv.Itoa(r.Total),
	})
	d.w.Flush()
}

func (d *DriftLog) Close() error { return d.f.Close() }
