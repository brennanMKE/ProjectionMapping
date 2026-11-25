package main

import (
	"context"
	"encoding/json"
	"log"
	"net"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// peerLink is a follower's connection to the leader's /ws.
type peerLink struct {
	mu      sync.Mutex
	conn    *websocket.Conn
	ctx     context.Context
	offset  *float64 // leader clock minus our clock, ms (from ping/pong)
	rttMs   float64
	leader  string
	lastErr string
}

func (p *peerLink) connected() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.conn != nil
}

func (p *peerLink) send(m Msg) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.conn == nil {
		return
	}
	ctx, cancel := context.WithTimeout(p.ctx, 3*time.Second)
	defer cancel()
	if err := p.conn.Write(ctx, websocket.MessageText, mustJSON(m)); err != nil {
		log.Printf("peer: write: %v", err)
	}
}

func (p *peerLink) status() map[string]any {
	p.mu.Lock()
	defer p.mu.Unlock()
	return map[string]any{
		"leader":        p.leader,
		"connected":     p.conn != nil,
		"clockOffsetMs": p.offset,
		"rttMs":         p.rttMs,
		"lastError":     p.lastErr,
	}
}

func leaderURL(leader string) string {
	if _, _, err := net.SplitHostPort(leader); err != nil {
		leader = net.JoinHostPort(leader, "8080")
	}
	return "ws://" + leader + "/ws"
}

// RunPeerLink keeps a connection to the leader open and runs the cues it sends.
func (h *Hub) RunPeerLink(ctx context.Context, leader string) {
	p := h.peer
	p.mu.Lock()
	p.ctx = ctx
	p.leader = leader
	p.mu.Unlock()
	url := leaderURL(leader)
	backoff := time.Second
	for ctx.Err() == nil {
		err := h.peerSession(ctx, url)
		p.mu.Lock()
		p.conn = nil
		if err != nil {
			p.lastErr = err.Error()
		}
		p.mu.Unlock()
		if ctx.Err() != nil {
			return
		}
		log.Printf("peer: link to %s down (%v); retrying in %s", url, err, backoff)
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		if backoff < 10*time.Second {
			backoff *= 2
		}
	}
}

func (h *Hub) peerSession(ctx context.Context, url string) error {
	dctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	conn, _, err := websocket.Dial(dctx, url, nil)
	cancel()
	if err != nil {
		return err
	}
	defer conn.CloseNow()
	conn.SetReadLimit(1 << 20)

	p := h.peer
	p.mu.Lock()
	p.conn = conn
	p.lastErr = ""
	p.mu.Unlock()
	log.Printf("peer: connected to leader %s", url)

	p.send(Msg{Type: "hello", Role: "peer", Name: h.cfg.Name})

	// Measure clock offset against the leader now and every 30 s.
	// With NTP working on both Pis this should be a few ms at most.
	pingDone := make(chan struct{})
	defer close(pingDone)
	go func() {
		t := time.NewTicker(30 * time.Second)
		defer t.Stop()
		for {
			p.send(Msg{Type: "ping", T0: float64(nowMs())})
			select {
			case <-pingDone:
				return
			case <-t.C:
			}
		}
	}()

	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return err
		}
		var m Msg
		if err := json.Unmarshal(data, &m); err != nil {
			continue
		}
		switch m.Type {
		case "cue":
			h.runCue(m.Cue, m.Value, m.At)
		case "pong":
			now := float64(nowMs())
			rtt := now - m.T0
			off := float64(m.TS) - (m.T0+now)/2
			p.mu.Lock()
			p.offset = &off
			p.rttMs = rtt
			p.mu.Unlock()
			log.Printf("peer: leader clock offset %+.1f ms (rtt %.1f ms)", off, rtt)
		}
	}
}
