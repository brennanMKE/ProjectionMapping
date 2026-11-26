package main

// Low-latency channel for the calibration editor: one WebSocket carries tiny
// text messages, so pointer and dot moves reach the projector within a frame
// instead of queueing up as HTTP requests.
//
//   c <x> <y>          pointer position (projector pixels; offscreen to hide)
//   p <dot> <x> <y>    move a calibration dot: vertex | left | right | down
//
// Messages may be batched, one per line. Every message from the browser is
// answered with "a" once it has been passed to the renderer; the browser
// sends its newest positions only after that ack, so at most one batch is
// ever in flight and nothing queues up, whatever the network latency.

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/coder/websocket"
)

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(1024)
	ctx := r.Context()
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		for _, line := range strings.Split(string(data), "\n") {
			if line = strings.TrimSpace(line); line != "" {
				s.wsMessage(ctx, line)
			}
		}
		if err := conn.Write(ctx, websocket.MessageText, []byte("a")); err != nil {
			return
		}
	}
}

func (s *Server) wsMessage(_ context.Context, msg string) {
	var x, y float64
	var dot string
	switch {
	case strings.HasPrefix(msg, "c "):
		if _, err := fmt.Sscanf(msg, "c %g %g", &x, &y); err == nil {
			skySend(fmt.Sprintf("set u_cursor %g %g", x, y))
		}
	case strings.HasPrefix(msg, "p "):
		if _, err := fmt.Sscanf(msg, "p %s %g %g", &dot, &x, &y); err != nil {
			return
		}
		x, y = clampF(x, 0, float64(s.cfg.W-1)), clampF(y, 0, float64(s.cfg.H-1))
		uni := map[string]string{"vertex": "u_v", "left": "u_l", "right": "u_r", "down": "u_d"}[dot]
		if uni == "" {
			return
		}
		s.mu.Lock()
		switch dot {
		case "vertex":
			s.st.Corner.Vertex = [2]float64{x, y}
		case "left":
			s.st.Corner.Left = [2]float64{x, y}
		case "right":
			s.st.Corner.Right = [2]float64{x, y}
		case "down":
			s.st.Corner.Down = [2]float64{x, y}
		}
		s.mu.Unlock()
		skySend(fmt.Sprintf("set %s %g %g", uni, x, y))
		s.save() // debounced write to the state file
	}
}

func clampF(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
