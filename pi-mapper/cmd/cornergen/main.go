// Command cornergen renders test videos for projecting into a room corner
// where two walls meet the ceiling.
//
// You describe where the corner lands in the projector image (the corner
// point plus one point on each of the three seams). cornergen solves for the
// projector's orientation, treats the walls and ceiling as three
// perpendicular planes, and renders effects in 3D room coordinates, so they
// land on the surfaces as if painted there. The clips loop seamlessly and
// play full screen with no warping (cornerpin.py reset).
//
//	go run ./cmd/cornergen -config corner/corner.json -out media/corner
//	go run ./cmd/cornergen -config corner/corner.json -only measure
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"log"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// Config describes the projector image and where the corner sits in it.
// All points are projector pixels, origin top-left.
type Config struct {
	Width   int     `json:"width"`
	Height  int     `json:"height"`
	FPS     int     `json:"fps"`
	Seconds float64 `json:"seconds"` // length of each loop
	// Throw ratio = distance / image width. Sets the lens focal length.
	// Cheap projectors are usually 1.2 to 1.5.
	Throw float64 `json:"throw"`
	// Optical center of the image in pixels. Most projectors shift the image
	// up from the lens, so this is often below the middle. Default: center.
	Principal *[2]float64 `json:"principal,omitempty"`
	// Distance from the projector lens to the corner, in meters. Only sets
	// the scale of effects (grid spacing, ripple size).
	Distance float64    `json:"distance"`
	Vertex   [2]float64 `json:"vertex"` // where the walls and ceiling meet
	Down     [2]float64 `json:"down"`   // a point on the wall-to-wall seam, below the vertex
	Left     [2]float64 `json:"left"`   // a point on the left wall / ceiling seam
	Right    [2]float64 `json:"right"`  // a point on the right wall / ceiling seam
	// Optional viewer eye position in room meters [down, left, right], used by
	// the sky clips. Default: the projector's position.
	Eye *[3]float64 `json:"eye,omitempty"`
	SS  int         `json:"supersample"`
	// Mask the picture to a clean box-corner frame in room coordinates:
	// each wall a rectangle MaskWidth out from the corner and MaskDepth down
	// from the ceiling, the ceiling a MaskWidth square. 0 = largest that fits
	// inside the projector's picture. "mask": false turns it off.
	Mask      *bool   `json:"mask,omitempty"`
	MaskWidth float64 `json:"maskWidth,omitempty"`
	MaskDepth float64 `json:"maskDepth,omitempty"`
	CRF       int     `json:"crf"`
}

func defaultConfig() Config {
	w, h := 1280.0, 720.0
	vx, vy, L := w/2, h*0.42, 420.0
	return Config{
		Width: int(w), Height: int(h), FPS: 30, Seconds: 20, Throw: 1.3, Distance: 3.0,
		Vertex: [2]float64{vx, vy},
		Down:   [2]float64{vx, h},
		Left:   [2]float64{vx - 0.866*L, vy - 0.5*L},
		Right:  [2]float64{vx + 0.866*L, vy - 0.5*L},
		SS:     2, CRF: 20,
	}
}

// ---------------------------------------------------------------- vectors

type V3 [3]float64

func (a V3) Add(b V3) V3      { return V3{a[0] + b[0], a[1] + b[1], a[2] + b[2]} }
func (a V3) Sub(b V3) V3      { return V3{a[0] - b[0], a[1] - b[1], a[2] - b[2]} }
func (a V3) Mul(s float64) V3 { return V3{a[0] * s, a[1] * s, a[2] * s} }
func (a V3) Dot(b V3) float64 { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] }
func (a V3) Len() float64     { return math.Sqrt(a.Dot(a)) }
func (a V3) Norm() V3         { return a.Mul(1 / a.Len()) }
func (a V3) Hadamard(b V3) V3 { return V3{a[0] * b[0], a[1] * b[1], a[2] * b[2]} }
func (a V3) Cross(b V3) V3 {
	return V3{a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]}
}

// ---------------------------------------------------------------- camera solve

// Scene is the solved geometry. World coordinates are meters from the corner:
// x = down the wall seam, y = along the left seam, z = along the right seam.
// Left wall: z=0. Right wall: y=0. Ceiling: x=0. The room is x,y,z >= 0.
type Scene struct {
	cfg       Config
	f, cx, cy float64
	V         V3    // corner in camera coordinates
	D         [3]V3 // world axes in camera coordinates
	Cam       V3    // projector position in world coordinates
	maskW     float64
	maskD     float64
	maskC     float64
}

func (s *Scene) ray(px, py float64) V3 { return V3{(px - s.cx) / s.f, (py - s.cy) / s.f, 1} }

func (s *Scene) project(p V3) (float64, float64) {
	return s.f*p[0]/p[2] + s.cx, s.f*p[1]/p[2] + s.cy
}

func solve(cfg Config) (*Scene, error) {
	s := &Scene{cfg: cfg, f: cfg.Throw * float64(cfg.Width), cx: float64(cfg.Width) / 2, cy: float64(cfg.Height) / 2}
	if cfg.Principal != nil {
		s.cx, s.cy = cfg.Principal[0], cfg.Principal[1]
	}
	rv := s.ray(cfg.Vertex[0], cfg.Vertex[1])
	pts := [3][2]float64{cfg.Down, cfg.Left, cfg.Right}
	var n [3]V3
	for i, p := range pts {
		n[i] = rv.Cross(s.ray(p[0], p[1])).Norm()
	}
	// D0 lies in plane 0: D0 = cos(a) e1 + sin(a) e2. D1 is perpendicular to
	// n1 and D0. D2 = D0 x D1 must be perpendicular to n2: find roots in a.
	e1 := n[0].Cross(V3{0, 0, 1})
	if e1.Len() < 1e-6 {
		e1 = n[0].Cross(V3{1, 0, 0})
	}
	e1 = e1.Norm()
	e2 := n[0].Cross(e1)
	axes := func(a float64) (V3, V3, V3, float64, bool) {
		d0 := e1.Mul(math.Cos(a)).Add(e2.Mul(math.Sin(a)))
		c := n[1].Cross(d0)
		if c.Len() < 1e-9 {
			return V3{}, V3{}, V3{}, 0, false
		}
		d1 := c.Norm()
		d2 := d0.Cross(d1)
		return d0, d1, d2, d2.Dot(n[2]), true
	}
	const steps = 7200
	var roots []float64
	prevA := 0.0
	_, _, _, prevF, prevOK := axes(0)
	for i := 1; i <= steps; i++ {
		a := math.Pi * float64(i) / steps
		_, _, _, fv, ok := axes(a)
		if ok && prevOK && (prevF < 0) != (fv < 0) && math.Abs(prevF-fv) < 0.5 {
			lo, hi, flo := prevA, a, prevF
			for k := 0; k < 60; k++ {
				mid := (lo + hi) / 2
				_, _, _, fm, _ := axes(mid)
				if (fm < 0) == (flo < 0) {
					lo, flo = mid, fm
				} else {
					hi = mid
				}
			}
			roots = append(roots, (lo+hi)/2)
		}
		prevA, prevF, prevOK = a, fv, ok
	}
	s.V = rv.Norm().Mul(cfg.Distance)
	for _, a := range roots {
		d0, d1, d2, _, _ := axes(a)
		base := [3]V3{d0, d1, d2}
		for signs := 0; signs < 8; signs++ {
			var D [3]V3
			ok := true
			for i := 0; i < 3; i++ {
				D[i] = base[i]
				if signs&(1<<i) != 0 {
					D[i] = D[i].Mul(-1)
				}
				// moving along D[i] from the corner must move toward the seam point in the image
				qx, qy := s.project(s.V.Add(D[i].Mul(0.01)))
				if (qx-cfg.Vertex[0])*(pts[i][0]-cfg.Vertex[0])+(qy-cfg.Vertex[1])*(pts[i][1]-cfg.Vertex[1]) <= 0 {
					ok = false
				}
				// the projector must be inside the room
				if s.V.Mul(-1).Dot(D[i]) <= 0 {
					ok = false
				}
			}
			if ok {
				s.D = D
				s.Cam = V3{-s.V.Dot(D[0]), -s.V.Dot(D[1]), -s.V.Dot(D[2])}
				return s, nil
			}
		}
	}
	return nil, fmt.Errorf("no perpendicular-corner solution for these points (found %d candidate orientations). "+
		"Check the seam points, or try a different throw ratio", len(roots))
}

// hit returns which surface a projector pixel lands on and the world point.
// face: 0 left wall, 1 right wall, 2 ceiling; -1 none.
func (s *Scene) hit(px, py float64) (int, V3) {
	d := s.ray(px, py)
	best, face := math.Inf(1), -1
	var bp V3
	// left wall: plane spanned by down and left axes; its normal is the right axis
	normals := [3]int{2, 1, 0}
	for f := 0; f < 3; f++ {
		N := s.D[normals[f]]
		den := d.Dot(N)
		if math.Abs(den) < 1e-12 {
			continue
		}
		t := s.V.Dot(N) / den
		if t <= 0 || t >= best {
			continue
		}
		P := d.Mul(t).Sub(s.V)
		w := V3{P.Dot(s.D[0]), P.Dot(s.D[1]), P.Dot(s.D[2])}
		w[normals[f]] = 0
		if w[0] < -1e-9 || w[1] < -1e-9 || w[2] < -1e-9 {
			continue
		}
		best, face, bp = t, f, w
	}
	return face, bp
}

var faceNormal = [3]V3{{0, 0, 1}, {0, 1, 0}, {1, 0, 0}}

// faceUV returns 2D coordinates on a face: (along the seam that leaves the
// vertex sideways or down, distance from the other seam).
func faceUV(face int, p V3) (float64, float64) {
	switch face {
	case 0:
		return p[1], p[0] // left wall: left, down
	case 1:
		return p[2], p[0] // right wall: right, down
	default:
		return p[1], p[2] // ceiling: left, right
	}
}

// ---------------------------------------------------------------- helpers

func clamp01(v float64) float64 { return math.Max(0, math.Min(1, v)) }
func frac(v float64) float64    { return v - math.Floor(v) }
func smooth(e0, e1, x float64) float64 {
	t := clamp01((x - e0) / (e1 - e0))
	return t * t * (3 - 2*t)
}

// lineMask is ~1 within width w of every multiple of spacing.
func lineMask(v, spacing, w float64) float64 {
	d := math.Abs(frac(v/spacing+0.5)-0.5) * spacing
	return 1 - smooth(w*0.5, w, d)
}

func hsv(h, s, v float64) V3 {
	h = frac(h) * 6
	i := math.Floor(h)
	f := h - i
	p, q, t := v*(1-s), v*(1-s*f), v*(1-s*(1-f))
	switch int(i) {
	case 0:
		return V3{v, t, p}
	case 1:
		return V3{q, v, p}
	case 2:
		return V3{p, v, t}
	case 3:
		return V3{p, q, v}
	case 4:
		return V3{t, p, v}
	}
	return V3{v, p, q}
}

func mix(a, b V3, t float64) V3 { return a.Mul(1 - t).Add(b.Mul(t)) }

func gamma(c V3) V3 {
	g := func(v float64) float64 { return math.Pow(clamp01(v), 1/2.2) }
	return V3{g(c[0]), g(c[1]), g(c[2])}
}

// ---------------------------------------------------------------- tiny bitmap font

var glyphs = map[rune][7]string{
	'0': {"01110", "10001", "10011", "10101", "11001", "10001", "01110"},
	'1': {"00100", "01100", "00100", "00100", "00100", "00100", "01110"},
	'2': {"01110", "10001", "00001", "00010", "00100", "01000", "11111"},
	'3': {"11110", "00001", "00001", "01110", "00001", "00001", "11110"},
	'4': {"00010", "00110", "01010", "10010", "11111", "00010", "00010"},
	'5': {"11111", "10000", "11110", "00001", "00001", "10001", "01110"},
	'6': {"00110", "01000", "10000", "11110", "10001", "10001", "01110"},
	'7': {"11111", "00001", "00010", "00100", "01000", "01000", "01000"},
	'8': {"01110", "10001", "10001", "01110", "10001", "10001", "01110"},
	'9': {"01110", "10001", "10001", "01111", "00001", "00010", "01100"},
	'C': {"01110", "10001", "10000", "10000", "10000", "10001", "01110"},
	'E': {"11111", "10000", "10000", "11110", "10000", "10000", "11111"},
	'F': {"11111", "10000", "10000", "11110", "10000", "10000", "10000"},
	'G': {"01110", "10001", "10000", "10111", "10001", "10001", "01111"},
	'H': {"10001", "10001", "10001", "11111", "10001", "10001", "10001"},
	'I': {"01110", "00100", "00100", "00100", "00100", "00100", "01110"},
	'L': {"10000", "10000", "10000", "10000", "10000", "10000", "11111"},
	'N': {"10001", "11001", "10101", "10011", "10001", "10001", "10001"},
	'R': {"11110", "10001", "10001", "11110", "10100", "10010", "10001"},
	'T': {"11111", "00100", "00100", "00100", "00100", "00100", "00100"},
	'X': {"10001", "10001", "01010", "00100", "01010", "10001", "10001"},
	'Y': {"10001", "10001", "01010", "00100", "00100", "00100", "00100"},
}

// textMask reports whether text-local point (u right, w down) is inside a
// glyph of s, with cell size per font pixel.
func textMask(s string, u, w, cell float64) bool {
	if u < 0 || w < 0 {
		return false
	}
	col, row := int(u/cell), int(w/cell)
	if row >= 7 {
		return false
	}
	ci, cx := col/6, col%6
	if cx == 5 || ci >= len(s) {
		return false
	}
	g, ok := glyphs[rune(s[ci])]
	return ok && g[row][cx] == '1'
}

// ---------------------------------------------------------------- effects

// An effect colors a surface point at loop phase t in [0,1).
type Effect func(face int, p V3, t float64) V3

type clip struct {
	name, desc string
	fx         func(*Scene) Effect
}

var clips = []clip{
	{"calibrate", "face colors, 25 cm grid, seams and labels: check alignment", fxCalibrate},
	{"sweep", "planes of light sweep through the room", fxSweep},
	{"ripples", "two wave sources in mid-air, interfering on all three surfaces", fxRipples},
	{"shadows", "two colored lights; shadows of an invisible spinning cube and bouncing ball", fxShadows},
	{"cubes", "nested cube shells flowing out of the corner", fxCubes},
	{"neon", "glowing seams and grid with pulses running out of the corner", fxNeon},
	{"sky-window", "an opening in the corner onto a snowy moonlit sky, holiday lights around the rim", fxSkyWindow},
	{"sky-full", "the snowy moonlit sky filling the whole projection", fxSkyFull},
}

func fxCalibrate(s *Scene) Effect {
	base := [3]V3{{0.10, 0.18, 0.50}, {0.10, 0.42, 0.18}, {0.50, 0.14, 0.12}}
	return func(face int, p V3, t float64) V3 {
		u, v := faceUV(face, p)
		c := base[face]
		g := math.Max(lineMask(u, 0.25, 0.012), lineMask(v, 0.25, 0.012))
		c = mix(c, V3{0.8, 0.8, 0.8}, g*0.6)
		m := math.Max(lineMask(u, 1, 0.02), lineMask(v, 1, 0.02))
		c = mix(c, V3{1, 1, 1}, m)
		seam := 1 - smooth(0.02, 0.035, math.Min(u, v))
		c = mix(c, V3{1, 0.9, 0.1}, seam)
		r := p.Len()
		pulse := 0.06 * (1 + 0.4*math.Sin(2*math.Pi*t*4))
		c = mix(c, V3{1, 1, 1}, 1-smooth(pulse*0.8, pulse, r))
		cell := 0.022
		switch face {
		case 0:
			if textMask("LEFT", 0.8-p[1], p[0]-0.3, cell) {
				c = V3{1, 1, 1}
			}
		case 1:
			if textMask("RIGHT", p[2]-0.15, p[0]-0.3, cell) {
				c = V3{1, 1, 1}
			}
		case 2:
			x := (p[2]-p[1])/math.Sqrt2 + 7*6*cell/2
			y := 0.62 - (p[1]+p[2])/math.Sqrt2
			if textMask("CEILING", x, y, cell) {
				c = V3{1, 1, 1}
			}
		}
		return c
	}
}

func fxSweep(s *Scene) Effect {
	diag := V3{1, 1, 1}.Norm()
	return func(face int, p V3, t float64) V3 {
		u, v := faceUV(face, p)
		c := V3{0.015, 0.015, 0.03}
		c = c.Add(V3{0.04, 0.04, 0.07}.Mul(math.Max(lineMask(u, 0.5, 0.01), lineMask(v, 0.5, 0.01))))
		glow := func(dist, core float64, col V3) V3 {
			d := math.Abs(dist)
			return col.Mul(math.Exp(-(d*d)/(core*core)) + 0.35*math.Exp(-d/0.12))
		}
		// two planes perpendicular to the room diagonal, expanding from the corner
		for k := 0; k < 2; k++ {
			ph := frac(t*2 + float64(k)*0.5)
			d := ph * 3.2
			fade := math.Sin(math.Pi * ph)
			c = c.Add(glow(p.Dot(diag)-d, 0.02, V3{0.1, 0.9, 1.0}).Mul(fade))
		}
		// a vertical plane rotating around the vertical seam
		th := 2 * math.Pi * t
		n := V3{0, math.Cos(th), math.Sin(th)}
		c = c.Add(glow(p.Dot(n)-0.15*math.Sin(2*th), 0.015, V3{1.0, 0.2, 0.8}))
		// a horizontal plane moving down and up the walls
		h := 0.2 + 1.4*(0.5-0.5*math.Cos(2*math.Pi*t*2))
		c = c.Add(glow(p[0]-h, 0.02, V3{1.0, 0.7, 0.1}))
		return c
	}
}

func fxRipples(s *Scene) Effect {
	return func(face int, p V3, t float64) V3 {
		a := 2 * math.Pi * t
		s1 := V3{0.55, 0.5, 0.5}
		s2 := V3{0.9 + 0.3*math.Sin(a), 0.9 + 0.4*math.Cos(a), 0.9 - 0.4*math.Cos(a)}
		r1, r2 := p.Sub(s1).Len(), p.Sub(s2).Len()
		w1 := 0.5 + 0.5*math.Cos(2*math.Pi*(r1/0.22-t*8))
		w2 := 0.5 + 0.5*math.Cos(2*math.Pi*(r2/0.30-t*6))
		w1 = math.Pow(w1, 6) / (1 + r1*0.8)
		w2 = math.Pow(w2, 6) / (1 + r2*0.8)
		c := hsv(0.55+0.1*math.Sin(a), 0.8, 1).Mul(w1).Add(hsv(0.9+0.1*math.Cos(a), 0.7, 1).Mul(w2))
		return c.Add(V3{0.01, 0.01, 0.02})
	}
}

func rodrigues(axis V3, ang float64) [3]V3 {
	k := axis.Norm()
	c, s := math.Cos(ang), math.Sin(ang)
	var m [3]V3
	for i := 0; i < 3; i++ {
		var e V3
		e[i] = 1
		// rotate basis vector e
		r := e.Mul(c).Add(k.Cross(e).Mul(s)).Add(k.Mul(k.Dot(e) * (1 - c)))
		for j := 0; j < 3; j++ {
			m[j][i] = r[j]
		}
	}
	return m // rows
}

func mulM(m [3]V3, v V3) V3 { return V3{m[0].Dot(v), m[1].Dot(v), m[2].Dot(v)} }

// segment p->p+d (t in (0,1)) against a sphere
func hitSphere(p, d, c V3, r float64) bool {
	oc := p.Sub(c)
	a, b, cc := d.Dot(d), 2*oc.Dot(d), oc.Dot(oc)-r*r
	disc := b*b - 4*a*cc
	if disc < 0 {
		return false
	}
	sq := math.Sqrt(disc)
	t1, t2 := (-b-sq)/(2*a), (-b+sq)/(2*a)
	return (t1 > 1e-4 && t1 < 1) || (t2 > 1e-4 && t2 < 1)
}

// segment against an oriented box (rows of rot map world to local)
func hitBox(p, d, center V3, half float64, rot [3]V3) bool {
	o := mulM(rot, p.Sub(center))
	dir := mulM(rot, d)
	tmin, tmax := 1e-4, 1.0
	for i := 0; i < 3; i++ {
		if math.Abs(dir[i]) < 1e-12 {
			if o[i] < -half || o[i] > half {
				return false
			}
			continue
		}
		t1, t2 := (-half-o[i])/dir[i], (half-o[i])/dir[i]
		if t1 > t2 {
			t1, t2 = t2, t1
		}
		tmin, tmax = math.Max(tmin, t1), math.Min(tmax, t2)
		if tmin > tmax {
			return false
		}
	}
	return true
}

func fxShadows(s *Scene) Effect {
	return func(face int, p V3, t float64) V3 {
		a := 2 * math.Pi * t
		lights := []struct {
			pos V3
			col V3
		}{
			{V3{1.5 + 0.3*math.Sin(a), 2.2 + 0.5*math.Cos(a), 1.6 + 0.5*math.Sin(a)}, V3{1.0, 0.72, 0.42}},
			{V3{1.4 - 0.3*math.Sin(a), 1.6 - 0.5*math.Sin(a), 2.2 + 0.5*math.Cos(a)}, V3{0.35, 0.55, 1.0}},
		}
		rot := rodrigues(V3{1, 0.6, 0.3}, a*2)
		cube, half := V3{0.6, 0.55, 0.5}, 0.1
		ball := V3{0.35 + 0.5*math.Abs(math.Sin(a*2)), 0.35, 0.8}
		n := faceNormal[face]
		c := V3{0.05, 0.05, 0.06}
		for _, L := range lights {
			d := L.pos.Sub(p)
			dist := d.Len()
			lam := math.Max(0, n.Dot(d.Mul(1/dist)))
			if lam == 0 {
				continue
			}
			if hitBox(p, d, cube, half, rot) || hitSphere(p, d, ball, 0.07) {
				continue
			}
			c = c.Add(L.col.Mul(lam * 2.4 / (1 + dist*dist*0.35)))
		}
		return gamma(c.Mul(0.85))
	}
}

func fxCubes(s *Scene) Effect {
	tones := [3]float64{0.55, 0.28, 0.95} // left, right, ceiling as lit from above-left
	return func(face int, p V3, t float64) V3 {
		u, v := faceUV(face, p)
		m := math.Max(u, v)
		const size, perLoop = 0.28, 6.0
		x := m/size - t*perLoop
		k := math.Floor(x)
		f := x - k
		ki := int(math.Mod(k, 6))
		if ki < 0 {
			ki += 6
		}
		tone := tones[face]
		if ki%2 == 1 {
			tone = tones[(face+1)%3]
		}
		c := hsv(float64(ki)/6, 0.55, 1).Mul(tone)
		edge := 1 - smooth(0.03, 0.06, math.Min(f, 1-f))
		c = mix(c, V3{0.02, 0.02, 0.02}, edge)
		seam := 1 - smooth(0.01, 0.02, math.Min(u, v))
		return mix(c, V3{0.02, 0.02, 0.02}, seam*0.8)
	}
}

func fxNeon(s *Scene) Effect {
	return func(face int, p V3, t float64) V3 {
		u, v := faceUV(face, p)
		c := V3{0.01, 0.0, 0.03}
		g := math.Max(lineMask(u, 0.3, 0.008), lineMask(v, 0.3, 0.008))
		r := p.Len()
		wave := math.Pow(0.5+0.5*math.Cos(2*math.Pi*(r/1.2-t*4)), 8)
		c = c.Add(V3{0.6, 0.1, 0.9}.Mul(g * (0.15 + 0.85*wave)))
		dSeam := math.Min(u, v)
		along := math.Max(u, v)
		seamGlow := math.Exp(-(dSeam*dSeam)/(0.012*0.012)) + 0.4*math.Exp(-dSeam/0.05)
		pulse := math.Pow(0.5+0.5*math.Cos(2*math.Pi*(along/0.6-t*10)), 16)
		c = c.Add(V3{0.1, 0.9, 1.0}.Mul(seamGlow * (0.35 + 1.2*pulse)))
		return c
	}
}

// ---------------------------------------------------------------- rendering

type sample struct {
	face int8
	p    V3
}

// precompute the surface hit for every subsample; geometry never changes.
func buildHits(s *Scene) []sample {
	W, H, ss := s.cfg.Width, s.cfg.Height, s.cfg.SS
	out := make([]sample, W*H*ss*ss)
	parallelRows(H, func(y int) {
		for x := 0; x < W; x++ {
			for j := 0; j < ss; j++ {
				for i := 0; i < ss; i++ {
					px := float64(x) + (float64(i)+0.5)/float64(ss)
					py := float64(y) + (float64(j)+0.5)/float64(ss)
					f, p := s.hit(px, py)
					out[((y*W+x)*ss+j)*ss+i] = sample{int8(f), p}
				}
			}
		}
	})
	return out
}

func parallelRows(h int, fn func(y int)) {
	var wg sync.WaitGroup
	rows := make(chan int, h)
	for y := 0; y < h; y++ {
		rows <- y
	}
	close(rows)
	for w := 0; w < runtime.NumCPU(); w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for y := range rows {
				fn(y)
			}
		}()
	}
	wg.Wait()
}

func renderFrame(s *Scene, hits []sample, fx Effect, t float64, buf []byte) {
	W, H, ss := s.cfg.Width, s.cfg.Height, s.cfg.SS
	n := float64(ss * ss)
	parallelRows(H, func(y int) {
		for x := 0; x < W; x++ {
			var acc V3
			base := (y*W + x) * ss * ss
			for k := 0; k < ss*ss; k++ {
				h := hits[base+k]
				if h.face >= 0 {
					acc = acc.Add(fx(int(h.face), h.p, t))
				}
			}
			acc = acc.Mul(1 / n)
			o := (y*W + x) * 3
			buf[o] = byte(clamp01(acc[0])*255 + 0.5)
			buf[o+1] = byte(clamp01(acc[1])*255 + 0.5)
			buf[o+2] = byte(clamp01(acc[2])*255 + 0.5)
		}
	})
}

func encoder(cfg Config, out string) (io.WriteCloser, *exec.Cmd, error) {
	cmd := exec.Command("ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
		"-f", "rawvideo", "-pix_fmt", "rgb24", "-s", fmt.Sprintf("%dx%d", cfg.Width, cfg.Height),
		"-r", fmt.Sprint(cfg.FPS), "-i", "-",
		"-an", "-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", fmt.Sprint(cfg.CRF),
		"-pix_fmt", "yuv420p", "-g", fmt.Sprint(cfg.FPS*2), "-movflags", "+faststart", out)
	cmd.Stderr = os.Stderr
	w, err := cmd.StdinPipe()
	if err != nil {
		return nil, nil, err
	}
	return w, cmd, cmd.Start()
}

// inFrame reports whether a world point lands inside the projector picture.
func (s *Scene) inFrame(p V3) bool {
	cam := s.V.Add(s.D[0].Mul(p[0])).Add(s.D[1].Mul(p[1])).Add(s.D[2].Mul(p[2]))
	if cam[2] <= 0 {
		return false
	}
	x, y := s.project(cam)
	return x >= 0 && y >= 0 && x < float64(s.cfg.Width) && y < float64(s.cfg.Height)
}

// segmentIn checks points along a world segment.
func (s *Scene) segmentIn(a, b V3) bool {
	for i := 0; i <= 24; i++ {
		if !s.inFrame(a.Add(b.Sub(a).Mul(float64(i) / 24))) {
			return false
		}
	}
	return true
}

// fitMask finds the frame with the most area that fits in the projector
// picture: each wall a rectangle w out from the corner and d down from the
// ceiling; on the ceiling an L-shaped band c deep along both seams (c <= w),
// which becomes a full w-square when the picture covers enough ceiling.
func (s *Scene) fitMask() (w, d, c float64) {
	wallsFit := func(w, d float64) bool {
		return s.segmentIn(V3{0, w, 0}, V3{d, w, 0}) && s.segmentIn(V3{d, 0, 0}, V3{d, w, 0}) &&
			s.segmentIn(V3{0, 0, w}, V3{d, 0, w}) && s.segmentIn(V3{d, 0, 0}, V3{d, 0, w})
	}
	ceilFits := func(w, c float64) bool {
		return s.segmentIn(V3{0, w, 0}, V3{0, w, c}) && s.segmentIn(V3{0, c, c}, V3{0, w, c}) &&
			s.segmentIn(V3{0, 0, w}, V3{0, c, w}) && s.segmentIn(V3{0, c, c}, V3{0, c, w})
	}
	best := 0.0
	for wi := 0.05; wi <= 6; wi += 0.02 {
		di := 0.0
		for x := 0.05; x <= 6 && wallsFit(wi, x); x += 0.02 {
			di = x
		}
		if di == 0 {
			break
		}
		ci := 0.0
		for x := 0.02; x <= wi && ceilFits(wi, x); x += 0.02 {
			ci = x
		}
		if a := 2*wi*di + 2*wi*ci - ci*ci; a > best {
			best, w, d, c = a, wi, di, ci
		}
	}
	return w * 0.97, d * 0.97, c * 0.97
}

func maskEffect(fx Effect, w, d, c float64) Effect {
	return func(face int, p V3, t float64) V3 {
		u, v := faceUV(face, p)
		switch face {
		case 0, 1: // walls: u along the ceiling seam, v down from the ceiling
			if u > w || v > d {
				return V3{}
			}
		default: // ceiling: L-shaped band along both seams
			if !((u <= w && v <= c) || (v <= w && u <= c)) {
				return V3{}
			}
		}
		return fx(face, p, t)
	}
}

func renderClip(s *Scene, hits []sample, c clip, outDir string) error {
	cfg := s.cfg
	out := filepath.Join(outDir, "corner-"+c.name+".mp4")
	w, cmd, err := encoder(cfg, out)
	if err != nil {
		return err
	}
	bw := bufio.NewWriterSize(w, 1<<20)
	buf := make([]byte, cfg.Width*cfg.Height*3)
	frames := int(math.Round(cfg.Seconds * float64(cfg.FPS)))
	fx := c.fx(s)
	if s.maskW > 0 {
		fx = maskEffect(fx, s.maskW, s.maskD, s.maskC)
	}
	start := time.Now()
	for i := 0; i < frames; i++ {
		renderFrame(s, hits, fx, float64(i)/float64(frames), buf)
		if _, err := bw.Write(buf); err != nil {
			return err
		}
	}
	bw.Flush()
	w.Close()
	if err := cmd.Wait(); err != nil {
		return err
	}
	log.Printf("%-10s %s  (%d frames, %s)", c.name, out, frames, time.Since(start).Round(time.Second))
	return nil
}

// measure: a pixel grid with coordinates, for reading where the corner lands.
func renderMeasure(cfg Config, outDir string) error {
	W, H := cfg.Width, cfg.Height
	img := image.NewRGBA(image.Rect(0, 0, W, H))
	for y := 0; y < H; y++ {
		for x := 0; x < W; x++ {
			c := color.RGBA{0, 0, 0, 255}
			switch {
			case x%100 == 0 || y%100 == 0 || x == W-1 || y == H-1:
				c = color.RGBA{255, 255, 255, 255}
			case x%50 == 0 || y%50 == 0:
				c = color.RGBA{0, 150, 255, 255}
			case x%10 == 0 || y%10 == 0:
				c = color.RGBA{60, 60, 60, 255}
			}
			img.Set(x, y, c)
		}
	}
	label := func(s string, x0, y0 int, col color.RGBA) {
		const cell = 3
		for y := 0; y < 7*cell; y++ {
			for x := 0; x < len(s)*6*cell; x++ {
				if textMask(s, float64(x)+0.5, float64(y)+0.5, cell) {
					px, py := x0+x, y0+y
					if px >= 0 && px < W && py >= 0 && py < H {
						img.Set(px, py, col)
					}
				}
			}
		}
	}
	for x := 100; x < W; x += 100 {
		for y := 100; y < H; y += 200 {
			label(fmt.Sprint(x), x+4, y+4, color.RGBA{255, 220, 0, 255})
		}
	}
	for y := 100; y < H; y += 100 {
		for x := 200; x < W; x += 400 {
			label(fmt.Sprint(y), x+4, y+28, color.RGBA{0, 255, 120, 255})
		}
	}
	label("X", 8, 8, color.RGBA{255, 220, 0, 255})
	label("Y", 8, 34, color.RGBA{0, 255, 120, 255})
	pngPath := filepath.Join(outDir, "corner-measure.png")
	f, err := os.Create(pngPath)
	if err != nil {
		return err
	}
	if err := png.Encode(f, img); err != nil {
		f.Close()
		return err
	}
	f.Close()
	// also as a short looping video, so the same mpv command plays it
	mp4 := filepath.Join(outDir, "corner-measure.mp4")
	cmd := exec.Command("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-i", pngPath,
		"-t", "4", "-r", fmt.Sprint(cfg.FPS), "-an", "-c:v", "libx264", "-tune", "stillimage", "-pix_fmt", "yuv420p",
		"-crf", "18", "-movflags", "+faststart", mp4)
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return err
	}
	log.Printf("%-10s %s and %s", "measure", pngPath, mp4)
	return nil
}

func main() {
	configPath := flag.String("config", "", "JSON config (default: built-in example layout)")
	outDir := flag.String("out", "media/corner", "output directory")
	only := flag.String("only", "", "comma-separated clip names (measure,"+clipNames()+")")
	seconds := flag.Float64("seconds", 0, "override loop length")
	viewDir := flag.String("view", "", "viewer-correct mode: directory with projcam.f32 + rect.json from structured light")
	flag.Parse()

	cfg := defaultConfig()
	if *configPath != "" {
		b, err := os.ReadFile(*configPath)
		if err != nil {
			log.Fatal(err)
		}
		if err := json.Unmarshal(b, &cfg); err != nil {
			log.Fatalf("%s: %v", *configPath, err)
		}
	}
	if *seconds > 0 {
		cfg.Seconds = *seconds
	}
	if cfg.SS < 1 {
		cfg.SS = 1
	}
	if err := os.MkdirAll(*outDir, 0o755); err != nil {
		log.Fatal(err)
	}
	want := map[string]bool{}
	for _, n := range strings.Split(*only, ",") {
		if n = strings.TrimSpace(n); n != "" {
			want[n] = true
		}
	}
	sel := func(n string) bool { return len(want) == 0 || want[n] }

	if *viewDir != "" {
		m, err := loadViewMap(*viewDir, cfg.Width, cfg.Height)
		if err != nil {
			log.Fatal(err)
		}
		if err := renderViewClip(cfg, m, "sky", viewSky(m, cfg.Seconds), *outDir); err != nil {
			log.Fatal(err)
		}
		return
	}
	if sel("measure") {
		if err := renderMeasure(cfg, *outDir); err != nil {
			log.Fatal(err)
		}
	}
	if len(want) == 1 && want["measure"] {
		return
	}

	s, err := solve(cfg)
	if err != nil {
		log.Fatal(err)
	}
	angle := func(a, b V3) float64 { return math.Acos(a.Dot(b)) * 180 / math.Pi }
	log.Printf("solved: projector at %.2f m below the ceiling, %.2f m from the right wall, %.2f m from the left wall (scale from distance=%.1f m)",
		s.Cam[0], s.Cam[1], s.Cam[2], cfg.Distance)
	log.Printf("check: seam axes at %.1f°, %.1f°, %.1f° (should be 90)", angle(s.D[0], s.D[1]), angle(s.D[0], s.D[2]), angle(s.D[1], s.D[2]))

	t0 := time.Now()
	if s.cfg.Mask == nil || *s.cfg.Mask {
		w, d, cd := s.fitMask()
		if s.cfg.MaskWidth > 0 {
			w = s.cfg.MaskWidth
		}
		if s.cfg.MaskDepth > 0 {
			d = s.cfg.MaskDepth
		}
		if cd > w {
			cd = w
		}
		s.maskW, s.maskD, s.maskC = w, d, cd
		log.Printf("mask: walls %.2f m out from the corner and %.2f m down; ceiling band %.2f m deep", w, d, cd)
	}
	hits := buildHits(s)
	log.Printf("surface map: %s", time.Since(t0).Round(time.Millisecond))
	for _, c := range clips {
		if !sel(c.name) {
			continue
		}
		if err := renderClip(s, hits, c, *outDir); err != nil {
			log.Fatalf("%s: %v", c.name, err)
		}
	}
}

func clipNames() string {
	var n []string
	for _, c := range clips {
		n = append(n, c.name)
	}
	return strings.Join(n, ",")
}
