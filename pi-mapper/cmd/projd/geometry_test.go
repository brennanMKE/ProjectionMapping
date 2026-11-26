package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWriteGeometry(t *testing.T) {
	c := defaultCorner()
	c.Vertex, c.Down, c.Left, c.Right = [2]float64{664, 454}, [2]float64{676, 708}, [2]float64{196, 220}, [2]float64{1260, 76}
	dir := t.TempDir()
	msg, err := writeGeometry(c, 1280, 720, dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Log(msg)
	for _, f := range []string{"mesh.bin", "uniforms.txt", "rect.json", "corner.json"} {
		if st, err := os.Stat(filepath.Join(dir, f)); err != nil || st.Size() == 0 {
			t.Fatalf("%s missing", f)
		}
	}
	if st, _ := os.Stat(filepath.Join(dir, "mesh.bin")); st.Size() != 8+161*91*16 {
		t.Fatalf("mesh size %d", st.Size())
	}
	// the vertex should map to the middle of the virtual viewer image
	g, _ := solveCorner(c, 1280, 720)
	p, ok := g.hit(664, 456)
	if !ok || p.length() > 0.05 {
		t.Fatalf("vertex hit %v %v", p, ok)
	}
}

func TestBadCorner(t *testing.T) {
	c := defaultCorner()
	c.Left, c.Right = c.Right, c.Left // swapped
	if _, err := writeGeometry(c, 1280, 720, t.TempDir()); err == nil {
		t.Fatal("expected an error for swapped seams")
	}
}
