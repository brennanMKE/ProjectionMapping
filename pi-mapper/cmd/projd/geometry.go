package main

// Corner geometry from four markers placed by eye (no camera needed).
//
// The markers are projector pixels: the vertex where both walls meet the
// ceiling, and one point on each of the three seams. Treating the walls and
// ceiling as three perpendicular planes, this solves the projector's
// orientation, then builds everything skyd needs for a virtual viewer:
//   mesh.bin      projector pixel -> viewer image pixel, 8 px grid
//   uniforms.txt  u_campos, u_minv (viewer ray), u_mask / u_maskd (frame)
//   rect.json     the viewer-image window used by the sky scene
//
// Room coordinates match the rest of the project: meters from the corner,
// x down the vertical seam, y along the left wall/ceiling seam, z along the
// right one. Scale comes from Distance (projector to corner), only used to
// size effects.

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
)

type Corner struct {
	Vertex   [2]float64 `json:"vertex"`
	Down     [2]float64 `json:"down"`
	Left     [2]float64 `json:"left"`
	Right    [2]float64 `json:"right"`
	Throw    float64    `json:"throw"`    // projector throw ratio (distance / image width)
	ShiftY   float64    `json:"shiftY"`   // lens shift: optical centre below image centre, as a fraction of height
	Distance float64    `json:"distance"` // projector to corner, meters (scale only)
	// Viewer, meters: below the ceiling, from the right wall, from the left
	// wall. Zero = at the projector.
	Eye [3]float64 `json:"eye"`
}

func defaultCorner() Corner {
	return Corner{Vertex: [2]float64{640, 300}, Down: [2]float64{640, 700}, Left: [2]float64{200, 80},
		Right: [2]float64{1080, 80}, Throw: 1.3, Distance: 2.5}
}

type v3 [3]float64

func (a v3) add(b v3) v3      { return v3{a[0] + b[0], a[1] + b[1], a[2] + b[2]} }
func (a v3) sub(b v3) v3      { return v3{a[0] - b[0], a[1] - b[1], a[2] - b[2]} }
func (a v3) mul(s float64) v3 { return v3{a[0] * s, a[1] * s, a[2] * s} }
func (a v3) dot(b v3) float64 { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] }
func (a v3) cross(b v3) v3 {
	return v3{a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]}
}
func (a v3) norm() v3        { return a.mul(1 / math.Sqrt(a.dot(a))) }
func (a v3) length() float64 { return math.Sqrt(a.dot(a)) }

type cornerGeo struct {
	w, h      int
	f, cx, cy float64
	V         v3    // corner in projector camera coords
	D         [3]v3 // room axes in projector camera coords
	cam       v3    // projector position, room coords
}

func (g *cornerGeo) ray(px, py float64) v3 { return v3{(px - g.cx) / g.f, (py - g.cy) / g.f, 1} }
func (g *cornerGeo) project(p v3) (float64, float64) {
	return g.f*p[0]/p[2] + g.cx, g.f*p[1]/p[2] + g.cy
}

// toCam maps a room point to projector camera coordinates.
func (g *cornerGeo) toCam(p v3) v3 {
	return g.V.add(g.D[0].mul(p[0])).add(g.D[1].mul(p[1])).add(g.D[2].mul(p[2]))
}

// solveCorner finds the room axes from the vertex and one point per seam.
func solveCorner(c Corner, w, h int) (*cornerGeo, error) {
	g := &cornerGeo{w: w, h: h, f: c.Throw * float64(w), cx: float64(w) / 2, cy: float64(h)/2 + c.ShiftY*float64(h)}
	rv := g.ray(c.Vertex[0], c.Vertex[1])
	pts := [3][2]float64{c.Down, c.Left, c.Right}
	var n [3]v3
	for i, p := range pts {
		if math.Hypot(p[0]-c.Vertex[0], p[1]-c.Vertex[1]) < 20 {
			return nil, fmt.Errorf("the %s dot is too close to the vertex", []string{"wall/wall", "left", "right"}[i])
		}
		n[i] = rv.cross(g.ray(p[0], p[1])).norm()
	}
	e1 := n[0].cross(v3{0, 0, 1})
	if e1.length() < 1e-6 {
		e1 = n[0].cross(v3{1, 0, 0})
	}
	e1 = e1.norm()
	e2 := n[0].cross(e1)
	axes := func(a float64) (v3, v3, v3, float64, bool) {
		d0 := e1.mul(math.Cos(a)).add(e2.mul(math.Sin(a)))
		cr := n[1].cross(d0)
		if cr.length() < 1e-9 {
			return v3{}, v3{}, v3{}, 0, false
		}
		d1 := cr.norm()
		d2 := d0.cross(d1)
		return d0, d1, d2, d2.dot(n[2]), true
	}
	const steps = 3600
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
	dist := c.Distance
	if dist <= 0 {
		dist = 2.5
	}
	g.V = rv.norm().mul(dist)
	for _, a := range roots {
		d0, d1, d2, _, _ := axes(a)
		base := [3]v3{d0, d1, d2}
		for signs := 0; signs < 8; signs++ {
			var D [3]v3
			ok := true
			for i := 0; i < 3; i++ {
				D[i] = base[i]
				if signs&(1<<i) != 0 {
					D[i] = D[i].mul(-1)
				}
				qx, qy := g.project(g.V.add(D[i].mul(0.01)))
				if (qx-c.Vertex[0])*(pts[i][0]-c.Vertex[0])+(qy-c.Vertex[1])*(pts[i][1]-c.Vertex[1]) <= 0 {
					ok = false
				}
				if g.V.mul(-1).dot(D[i]) <= 0 {
					ok = false
				}
			}
			// the room is (down, left, right): that frame is left-handed in
			// camera coordinates; the mirror image means left/right are swapped
			if ok && D[0].cross(D[1]).dot(D[2]) > 0 {
				ok = false
			}
			if ok {
				g.D = D
				g.cam = v3{-g.V.dot(D[0]), -g.V.dot(D[1]), -g.V.dot(D[2])}
				return g, nil
			}
		}
	}
	return nil, errors.New("these dots don't describe a square corner; check that each dot is on the right edge (left/right not swapped)")
}

// hit returns the room point a projector pixel lands on.
func (g *cornerGeo) hit(px, py float64) (v3, bool) {
	d := g.ray(px, py)
	best, ok := math.Inf(1), false
	var bp v3
	normals := [3]int{2, 1, 0}
	for f := 0; f < 3; f++ {
		N := g.D[normals[f]]
		den := d.dot(N)
		if math.Abs(den) < 1e-12 {
			continue
		}
		t := g.V.dot(N) / den
		if t <= 0 || t >= best {
			continue
		}
		P := d.mul(t).sub(g.V)
		w := v3{P.dot(g.D[0]), P.dot(g.D[1]), P.dot(g.D[2])}
		w[normals[f]] = 0
		if w[0] < -1e-9 || w[1] < -1e-9 || w[2] < -1e-9 {
			continue
		}
		best, ok, bp = t, true, w
	}
	return bp, ok
}

func (g *cornerGeo) inFrame(p v3) bool {
	c := g.toCam(p)
	if c[2] <= 0 {
		return false
	}
	x, y := g.project(c)
	return x >= 1 && y >= 1 && x < float64(g.w-1) && y < float64(g.h-1)
}

// fitMask: the largest frame (width along each seam, depth down the walls)
// that fits in the picture; walls at least half as deep as wide.
func (g *cornerGeo) fitMask() (wd, dd float64) {
	fits := func(W, D float64) bool {
		for i := 0; i <= 24; i++ {
			a, b := W*float64(i)/24, D*float64(i)/24
			for _, p := range []v3{{0, a, W}, {0, W, a}, {b, W, 0}, {D, a, 0}, {b, 0, W}, {D, 0, a}} {
				if !g.inFrame(p) {
					return false
				}
			}
		}
		return true
	}
	best := 0.0
	for W := 0.05; W < 4; W += 0.01 {
		D := 0.0
		for fits(W, D+0.01) && D < 4 {
			D += 0.01
		}
		if D == 0 {
			break
		}
		if a := W*W + 2*W*D; D >= 0.5*W && a > best {
			best, wd, dd = a, W, D
		}
	}
	return wd * 0.98, dd * 0.98
}

// writeGeometry builds the virtual viewer and writes mesh.bin, uniforms.txt
// and rect.json into dir.
func writeGeometry(c Corner, w, h int, dir string) (string, error) {
	g, err := solveCorner(c, w, h)
	if err != nil {
		return "", err
	}
	eye := g.cam
	if c.Eye[0] > 0 && c.Eye[1] > 0 && c.Eye[2] > 0 {
		eye = v3(c.Eye)
	}
	// virtual viewer camera: looks at the corner, room "up" (-x) is image up
	const vf = 914.0 // same focal length as the webcam, so scenes keep their framing
	fwd := eye.mul(-1).norm()
	up := v3{-1, 0, 0}
	upv := up.sub(fwd.mul(up.dot(fwd))).norm()
	right := upv.cross(fwd).norm()
	toView := func(p v3) (float64, float64, bool) {
		d := p.sub(eye)
		z := d.dot(fwd)
		if z <= 1e-6 {
			return 0, 0, false
		}
		return vf*d.dot(right)/z + 640, vf*-d.dot(upv)/z + 360, true
	}

	// mesh on an 8 px grid
	cols, rows := w/8+1, h/8+1
	var mesh bytes.Buffer
	binary.Write(&mesh, binary.LittleEndian, [2]int32{int32(cols), int32(rows)})
	var minX, minY, maxX, maxY = math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
	type cell struct{ x, y float64 }
	views := make([]cell, 0, cols*rows)
	for r := 0; r < rows; r++ {
		for cc := 0; cc < cols; cc++ {
			px, py := math.Min(float64(cc*8), float64(w-1)), math.Min(float64(r*8), float64(h-1))
			vx, vy := -10000.0, -10000.0
			if p, ok := g.hit(px, py); ok {
				if x, y, ok := toView(p); ok {
					vx, vy = x, y
					minX, minY, maxX, maxY = math.Min(minX, x), math.Min(minY, y), math.Max(maxX, x), math.Max(maxY, y)
				}
			}
			views = append(views, cell{vx, vy})
			binary.Write(&mesh, binary.LittleEndian, [4]float32{float32(px), float32(py), float32(vx), float32(vy)})
		}
	}
	// viewer-image window for the sky scene: the largest rectangle inside
	// the picture's footprint (coarse grid search)
	const G = 16
	gw, gh := 1280/G, 720/G
	cov := make([]bool, gw*gh)
	for r := 0; r < rows-1; r++ {
		for cc := 0; cc < cols-1; cc++ {
			v := views[r*cols+cc]
			if v.x >= 0 && v.y >= 0 && v.x < 1280 && v.y < 720 {
				cov[int(v.y)/G*gw+int(v.x)/G] = true
			}
		}
	}
	// fill isolated gaps
	for y := 1; y < gh-1; y++ {
		for x := 1; x < gw-1; x++ {
			if !cov[y*gw+x] && cov[(y-1)*gw+x] && cov[(y+1)*gw+x] && cov[y*gw+x-1] && cov[y*gw+x+1] {
				cov[y*gw+x] = true
			}
		}
	}
	bestA, rx0, ry0, rx1, ry1 := 0, 0, 0, 0, 0
	for y0 := 0; y0 < gh; y0++ {
		for y1 := y0; y1 < gh; y1++ {
			run := 0
			for x := 0; x < gw; x++ {
				all := true
				for y := y0; y <= y1 && all; y++ {
					all = cov[y*gw+x]
				}
				if all {
					run++
					if a := run * (y1 - y0 + 1); a > bestA {
						bestA, rx0, ry0, rx1, ry1 = a, x-run+1, y0, x, y1
					}
				} else {
					run = 0
				}
			}
		}
	}
	rect := map[string]int{"x0": rx0*G + 8, "y0": ry0*G + 8, "x1": (rx1+1)*G - 8, "y1": (ry1+1)*G - 8}

	mw, md := g.fitMask()
	// u_minv: viewer pixel (u, v, 1) -> ray direction, row-major
	col0, col1 := right.mul(1/vf), upv.mul(-1/vf)
	col2 := fwd.sub(right.mul(640 / vf)).add(upv.mul(360 / vf))
	minv := [9]float64{col0[0], col1[0], col2[0], col0[1], col1[1], col2[1], col0[2], col1[2], col2[2]}
	var uni bytes.Buffer
	fmt.Fprintf(&uni, "# from corner markers (projd geometry.go)\n")
	fmt.Fprintf(&uni, "u_campos %f %f %f\n", eye[0], eye[1], eye[2])
	fmt.Fprintf(&uni, "u_minv")
	for _, v := range minv {
		fmt.Fprintf(&uni, " %.9g", v)
	}
	fmt.Fprintf(&uni, "\nu_mask %f\nu_maskd %f\n", mw, md)

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	rj, _ := json.Marshal(rect)
	cj, _ := json.MarshalIndent(c, "", "  ")
	for name, data := range map[string][]byte{"mesh.bin": mesh.Bytes(), "uniforms.txt": uni.Bytes(), "rect.json": rj, "corner.json": cj} {
		tmp := filepath.Join(dir, name+".tmp")
		if err := os.WriteFile(tmp, data, 0o644); err != nil {
			return "", err
		}
		if err := os.Rename(tmp, filepath.Join(dir, name)); err != nil {
			return "", err
		}
	}
	return fmt.Sprintf("frame %.2f m along each seam, %.2f m down; viewer at %.2f, %.2f, %.2f m", mw, md, eye[0], eye[1], eye[2]), nil
}
