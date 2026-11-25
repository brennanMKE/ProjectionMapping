// Alignment patterns drawn on top of a surface (they warp with it).
// Corner order matches maptastic's points: 1 top-left, 2 top-right,
// 3 bottom-right, 4 bottom-left.

export const PATTERNS = ['none', 'corners', 'grid', 'crosshair', 'all'];
export const CORNER_COLORS = ['#ff3b30', '#34c759', '#0a84ff', '#ffcc00'];

export function drawPattern(canvas, kind, label) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (kind === 'none') return;
  const all = kind === 'all';
  const lw = Math.max(2, Math.round(Math.min(w, h) / 180));

  if (kind === 'grid' || all) {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = lw;
    const nx = 8, ny = Math.max(2, Math.round((8 * h) / w));
    ctx.beginPath();
    for (let i = 0; i <= nx; i++) { const x = (i / nx) * w; ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let j = 0; j <= ny; j++) { const y = (j / ny) * h; ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    ctx.lineWidth = lw * 3;
    ctx.strokeRect(lw * 1.5, lw * 1.5, w - lw * 3, h - lw * 3);
  }

  if (kind === 'crosshair' || all) {
    ctx.strokeStyle = '#0ff';
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
    ctx.moveTo(0, 0); ctx.lineTo(w, h);
    ctx.moveTo(w, 0); ctx.lineTo(0, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.min(w, h) / 4, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (kind === 'corners' || all) {
    const r = Math.min(w, h) / 7;
    const pts = [[0, 0], [w, 0], [w, h], [0, h]];
    pts.forEach(([x, y], i) => {
      ctx.fillStyle = CORNER_COLORS[i];
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, r * 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.font = `bold ${Math.round(r)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const ix = x === 0 ? r * 0.7 : w - r * 0.7;
      const iy = y === 0 ? r * 0.7 : h - r * 0.7;
      ctx.fillText(String(i + 1), ix, iy);
    });
    if (label) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      const fs = Math.round(Math.min(w, h) / 8);
      ctx.font = `bold ${fs}px sans-serif`;
      const tw = ctx.measureText(label).width;
      ctx.fillRect(w / 2 - tw / 2 - fs / 3, h / 2 - fs * 0.7, tw + (fs * 2) / 3, fs * 1.4);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, w / 2, h / 2);
    }
  }
}
