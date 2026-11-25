package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Msg is the envelope for every WebSocket message in both directions.
// Only the fields relevant to a given type are set.
type Msg struct {
	Type    string          `json:"type"`
	Role    string          `json:"role,omitempty"`    // hello
	Name    string          `json:"name,omitempty"`    // hello, layout, activate, saveAs, deleteLayout
	Cue     string          `json:"cue,omitempty"`     // cue: play | pause | next | blackout
	Value   json.RawMessage `json:"value,omitempty"`   // cue argument, edit/pattern value
	At      int64           `json:"at,omitempty"`      // cue: unix ms when it runs
	Layout  json.RawMessage `json:"layout,omitempty"`  // layout
	Persist bool            `json:"persist,omitempty"` // layout: write to disk
	T0      float64         `json:"t0,omitempty"`      // ping/pong: client send time
	TS      int64           `json:"ts,omitempty"`      // pong: server time, unix ms
	Report  *Report         `json:"report,omitempty"`  // report
	Error   string          `json:"error,omitempty"`
}

// Report is sent by a projector page every few seconds.
type Report struct {
	From     string   `json:"from,omitempty"`
	W        int      `json:"w"`
	H        int      `json:"h"`
	FPS      float64  `json:"fps"`
	Dropped  int      `json:"dropped"`
	Total    int      `json:"total"`
	DriftMs  *float64 `json:"driftMs,omitempty"` // video position minus expected, since last play cue
	Playing  bool     `json:"playing"`
	Videos   int      `json:"videos"`
	Received int64    `json:"received,omitempty"` // set by server, unix ms
}

type client struct {
	role string // projector | control | peer
	name string
	send chan []byte
}

// Hub fans messages out to connected pages and, for two-Pi setups, to the
// leader or followers.
type Hub struct {
	cfg   Config
	store *Store
	drift *DriftLog

	mu       sync.Mutex
	clients  map[*client]struct{}
	edit     bool
	pattern  string
	blackout bool
	clip     int
	reports  map[string]Report // keyed by Pi name
	lastCue  map[string]any

	peer *peerLink // follower only
}

func NewHub(cfg Config, store *Store, drift *DriftLog) *Hub {
	h := &Hub{
		cfg:     cfg,
		store:   store,
		drift:   drift,
		clients: map[*client]struct{}{},
		pattern: "none",
		reports: map[string]Report{},
	}
	if cfg.Role == "follower" {
		h.peer = &peerLink{ctx: context.Background(), leader: cfg.Leader}
	}
	return h
}

func nowMs() int64 { return time.Now().UnixMilli() }

func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}

func (h *Hub) broadcast(v any, except *client, roles ...string) {
	b := mustJSON(v)
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		if c == except {
			continue
		}
		// With no roles given, send to local pages only; peers must be named.
		if len(roles) == 0 && c.role == "peer" {
			continue
		}
		if len(roles) > 0 && !contains(roles, c.role) {
			continue
		}
		select {
		case c.send <- b:
		default:
			log.Printf("ws: dropping message to slow %s client", c.role)
		}
	}
}

func (h *Hub) sendTo(c *client, v any) {
	select {
	case c.send <- mustJSON(v):
	default:
	}
}

func (h *Hub) welcome() map[string]any {
	name, layout := h.store.Active()
	names, _ := h.store.List()
	h.mu.Lock()
	defer h.mu.Unlock()
	return map[string]any{
		"type":       "welcome",
		"pi":         h.cfg.Name,
		"role":       h.cfg.Role,
		"serverTime": nowMs(),
		"boot":       startTime.UnixMilli(), // pages reload when this changes (new deploy)
		"layoutName": name,
		"layout":     layout,
		"layouts":    names,
		"edit":       h.edit,
		"pattern":    h.pattern,
		"blackout":   h.blackout,
		"clip":       h.clip,
	}
}

func (h *Hub) layoutsMsg() map[string]any {
	names, _ := h.store.List()
	return map[string]any{"type": "layouts", "layouts": names, "active": h.store.ActiveName()}
}

func (h *Hub) layoutMsg() map[string]any {
	name, layout := h.store.Active()
	return map[string]any{"type": "layout", "name": name, "layout": layout}
}

// ServeWS handles /ws for projector pages, control pages, and follower Pis.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		// Control pages are always same-origin; peers (Go) send no Origin.
	})
	if err != nil {
		return
	}
	conn.SetReadLimit(4 << 20)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	c := &client{role: "control", send: make(chan []byte, 256)}

	go func() {
		defer cancel()
		for {
			select {
			case <-ctx.Done():
				return
			case b := <-c.send:
				wctx, wcancel := context.WithTimeout(ctx, 5*time.Second)
				err := conn.Write(wctx, websocket.MessageText, b)
				wcancel()
				if err != nil {
					return
				}
			}
		}
	}()

	registered := false
	defer func() {
		if registered {
			h.mu.Lock()
			delete(h.clients, c)
			h.mu.Unlock()
			log.Printf("ws: %s %q disconnected", c.role, c.name)
		}
		conn.CloseNow()
	}()

	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		var m Msg
		if err := json.Unmarshal(data, &m); err != nil {
			h.sendTo(c, Msg{Type: "error", Error: "bad json"})
			continue
		}
		if m.Type == "hello" {
			if m.Role != "" {
				c.role = m.Role
			}
			c.name = m.Name
			if !registered {
				h.mu.Lock()
				h.clients[c] = struct{}{}
				h.mu.Unlock()
				registered = true
			}
			log.Printf("ws: %s %q connected from %s", c.role, c.name, r.RemoteAddr)
			if c.role != "peer" {
				h.sendTo(c, h.welcome())
			}
			continue
		}
		h.handle(c, m)
	}
}

func (h *Hub) handle(c *client, m Msg) {
	switch m.Type {
	case "ping":
		h.sendTo(c, Msg{Type: "pong", T0: m.T0, TS: nowMs()})

	case "cue":
		h.Cue(m.Cue, m.Value, c.role == "peer")

	case "edit":
		var on bool
		json.Unmarshal(m.Value, &on)
		h.mu.Lock()
		h.edit = on
		h.mu.Unlock()
		h.broadcast(map[string]any{"type": "edit", "value": on}, nil)

	case "pattern":
		var p string
		json.Unmarshal(m.Value, &p)
		h.mu.Lock()
		h.pattern = p
		h.mu.Unlock()
		h.broadcast(map[string]any{"type": "pattern", "value": p}, nil)

	case "layout":
		// Live corner edits (persist=false) and saves (persist=true) of the active layout.
		name := h.store.ActiveName()
		var err error
		if m.Persist {
			err = h.store.Save(name, m.Layout)
		} else {
			err = h.store.SetLive(m.Layout)
		}
		if err != nil {
			h.sendTo(c, Msg{Type: "error", Error: err.Error()})
			return
		}
		h.broadcast(map[string]any{"type": "layout", "name": name, "layout": m.Layout, "persisted": m.Persist}, c)
		if m.Persist {
			h.sendTo(c, map[string]any{"type": "saved", "name": name})
		}

	case "activate":
		if err := h.store.Activate(m.Name); err != nil {
			h.sendTo(c, Msg{Type: "error", Error: err.Error()})
			return
		}
		log.Printf("layout: activated %q", m.Name)
		h.broadcast(h.layoutMsg(), nil)
		h.broadcast(h.layoutsMsg(), nil)

	case "saveAs":
		_, body := h.store.Active()
		if len(m.Layout) > 0 {
			body = m.Layout
		}
		if err := h.store.Save(m.Name, body); err != nil {
			h.sendTo(c, Msg{Type: "error", Error: err.Error()})
			return
		}
		if err := h.store.Activate(m.Name); err != nil {
			h.sendTo(c, Msg{Type: "error", Error: err.Error()})
			return
		}
		log.Printf("layout: saved as %q", m.Name)
		h.broadcast(h.layoutMsg(), nil)
		h.broadcast(h.layoutsMsg(), nil)

	case "deleteLayout":
		if err := h.store.Delete(m.Name); err != nil {
			h.sendTo(c, Msg{Type: "error", Error: err.Error()})
			return
		}
		h.broadcast(h.layoutsMsg(), nil)

	case "report":
		if m.Report == nil {
			return
		}
		r := *m.Report
		if c.role != "peer" {
			r.From = h.cfg.Name
		}
		h.recordReport(r)
		if c.role != "peer" && h.peer != nil {
			h.peer.send(Msg{Type: "report", Report: &r})
		}
	}
}

func (h *Hub) recordReport(r Report) {
	r.Received = nowMs()
	h.mu.Lock()
	h.reports[r.From] = r
	h.mu.Unlock()
	if r.DriftMs != nil && r.Playing {
		h.drift.Write(r)
	}
}

// Cue schedules a cue. On a solo or leader Pi it picks the target time and
// forwards to followers. On a follower it goes to the leader, which sends it
// back to everyone. If the leader is unreachable the follower runs it alone.
func (h *Hub) Cue(cue string, value json.RawMessage, fromPeer bool) {
	switch cue {
	case "play", "pause", "next", "blackout":
	default:
		log.Printf("cue: unknown %q", cue)
		return
	}
	if h.cfg.Role == "follower" && h.peer != nil && h.peer.connected() {
		h.peer.send(Msg{Type: "cue", Cue: cue, Value: value})
		return
	}
	at := nowMs() + int64(h.cfg.CueDelayMs)

	// Resolve toggles and counters here so every Pi gets an explicit value.
	h.mu.Lock()
	switch cue {
	case "next":
		h.clip++
		value = mustJSON(h.clip)
	case "play":
		value = mustJSON(h.clip)
	case "blackout":
		var on *bool
		json.Unmarshal(value, &on)
		if on == nil {
			h.blackout = !h.blackout
		} else {
			h.blackout = *on
		}
		value = mustJSON(h.blackout)
	}
	h.mu.Unlock()

	h.runCue(cue, value, at)
	if h.cfg.Role == "leader" {
		h.broadcast(Msg{Type: "cue", Cue: cue, Value: value, At: at}, nil, "peer")
	}
}

// runCue delivers a scheduled cue to this Pi's pages.
func (h *Hub) runCue(cue string, value json.RawMessage, at int64) {
	h.mu.Lock()
	switch cue {
	case "next", "play":
		json.Unmarshal(value, &h.clip)
	case "blackout":
		json.Unmarshal(value, &h.blackout)
	}
	h.lastCue = map[string]any{"cue": cue, "at": at}
	h.mu.Unlock()
	log.Printf("cue: %s value=%s at=%d (in %d ms)", cue, string(value), at, at-nowMs())
	h.broadcast(Msg{Type: "cue", Cue: cue, Value: value, At: at}, nil)
}
