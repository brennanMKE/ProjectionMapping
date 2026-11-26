package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"net"
	"time"
)

// Mpv talks to mpv's JSON IPC socket. Each call opens a short-lived
// connection, which keeps the client simple and survives mpv restarts.
type Mpv struct{ socket string }

func (m *Mpv) call(cmd ...any) (any, error) {
	conn, err := net.DialTimeout("unix", m.socket, time.Second)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(3 * time.Second))
	req, _ := json.Marshal(map[string]any{"command": cmd, "request_id": 1})
	if _, err := conn.Write(append(req, '\n')); err != nil {
		return nil, err
	}
	sc := bufio.NewScanner(conn)
	sc.Buffer(make([]byte, 64*1024), 1<<20)
	for sc.Scan() {
		var r struct {
			Error     *string `json:"error"`
			Data      any     `json:"data"`
			RequestID int     `json:"request_id"`
		}
		if json.Unmarshal(sc.Bytes(), &r) != nil || r.Error == nil {
			continue // async event
		}
		if *r.Error != "success" {
			return nil, errors.New("mpv: " + *r.Error)
		}
		return r.Data, nil
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	return nil, errors.New("mpv: no reply")
}

func (m *Mpv) Cmd(args ...any) (any, error) { return m.call(args...) }
func (m *Mpv) Get(prop string) (any, error) { return m.call("get_property", prop) }
func (m *Mpv) Set(prop string, v any) error {
	_, err := m.call("set_property", prop, v)
	return err
}
