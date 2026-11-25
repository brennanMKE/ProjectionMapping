// Generative canvas sketches. Each is draw(ctx, w, h, t) where t is seconds
// of *server* time, so the same sketch on two Pis stays in step.
// Add a sketch here and it shows up in the control page.

const TAU = Math.PI * 2;

export const sketches = {
  // Static-ish test card: color bars, a grid, and a moving sweep.
  testcard(ctx, w, h, t) {
    const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
    const bw = w / bars.length;
    bars.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(i * bw, 0, bw + 1, h * 0.7); });
    for (let i = 0; i < 8; i++) {
      const v = Math.round((i / 7) * 255);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect((i * w) / 8, h * 0.7, w / 8 + 1, h * 0.15);
    }
    ctx.fillStyle = '#000';
    ctx.fillRect(0, h * 0.85, w, h * 0.15);
    const x = ((t * 0.25) % 1) * w;
    ctx.fillStyle = '#fff';
    ctx.fillRect(x, h * 0.85, Math.max(2, w / 100), h * 0.15);
    ctx.font = `${Math.round(h * 0.08)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(new Date(t * 1000).toISOString().slice(11, 22), w / 2, h * 0.925);
  },

  // Full-surface hue rotation.
  colorcycle(ctx, w, h, t) {
    const hue = (t * 36) % 360;
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, `hsl(${hue},90%,55%)`);
    g.addColorStop(1, `hsl(${(hue + 60) % 360},90%,45%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  },

  // Expanding rings from the center.
  rings(ctx, w, h, t) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const max = Math.hypot(w, h) / 2;
    ctx.lineWidth = Math.max(4, max / 20);
    for (let i = 0; i < 8; i++) {
      const r = (((t * 0.3 + i / 8) % 1) * max);
      ctx.strokeStyle = `hsl(${(i * 45 + t * 20) % 360},90%,60%)`;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, r, 0, TAU);
      ctx.stroke();
    }
  },

  // Sync check: a bar sweeps once per second and the frame flashes white on
  // each whole second. Put this on both Pis and film them together.
  sync(ctx, w, h, t) {
    const frac = t % 1;
    ctx.fillStyle = frac < 0.05 ? '#fff' : '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f33';
    ctx.fillRect(frac * w, 0, Math.max(4, w / 60), h);
    ctx.fillStyle = frac < 0.05 ? '#000' : '#fff';
    ctx.font = `bold ${Math.round(h * 0.25)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.floor(t) % 100).padStart(2, '0'), w / 2, h / 2);
  },

  // Slow drifting noise-like stripes, good as a moodier fill.
  waves(ctx, w, h, t) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const n = 24;
    for (let i = 0; i < n; i++) {
      const y = (i / n) * h;
      const a = 0.5 + 0.5 * Math.sin(t * 1.3 + i * 0.5);
      ctx.fillStyle = `hsla(${(200 + i * 4 + t * 10) % 360},80%,55%,${a})`;
      ctx.fillRect(0, y, w, h / n + 1);
    }
  },
};
