package main

// Viewer-correct rendering ("-view"). Instead of drawing effects on the room's
// surfaces, draw what a viewer should SEE, as a flat picture in the viewer's
// (webcam's) image, then pre-distort it through a measured projector->camera
// map. From the camera's position the corner disappears: the picture looks
// flat and undistorted, like a window.
//
// The map comes from structured light (Gray-code patterns captured by the
// webcam): projcam.f32 holds, for every projector pixel, the camera pixel it
// lands on (float32 x, y; -1 where unknown). rect.json is the camera-space
// rectangle used as the window.

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"time"
)

type viewMap struct {
	w, h   int
	cx, cy []float32
	rect   struct{ X0, Y0, X1, Y1 float64 }
	focal  float64 // webcam focal length in pixels (C925e: about 78 deg diagonal)
}

func loadViewMap(dir string, w, h int) (*viewMap, error) {
	raw, err := os.ReadFile(filepath.Join(dir, "projcam.f32"))
	if err != nil {
		return nil, err
	}
	if len(raw) != w*h*8 {
		return nil, fmt.Errorf("projcam.f32: expected %d bytes, got %d", w*h*8, len(raw))
	}
	m := &viewMap{w: w, h: h, cx: make([]float32, w*h), cy: make([]float32, w*h), focal: 914}
	for i := 0; i < w*h; i++ {
		m.cx[i] = math.Float32frombits(binary.LittleEndian.Uint32(raw[i*8:]))
		m.cy[i] = math.Float32frombits(binary.LittleEndian.Uint32(raw[i*8+4:]))
	}
	b, err := os.ReadFile(filepath.Join(dir, "rect.json"))
	if err != nil {
		return nil, err
	}
	var r struct{ X0, Y0, X1, Y1 float64 }
	if err := json.Unmarshal(b, &r); err != nil {
		return nil, err
	}
	m.rect = r
	return m, nil
}

// at returns the camera position of projector point (x, y), bilinear.
func (m *viewMap) at(x, y float64) (float64, float64, bool) {
	x0, y0 := int(math.Floor(x)), int(math.Floor(y))
	if x0 < 0 || y0 < 0 || x0+1 >= m.w || y0+1 >= m.h {
		return 0, 0, false
	}
	tx, ty := x-float64(x0), y-float64(y0)
	var cx, cy float64
	for _, c := range [4]struct {
		dx, dy int
		wt     float64
	}{{0, 0, (1 - tx) * (1 - ty)}, {1, 0, tx * (1 - ty)}, {0, 1, (1 - tx) * ty}, {1, 1, tx * ty}} {
		i := (y0+c.dy)*m.w + x0 + c.dx
		if m.cx[i] < 0 {
			return 0, 0, false
		}
		cx += float64(m.cx[i]) * c.wt
		cy += float64(m.cy[i]) * c.wt
	}
	return cx, cy, true
}

// View2D colors a camera-space point at loop phase t.
type View2D func(cx, cy, t float64) V3

// viewSky: a window onto the snowy, moonlit sky, framed by holiday lights,
// drawn flat in the camera's image.
func viewSky(m *viewMap, seconds float64) View2D {
	cw, ch := float64(m.w), float64(m.h)
	sky := &skyView{eye: V3{}, c: V3{0, 0, 1}, u: V3{0, -1, 0}, r: V3{1, 0, 0}, seconds: seconds}
	sky.initFlakes()
	r := m.rect
	// moon centred 30% across, 38% down the window
	mx, my := r.X0+0.30*(r.X1-r.X0), r.Y0+0.38*(r.Y1-r.Y0)
	sky.moon = V3{(mx - cw/2) / m.focal, (my - ch/2) / m.focal, 1}.Norm()
	palette := []V3{{1, 0.15, 0.1}, {0.1, 0.9, 0.25}, {1, 0.75, 0.15}, {0.2, 0.45, 1}, {1, 0.95, 0.85}}
	const spacing, inset, rad = 30.0, 9.0, 6.5
	return func(cx, cy, t float64) V3 {
		if cx < r.X0 || cx > r.X1 || cy < r.Y0 || cy > r.Y1 {
			return V3{}
		}
		d := V3{(cx - cw/2) / m.focal, (cy - ch/2) / m.focal, 1}
		c := sky.color(d, t)
		edge := math.Min(math.Min(cx-r.X0, r.X1-cx), math.Min(cy-r.Y0, r.Y1-cy))
		c = c.Mul(0.6 + 0.4*smooth(0, 18, edge))
		// bulbs along all four edges, `inset` px inside the frame
		best, id := math.Inf(1), 0.0
		try := func(along, across, length, base float64) {
			k := math.Round(along/spacing - 0.5)
			k = math.Max(0, math.Min(k, math.Floor(length/spacing)-1))
			off := (length - math.Floor(length/spacing)*spacing) / 2
			if dd := math.Hypot(along-off-(k+0.5)*spacing, across); dd < best {
				best, id = dd, base+k
			}
		}
		w, h := r.X1-r.X0, r.Y1-r.Y0
		try(cx-r.X0, cy-(r.Y0+inset), w, 0)
		try(cx-r.X0, cy-(r.Y1-inset), w, 1000)
		try(cy-r.Y0, cx-(r.X0+inset), h, 2000)
		try(cy-r.Y0, cx-(r.X1-inset), h, 3000)
		hh := hash2(id, 3.3)
		col := palette[int(hh*float64(len(palette)))%len(palette)]
		tw := 0.55 + 0.45*math.Sin(2*math.Pi*(t*float64(2+int(hh*4))+hh*7))
		bulb := 1 - smooth(rad*0.6, rad, best)
		glow := math.Exp(-best/9) * 0.5
		return c.Mul(1 - bulb).Add(col.Mul((bulb*1.2 + glow) * tw))
	}
}

func renderViewClip(cfg Config, m *viewMap, name string, fx View2D, outDir string) error {
	out := filepath.Join(outDir, "view-"+name+".mp4")
	w, cmd, err := encoder(cfg, out)
	if err != nil {
		return err
	}
	bw := bufio.NewWriterSize(w, 1<<20)
	W, H, ss := cfg.Width, cfg.Height, cfg.SS
	// precompute camera coordinates for every subsample
	type pt struct {
		x, y float64
		ok   bool
	}
	pts := make([]pt, W*H*ss*ss)
	parallelRows(H, func(y int) {
		for x := 0; x < W; x++ {
			for j := 0; j < ss; j++ {
				for i := 0; i < ss; i++ {
					cx, cy, ok := m.at(float64(x)+(float64(i)+0.5)/float64(ss)-0.5, float64(y)+(float64(j)+0.5)/float64(ss)-0.5)
					pts[((y*W+x)*ss+j)*ss+i] = pt{cx, cy, ok}
				}
			}
		}
	})
	buf := make([]byte, W*H*3)
	frames := int(math.Round(cfg.Seconds * float64(cfg.FPS)))
	start := time.Now()
	n := float64(ss * ss)
	// Render the flat picture once per frame in camera space (only the window
	// rectangle, plus a margin), then sample it for every projector subsample.
	r := m.rect
	ox, oy := int(r.X0)-2, int(r.Y0)-2
	cwid, chei := int(r.X1-r.X0)+5, int(r.Y1-r.Y0)+5
	cam := make([]V3, cwid*chei)
	sample := func(x, y float64) V3 {
		x -= float64(ox)
		y -= float64(oy)
		x0, y0 := int(math.Floor(x)), int(math.Floor(y))
		if x0 < 0 || y0 < 0 || x0+1 >= cwid || y0+1 >= chei {
			return V3{}
		}
		tx, ty := x-float64(x0), y-float64(y0)
		a := mix(cam[y0*cwid+x0], cam[y0*cwid+x0+1], tx)
		b := mix(cam[(y0+1)*cwid+x0], cam[(y0+1)*cwid+x0+1], tx)
		return mix(a, b, ty)
	}
	for f := 0; f < frames; f++ {
		t := float64(f) / float64(frames)
		parallelRows(chei, func(y int) {
			for x := 0; x < cwid; x++ {
				cam[y*cwid+x] = fx(float64(x+ox), float64(y+oy), t)
			}
		})
		parallelRows(H, func(y int) {
			for x := 0; x < W; x++ {
				var acc V3
				base := (y*W + x) * ss * ss
				for k := 0; k < ss*ss; k++ {
					if p := pts[base+k]; p.ok {
						acc = acc.Add(sample(p.x, p.y))
					}
				}
				acc = acc.Mul(1 / n)
				o := (y*W + x) * 3
				buf[o] = byte(clamp01(acc[0])*255 + 0.5)
				buf[o+1] = byte(clamp01(acc[1])*255 + 0.5)
				buf[o+2] = byte(clamp01(acc[2])*255 + 0.5)
			}
		})
		if _, err := bw.Write(buf); err != nil {
			return err
		}
	}
	bw.Flush()
	w.Close()
	if err := cmd.Wait(); err != nil {
		return err
	}
	log.Printf("view-%s %s (%d frames, %s)", name, out, frames, time.Since(start).Round(time.Second))
	return nil
}
