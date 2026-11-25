package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
)

var layoutNameRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)

// defaultLayout is used when the layouts directory is empty.
const defaultLayout = `{
  "screen": {"w": 1920, "h": 1080},
  "surfaces": [
    {"id": "s1", "w": 640, "h": 360,
     "content": {"type": "canvas", "sketch": "testcard"},
     "targetPoints": [[640, 360], [1280, 360], [1280, 720], [640, 720]],
     "sourcePoints": [[0, 0], [640, 0], [640, 360], [0, 360]]}
  ]
}`

// Store keeps layouts as JSON files: <dir>/<name>.json. The active layout's
// name is kept in <dir>/.active. Layout bodies are passed through as raw JSON;
// the server only checks that they are JSON objects.
type Store struct {
	dir string

	mu     sync.Mutex
	active string
	layout json.RawMessage // in-memory copy of the active layout
}

func NewStore(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	s := &Store{dir: dir}
	names, err := s.List()
	if err != nil {
		return nil, err
	}
	if len(names) == 0 {
		if err := s.write("default", json.RawMessage(defaultLayout)); err != nil {
			return nil, err
		}
		names = []string{"default"}
	}
	active := "default"
	if b, err := os.ReadFile(filepath.Join(dir, ".active")); err == nil {
		active = strings.TrimSpace(string(b))
	}
	if !contains(names, active) {
		active = names[0]
	}
	if err := s.Activate(active); err != nil {
		return nil, err
	}
	return s, nil
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

func (s *Store) path(name string) string { return filepath.Join(s.dir, name+".json") }

func validName(name string) error {
	if !layoutNameRE.MatchString(name) {
		return fmt.Errorf("invalid layout name %q (letters, digits, - and _ only)", name)
	}
	return nil
}

func (s *Store) List() ([]string, error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, err
	}
	var names []string
	for _, e := range entries {
		n := e.Name()
		if e.IsDir() || !strings.HasSuffix(n, ".json") {
			continue
		}
		n = strings.TrimSuffix(n, ".json")
		if validName(n) == nil {
			names = append(names, n)
		}
	}
	sort.Strings(names)
	return names, nil
}

func (s *Store) Get(name string) (json.RawMessage, error) {
	if err := validName(name); err != nil {
		return nil, err
	}
	b, err := os.ReadFile(s.path(name))
	if err != nil {
		return nil, err
	}
	return checkObject(b)
}

func checkObject(b []byte) (json.RawMessage, error) {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(b, &obj); err != nil {
		return nil, fmt.Errorf("layout must be a JSON object: %w", err)
	}
	return json.RawMessage(b), nil
}

// write saves atomically (temp file + rename) so a power cut mid-save
// cannot leave a truncated layout.
func (s *Store) write(name string, body json.RawMessage) error {
	if err := validName(name); err != nil {
		return err
	}
	if _, err := checkObject(body); err != nil {
		return err
	}
	var buf bytes.Buffer
	if err := json.Indent(&buf, body, "", "  "); err != nil {
		return err
	}
	buf.WriteByte('\n')
	tmp, err := os.CreateTemp(s.dir, ".tmp-*")
	if err != nil {
		return err
	}
	if _, err := tmp.Write(buf.Bytes()); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	tmp.Close()
	return os.Rename(tmp.Name(), s.path(name))
}

func (s *Store) Save(name string, body json.RawMessage) error {
	if err := s.write(name, body); err != nil {
		return err
	}
	s.mu.Lock()
	if name == s.active {
		s.layout = append(json.RawMessage(nil), body...)
	}
	s.mu.Unlock()
	return nil
}

func (s *Store) Delete(name string) error {
	if err := validName(name); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if name == s.active {
		return errors.New("cannot delete the active layout")
	}
	return os.Remove(s.path(name))
}

func (s *Store) Activate(name string) error {
	body, err := s.Get(name)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.active = name
	s.layout = body
	return os.WriteFile(filepath.Join(s.dir, ".active"), []byte(name+"\n"), 0o644)
}

func (s *Store) ActiveName() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.active
}

func (s *Store) Active() (string, json.RawMessage) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.active, s.layout
}

// SetLive updates the in-memory active layout without writing to disk.
// Used while corners are being dragged.
func (s *Store) SetLive(body json.RawMessage) error {
	if _, err := checkObject(body); err != nil {
		return err
	}
	s.mu.Lock()
	s.layout = append(json.RawMessage(nil), body...)
	s.mu.Unlock()
	return nil
}
