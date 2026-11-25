// Command mapd serves the browser projection mapper: the mapping page, the
// control page, media files, layout storage, and a WebSocket for cues.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

// Config is read from a JSON file (-config) and can be overridden by flags.
type Config struct {
	Addr       string `json:"addr"`       // listen address, e.g. ":8080"
	Name       string `json:"name"`       // display name for this Pi (defaults to hostname)
	Role       string `json:"role"`       // "solo", "leader", or "follower"
	Leader     string `json:"leader"`     // follower only: leader host[:port]
	CueDelayMs int    `json:"cueDelayMs"` // how far ahead cues are scheduled
	WebDir     string `json:"webDir"`
	MediaDir   string `json:"mediaDir"`
	LayoutsDir string `json:"layoutsDir"`
	LogDir     string `json:"logDir"`
}

func defaultConfig() Config {
	host, _ := os.Hostname()
	return Config{
		Addr:       ":8080",
		Name:       host,
		Role:       "solo",
		CueDelayMs: 200,
		WebDir:     "web",
		MediaDir:   "media",
		LayoutsDir: "layouts",
		LogDir:     "logs",
	}
}

func main() {
	cfg := defaultConfig()
	configPath := flag.String("config", "", "path to JSON config file (optional)")
	addr := flag.String("addr", "", "listen address (overrides config)")
	role := flag.String("role", "", "solo | leader | follower (overrides config)")
	leader := flag.String("leader", "", "leader host[:port], follower only (overrides config)")
	name := flag.String("name", "", "display name for this Pi (overrides config; default hostname)")
	dir := flag.String("dir", "", "base directory for web/, media/, layouts/, logs/ (default: current directory)")
	flag.Parse()

	if *configPath != "" {
		b, err := os.ReadFile(*configPath)
		if err != nil {
			log.Fatalf("read config: %v", err)
		}
		if err := json.Unmarshal(b, &cfg); err != nil {
			log.Fatalf("parse config: %v", err)
		}
	}
	if *addr != "" {
		cfg.Addr = *addr
	}
	if *role != "" {
		cfg.Role = *role
	}
	if *leader != "" {
		cfg.Leader = *leader
	}
	if *name != "" {
		cfg.Name = *name
	}
	if *dir != "" {
		for _, p := range []*string{&cfg.WebDir, &cfg.MediaDir, &cfg.LayoutsDir, &cfg.LogDir} {
			if !filepath.IsAbs(*p) {
				*p = filepath.Join(*dir, *p)
			}
		}
	}
	switch cfg.Role {
	case "solo", "leader":
	case "follower":
		if cfg.Leader == "" {
			log.Fatal("role follower requires a leader address")
		}
	default:
		log.Fatalf("unknown role %q", cfg.Role)
	}
	if cfg.CueDelayMs <= 0 {
		cfg.CueDelayMs = 200
	}

	store, err := NewStore(cfg.LayoutsDir)
	if err != nil {
		log.Fatalf("layouts: %v", err)
	}
	if err := os.MkdirAll(cfg.LogDir, 0o755); err != nil {
		log.Fatalf("logs: %v", err)
	}
	drift, err := NewDriftLog(filepath.Join(cfg.LogDir, "drift.csv"))
	if err != nil {
		log.Fatalf("drift log: %v", err)
	}
	defer drift.Close()

	hub := NewHub(cfg, store, drift)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if cfg.Role == "follower" {
		go hub.RunPeerLink(ctx, cfg.Leader)
	}

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           routes(cfg, hub, store),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx)
	}()

	log.Printf("mapd %q role=%s listening on %s (active layout %q)", cfg.Name, cfg.Role, cfg.Addr, store.ActiveName())
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
