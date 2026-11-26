package main

import "math"

// A view "through" the corner into a snowy, moonlit night sky.
//
// The sky is rendered for a viewer's eye (default: the projector's position,
// or Config.Eye). For each surface point we take the ray from the eye through
// that point and keep going: sky, moon, stars and clouds come from the ray's
// direction; snowflakes sit on planes 4 to 15 m beyond the eye, so nearer
// flakes move faster and the opening reads as depth.

// ---------------------------------------------------------------- noise

func hash2(x, y float64) float64 {
	h := math.Sin(x*127.1+y*311.7) * 43758.5453
	return h - math.Floor(h)
}

func vnoise(x, y float64) float64 {
	ix, iy := math.Floor(x), math.Floor(y)
	fx, fy := x-ix, y-iy
	ux, uy := fx*fx*(3-2*fx), fy*fy*(3-2*fy)
	a, b := hash2(ix, iy), hash2(ix+1, iy)
	c, d := hash2(ix, iy+1), hash2(ix+1, iy+1)
	return a + (b-a)*ux + (c-a)*uy + (a-b-c+d)*ux*uy
}

func fbm(x, y float64) float64 {
	v, amp := 0.0, 0.5
	for i := 0; i < 5; i++ {
		v += amp * vnoise(x, y)
		x, y = x*2.03+17.1, y*2.03+9.7
		amp *= 0.5
	}
	return v
}

// ---------------------------------------------------------------- sky

type skyView struct {
	eye, c, u, r V3 // eye position; view forward, up, right (world coords)
	moon         V3
	flakes       []flakeLayer
	seconds      float64
}

type flakeLayer struct {
	depth, cell, radius, bright float64
	cellsPerLoop                float64 // integer, so the loop is seamless
}

func newSkyView(s *Scene, moonRight, moonUp float64) *skyView {
	eye := s.Cam
	if s.cfg.Eye != nil {
		eye = V3(*s.cfg.Eye)
	}
	c := eye.Mul(-1).Norm() // look at the corner
	up := V3{-1, 0, 0}      // world x points down
	u := up.Sub(c.Mul(up.Dot(c))).Norm()
	r := u.Cross(c).Norm()
	v := &skyView{eye: eye, c: c, u: u, r: r, seconds: s.cfg.Seconds}
	v.moon = c.Add(r.Mul(moonRight)).Add(u.Mul(moonUp)).Norm()
	v.initFlakes()
	return v
}

func (v *skyView) initFlakes() {
	v.flakes = nil
	for _, l := range []struct{ depth, cell, radius, bright float64 }{
		{4, 0.30, 0.020, 1.0},
		{6, 0.40, 0.026, 0.85},
		{9, 0.60, 0.034, 0.7},
		{14, 0.90, 0.045, 0.55},
	} {
		speed := 0.9 // m/s, a gentle snowfall
		n := math.Max(1, math.Round(speed*v.seconds/l.cell))
		v.flakes = append(v.flakes, flakeLayer{l.depth, l.cell, l.radius, l.bright, n})
	}
}

// color for the ray from the eye through world point p, at loop phase t.
func (v *skyView) color(p V3, t float64) V3 {
	d := p.Sub(v.eye).Norm()
	dc := d.Dot(v.c)
	if dc <= 0.05 {
		return V3{}
	}
	// view-plane coordinates (gnomonic): straight lines stay straight
	x, y := d.Dot(v.r)/dc, d.Dot(v.u)/dc

	// sky: moonlit blue, lighter toward the moon and the horizon
	md := d.Dot(v.moon)
	sky := mix(V3{0.12, 0.20, 0.42}, V3{0.24, 0.34, 0.58}, clamp01(0.5-y*0.6))
	sky = sky.Add(V3{0.30, 0.34, 0.45}.Mul(math.Pow(clamp01(md), 60) * 0.9))

	// stars, twinkling
	sx, sy := x*90, y*90
	cx, cy := math.Floor(sx), math.Floor(sy)
	if h := hash2(cx, cy); h > 0.86 {
		ox, oy := hash2(cx+3.1, cy+7.7), hash2(cx+5.3, cy+1.9)
		dd := math.Hypot(sx-cx-ox, sy-cy-oy)
		tw := 0.55 + 0.45*math.Sin(2*math.Pi*(t*float64(1+int(h*5))+h*13))
		sky = sky.Add(V3{0.9, 0.92, 1}.Mul((1 - smooth(0.04, 0.14, dd)) * tw))
	}

	// moon: bright disc, soft limb, faint maria, and a halo
	ang := math.Acos(math.Max(-1, math.Min(1, md)))
	const moonR = 0.065
	if ang < moonR*1.02 {
		mx, my := (d.Dot(v.r)-v.moon.Dot(v.r))/moonR, (d.Dot(v.u)-v.moon.Dot(v.u))/moonR
		limb := math.Sqrt(clamp01(1 - (mx*mx + my*my)))
		maria := smooth(0.45, 0.75, fbm(mx*2.2+3, my*2.2+5))
		moon := V3{1.0, 0.98, 0.90}.Mul(0.75 + 0.25*limb).Mul(1 - 0.22*maria)
		sky = mix(sky, moon, 1-smooth(moonR*0.97, moonR*1.02, ang))
	} else {
		sky = sky.Add(V3{0.55, 0.6, 0.7}.Mul(0.35 * math.Exp(-(ang-moonR)/0.05)))
	}

	// clouds drifting; crossfade two offsets so the loop is seamless
	cloud := func(ph float64) float64 {
		return fbm(x*2.2+ph*0.9+11, y*3.0+3)
	}
	cv := cloud(t)*(1-t) + cloud(t-1)*t
	cover := smooth(0.40, 0.68, cv)
	moonLit := 0.45 + 0.55*math.Pow(clamp01(md), 30)
	sky = mix(sky, V3{0.62, 0.66, 0.78}.Mul(moonLit), cover*0.9)

	// snow: flat layers at increasing depth, each falling a whole number of
	// cells per loop; nearer layers are bigger, brighter and faster.
	for li := len(v.flakes) - 1; li >= 0; li-- {
		l := v.flakes[li]
		tt := l.depth / dc
		fx, fy := tt*d.Dot(v.r), tt*d.Dot(v.u)+l.cell*l.cellsPerLoop*t
		gx, gy := fx/l.cell, fy/l.cell
		ix, iy := math.Floor(gx), math.Floor(gy)
		seed := float64(li) * 31.7
		if hash2(ix+seed, iy) < 0.55 {
			continue
		}
		ox := 0.25 + 0.5*hash2(ix+1.3+seed, iy+4.1)
		oy := 0.25 + 0.5*hash2(ix+8.7+seed, iy+2.3)
		ox += 0.18 * math.Sin(2*math.Pi*(t*2+hash2(ix, iy+seed))) // sway
		dist := math.Hypot(gx-ix-ox, gy-iy-oy) * l.cell
		a := 1 - smooth(l.radius*0.45, l.radius, dist)
		if a > 0 {
			sky = mix(sky, V3{1, 1, 1}, a*l.bright)
		}
	}
	return sky
}

// ---------------------------------------------------------------- effects

func fxSkyFull(s *Scene) Effect {
	v := newSkyView(s, -0.17, 0.07)
	return func(face int, p V3, t float64) V3 { return v.color(p, t) }
}

// The opening: with a mask, exactly the masked frame (two wall panels);
// otherwise a hexagonal hole openR out from the corner on every surface.
// Holiday lights run around its edges.
func fxSkyWindow(s *Scene) Effect {
	palette := []V3{{1, 0.15, 0.1}, {0.1, 0.9, 0.25}, {1, 0.75, 0.15}, {0.2, 0.45, 1}, {1, 0.95, 0.85}}
	const spacing = 0.09
	if s.maskW > 0 {
		w, d := s.maskW, s.maskD
		inset := 0.035 // lights sit just inside the frame edge
		// put the moon where a point on the left panel is, as seen from the eye
		v := newSkyView(s, 0, 0)
		target := V3{d * 0.35, w * 0.55, 0}
		v.moon = target.Sub(v.eye).Norm()
		return func(face int, p V3, t float64) V3 {
			if face == 2 {
				return V3{}
			}
			u, vv := faceUV(face, p)
			c := v.color(p, t)
			// soft inner shadow along the frame edges
			edge := math.Min(math.Min(w-u, d-vv), vv)
			c = c.Mul(0.6 + 0.4*smooth(0, 0.07, edge))
			// bulbs along the top (vv=inset), outer (u=w-inset) and bottom (vv=d-inset) edges
			best, id := math.Inf(1), 0.0
			try := func(along, across, length, base float64) {
				k := math.Round(along/spacing - 0.5)
				k = math.Max(0, math.Min(k, math.Floor(length/spacing)-1))
				if dist := math.Hypot(along-(k+0.5)*spacing, across); dist < best {
					best, id = dist, base+k
				}
			}
			f := float64(face) * 1000
			try(u, vv-inset, w, f)         // top
			try(vv, u-(w-inset), d, f+300) // outer
			try(u, vv-(d-inset), w, f+600) // bottom
			h := hash2(id, 3.3)
			col := palette[int(h*float64(len(palette)))%len(palette)]
			tw := 0.55 + 0.45*math.Sin(2*math.Pi*(t*float64(2+int(h*4))+h*7))
			bulb := 1 - smooth(0.011, 0.02, best)
			glow := math.Exp(-best/0.03) * 0.5
			return c.Mul(1 - bulb).Add(col.Mul((bulb*1.2 + glow) * tw))
		}
	}
	v := newSkyView(s, -0.06, 0.05)
	const openR = 0.6
	return func(face int, p V3, t float64) V3 {
		u, w := faceUV(face, p)
		m := math.Max(u, w)
		var c V3
		if m < openR {
			c = v.color(p, t)
			c = c.Mul(0.55 + 0.45*smooth(0, 0.08, openR-m))
		}
		best, bi := math.Inf(1), 0.0
		for _, e := range [2][2]float64{{u, w}, {w, u}} {
			along, across := e[1], e[0]-openR
			if along < -spacing/2 || along > openR+spacing/2 {
				continue
			}
			k := math.Round(along/spacing - 0.5)
			k = math.Max(0, math.Min(k, math.Floor(openR/spacing)-1))
			dist := math.Hypot(along-(k+0.5)*spacing, across)
			if dist < best {
				best, bi = dist, k+float64(face)*100+boolF(e[0] == w)*50
			}
		}
		h := hash2(bi, 3.3)
		col := palette[int(h*float64(len(palette)))%len(palette)]
		tw := 0.55 + 0.45*math.Sin(2*math.Pi*(t*float64(2+int(h*4))+h*7))
		bulb := 1 - smooth(0.012, 0.022, best)
		glow := math.Exp(-best/0.035) * 0.55
		return c.Mul(1 - bulb).Add(col.Mul((bulb*1.2 + glow) * tw))
	}
}

func boolF(b bool) float64 {
	if b {
		return 1
	}
	return 0
}
