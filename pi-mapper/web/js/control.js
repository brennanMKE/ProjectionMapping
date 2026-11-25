// Control page: cues, edit mode, layouts, surfaces, a touch corner editor,
// content assignment, and Pi status. Works on a phone.

import { Link } from './link.js';
import { sketches } from './sketches.js';
import { PATTERNS, CORNER_COLORS } from './patterns.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const st = {
  pi: '', role: '',
  layoutName: '', layout: { surfaces: [] }, layouts: [],
  edit: false, pattern: 'none', blackout: false,
  sel: null,     // selected surface id
  corner: 0,     // 0..3, or -1 for whole surface
  step: 1,
  media: [],
  status: null,
  dirty: false,
};

const link = new Link({
  role: 'control',
  name: 'control',
  onMessage,
  onState: (up) => $('#conn').classList.toggle('on', up),
});

function onMessage(m) {
  switch (m.type) {
    case 'welcome':
      st.pi = m.pi; st.role = m.role;
      st.layouts = m.layouts || [];
      st.edit = m.edit; st.pattern = m.pattern; st.blackout = m.blackout;
      setLayout(m.layoutName, m.layout);
      $('#title').textContent = m.pi;
      $('#role').textContent = m.role;
      break;
    case 'layout':
      if (!dragging) setLayout(m.name, m.layout);
      break;
    case 'layouts':
      st.layouts = m.layouts;
      if (m.active) st.layoutName = m.active;
      break;
    case 'edit': st.edit = m.value; break;
    case 'pattern': st.pattern = m.value; break;
    case 'cue':
      if (m.cue === 'blackout') st.blackout = m.value === true;
      break;
    case 'saved':
      st.dirty = false;
      $('#save-state').textContent = `Saved “${m.name}” at ${new Date().toLocaleTimeString()}`;
      break;
    case 'error':
      toast(m.error);
      break;
  }
  render();
}

function setLayout(name, layout) {
  st.layoutName = name;
  st.layout = layout || { surfaces: [] };
  st.layout.surfaces = st.layout.surfaces || [];
  if (!st.layout.surfaces.find((s) => s.id === st.sel)) {
    st.sel = st.layout.surfaces.length ? st.layout.surfaces[0].id : null;
  }
}

function surface() { return st.layout.surfaces.find((s) => s.id === st.sel) || null; }
function rect(w, h) { return [[0, 0], [w, 0], [w, h], [0, h]]; }

function screenSize() {
  // size reported by this Pi's projector page, if it reported recently
  const p = st.status?.projectors?.find((r) => r.from === st.pi && st.status.time - r.received < 15000);
  if (p && p.w && p.h) return { w: p.w, h: p.h };
  if (st.layout.screen?.w) return st.layout.screen;
  return { w: 1920, h: 1080 };
}

// ---- sending layout changes ------------------------------------------------

let liveTimer = null, saveTimer = null;
function changed({ now = false } = {}) {
  st.dirty = true;
  $('#save-state').textContent = 'Saving…';
  st.layout.screen = screenSize();
  if (now) {
    clearTimeout(saveTimer);
    link.send({ type: 'layout', layout: st.layout, persist: true });
    return;
  }
  if (!liveTimer) {
    liveTimer = setTimeout(() => {
      liveTimer = null;
      link.send({ type: 'layout', layout: st.layout, persist: false });
    }, 50);
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => link.send({ type: 'layout', layout: st.layout, persist: true }), 400);
}

// ---- cues & modes -----------------------------------------------------------

$$('[data-cue]').forEach((b) => b.addEventListener('click', () => {
  link.send({ type: 'cue', cue: b.dataset.cue });
}));

$('#edit-btn').addEventListener('click', () => {
  link.send({ type: 'edit', value: !st.edit });
});

PATTERNS.forEach((p) => $('#pattern').add(new Option(p, p)));
$('#pattern').addEventListener('change', (e) => link.send({ type: 'pattern', value: e.target.value }));

// ---- layouts ----------------------------------------------------------------

$('#layouts').addEventListener('change', (e) => link.send({ type: 'activate', name: e.target.value }));
$('#save-as').addEventListener('click', () => {
  const name = prompt('New layout name (letters, digits, - and _):', st.layoutName + '-copy');
  if (name) link.send({ type: 'saveAs', name: name.trim(), layout: st.layout });
});
$('#delete-layout').addEventListener('click', () => {
  const others = st.layouts.filter((n) => n !== st.layoutName);
  if (!others.length) return toast('This is the only layout.');
  const name = prompt(`Delete which layout? (not the active one)\n${others.join(', ')}`);
  if (name && confirm(`Delete layout “${name}”? This cannot be undone.`)) {
    link.send({ type: 'deleteLayout', name: name.trim() });
  }
});

// ---- surfaces ---------------------------------------------------------------

$('#add-surface').addEventListener('click', () => {
  const scr = screenSize();
  const w = 640, h = 360;
  const n = st.layout.surfaces.length;
  const x = Math.round(scr.w / 2 - w / 2 + n * 40), y = Math.round(scr.h / 2 - h / 2 + n * 40);
  const s = {
    id: 's' + Math.random().toString(36).slice(2, 7),
    w, h,
    content: { type: 'canvas', sketch: 'testcard' },
    targetPoints: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
    sourcePoints: rect(w, h),
  };
  st.layout.surfaces.push(s);
  st.sel = s.id;
  changed({ now: true });
  render();
});
$('#remove-surface').addEventListener('click', () => {
  const s = surface();
  if (!s || !confirm(`Remove surface ${s.id}?`)) return;
  st.layout.surfaces = st.layout.surfaces.filter((x) => x !== s);
  st.sel = st.layout.surfaces[0]?.id || null;
  changed({ now: true });
  render();
});
$('#raise-surface').addEventListener('click', () => {
  const s = surface();
  if (!s) return;
  st.layout.surfaces = st.layout.surfaces.filter((x) => x !== s).concat([s]);
  changed({ now: true });
  render();
});

// ---- corner editor ------------------------------------------------------------

const canvas = $('#editor');
const ctx = canvas.getContext('2d');
let dragging = null; // { kind: 'corner'|'move', idx, last:[x,y] }

function toScreen(e, r = canvas.getBoundingClientRect()) {
  const scr = screenSize();
  return [((e.clientX - r.left) / r.width) * scr.w, ((e.clientY - r.top) / r.height) * scr.h];
}
function hitRadius() {
  return 26 * (screenSize().w / canvas.getBoundingClientRect().width);
}
function inQuad(p, q) {
  // convex or not, use ray casting
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const [xi, yi] = q[i], [xj, yj] = q[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

canvas.addEventListener('pointerdown', (e) => {
  const r = canvas.getBoundingClientRect(); // fixed for the whole drag
  const p = toScreen(e, r);
  const R = hitRadius();
  const surfaces = st.layout.surfaces;
  const order = [surface(), ...surfaces.slice().reverse()].filter(Boolean);
  for (const s of order) {
    const i = s.targetPoints.findIndex(([x, y]) => Math.hypot(x - p[0], y - p[1]) < R);
    if (i >= 0) {
      st.sel = s.id; st.corner = i;
      dragging = { kind: 'corner', idx: i, last: p, r };
      break;
    }
  }
  if (!dragging) {
    const hit = order.find((s) => inQuad(p, s.targetPoints));
    if (hit) { st.sel = hit.id; dragging = { kind: 'move', last: p, r }; }
  }
  if (dragging) canvas.setPointerCapture(e.pointerId);
  render();
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const s = surface();
  const p = toScreen(e, dragging.r);
  const dx = p[0] - dragging.last[0], dy = p[1] - dragging.last[1];
  dragging.last = p;
  if (dragging.kind === 'corner') {
    const pt = s.targetPoints[dragging.idx];
    pt[0] += dx; pt[1] += dy;
  } else {
    s.targetPoints.forEach((pt) => { pt[0] += dx; pt[1] += dy; });
  }
  roundPoints(s);
  changed();
  drawEditor();
});
const endDrag = () => {
  if (!dragging) return;
  dragging = null;
  changed({ now: true });
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

function roundPoints(s) {
  s.targetPoints = s.targetPoints.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
}

$$('#corners [data-c]').forEach((b) => b.addEventListener('click', () => {
  st.corner = Number(b.dataset.c);
  render();
}));
$('#step').addEventListener('click', () => {
  st.step = st.step === 1 ? 10 : st.step === 10 ? 0.5 : 1;
  render();
});
$$('.pad [data-d]').forEach((b) => b.addEventListener('click', () => {
  const s = surface();
  if (!s) return;
  const [dx, dy] = b.dataset.d.split(',').map(Number);
  const pts = st.corner < 0 ? s.targetPoints : [s.targetPoints[st.corner]];
  pts.forEach((pt) => { pt[0] += dx * st.step; pt[1] += dy * st.step; });
  roundPoints(s);
  changed();
  drawEditor();
}));
$('#reset-rect').addEventListener('click', () => {
  const s = surface();
  if (!s) return;
  const [x, y] = s.targetPoints[0];
  s.targetPoints = [[x, y], [x + s.w, y], [x + s.w, y + s.h], [x, y + s.h]];
  s.sourcePoints = rect(s.w, s.h);
  changed({ now: true });
  render();
});
$('#flip-h').addEventListener('click', () => {
  const s = surface();
  if (!s) return;
  const sp = s.sourcePoints || rect(s.w, s.h);
  s.sourcePoints = [sp[1], sp[0], sp[3], sp[2]];
  changed({ now: true });
});
$('#rotate').addEventListener('click', () => {
  const s = surface();
  if (!s) return;
  // rotate the quad 90° clockwise around its centroid (same as maptastic's 'r')
  const cx = s.targetPoints.reduce((a, p) => a + p[0], 0) / 4;
  const cy = s.targetPoints.reduce((a, p) => a + p[1], 0) / 4;
  s.targetPoints = s.targetPoints.map(([x, y]) => [cx - (y - cy), cy + (x - cx)]);
  roundPoints(s);
  changed({ now: true });
  render();
});

function drawEditor() {
  const scr = screenSize();
  const cssW = canvas.parentElement.clientWidth;
  const cssH = Math.round((cssW * scr.h) / scr.w);
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.height = cssH + 'px';
  }
  const k = canvas.width / scr.w;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    ctx.beginPath(); ctx.moveTo((i * canvas.width) / 8, 0); ctx.lineTo((i * canvas.width) / 8, canvas.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, (i * canvas.height) / 8); ctx.lineTo(canvas.width, (i * canvas.height) / 8); ctx.stroke();
  }
  ctx.font = `${12 * dpr}px sans-serif`;
  ctx.fillStyle = '#555';
  ctx.fillText(`${scr.w}×${scr.h}`, 6 * dpr, 16 * dpr);

  for (const s of st.layout.surfaces) {
    const sel = s.id === st.sel;
    const q = s.targetPoints.map(([x, y]) => [x * k, y * k]);
    ctx.beginPath();
    q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = sel ? 'rgba(10,132,255,0.25)' : 'rgba(255,255,255,0.08)';
    ctx.fill();
    ctx.lineWidth = (sel ? 2 : 1) * dpr;
    ctx.strokeStyle = sel ? '#0a84ff' : '#888';
    ctx.stroke();
    const cx = q.reduce((a, p) => a + p[0], 0) / 4, cy = q.reduce((a, p) => a + p[1], 0) / 4;
    ctx.fillStyle = sel ? '#fff' : '#aaa';
    ctx.textAlign = 'center';
    ctx.fillText(s.id, cx, cy);
    ctx.textAlign = 'start';
    if (sel) {
      q.forEach(([x, y], i) => {
        ctx.beginPath();
        ctx.arc(x, y, (st.corner === i ? 11 : 8) * dpr, 0, Math.PI * 2);
        ctx.fillStyle = CORNER_COLORS[i];
        ctx.fill();
        if (st.corner === i) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * dpr; ctx.stroke(); }
        ctx.fillStyle = '#000';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), x, y);
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
      });
    }
  }
}
window.addEventListener('resize', drawEditor);

// ---- content -----------------------------------------------------------------

Object.keys(sketches).forEach((n) => $('#csketch').add(new Option(n, n)));

async function loadMedia() {
  try {
    st.media = await (await fetch('/api/media')).json();
  } catch { st.media = []; }
  render();
}
loadMedia();
window.addEventListener('focus', loadMedia);

function contentFromForm(s) {
  const type = $('#ctype').value;
  const c = { type };
  if (type === 'video') {
    c.src = [...$('#cvideo').selectedOptions].map((o) => o.value);
    c.fit = $('#cfit').value;
  } else if (type === 'image') {
    c.src = $('#cimage').value;
    c.fit = $('#cfit').value;
  } else if (type === 'canvas') {
    c.sketch = $('#csketch').value;
  } else {
    c.color = $('#ccolor').value;
  }
  s.content = c;
}

['#ctype', '#cvideo', '#cimage', '#csketch', '#ccolor', '#cfit'].forEach((id) => {
  $(id).addEventListener('change', () => {
    const s = surface();
    if (!s) return;
    contentFromForm(s);
    changed({ now: true });
    render();
  });
});
$('#csize').addEventListener('change', (e) => {
  const s = surface();
  if (!s) return;
  const [w, h] = e.target.value.split('x').map(Number);
  s.w = w; s.h = h;
  s.sourcePoints = rect(w, h);
  changed({ now: true });
  render();
});

function fillSelect(sel, items, selected, keepEmpty) {
  const want = new Set([].concat(selected || []));
  sel.innerHTML = '';
  if (keepEmpty) sel.add(new Option('—', ''));
  items.forEach((n) => { const o = new Option(n, n); o.selected = want.has(n); sel.add(o); });
  // keep entries that are in the layout but missing from media/
  want.forEach((n) => {
    if (n && !items.includes(n)) { const o = new Option(n + ' (missing)', n); o.selected = true; sel.add(o); }
  });
}

// ---- status --------------------------------------------------------------------

async function pollStatus() {
  try {
    st.status = await (await fetch('/api/status')).json();
  } catch { st.status = null; }
  renderStatus();
  if (!dragging) drawEditor();
}
setInterval(pollStatus, 2000);
pollStatus();

function fmt(v, d = 1) { return v == null ? '—' : Number(v).toFixed(d); }

function renderStatus() {
  const s = st.status;
  const el = $('#status');
  if (!s) { el.innerHTML = '<div>status</div><div>unavailable</div>'; return; }
  const rows = [
    ['Pi', `${s.pi} (${s.role})`],
    ['CPU temp', s.cpuTempC == null ? 'n/a' : fmt(s.cpuTempC) + ' °C'],
    ['Load', s.load ? s.load.map((x) => x.toFixed(2)).join(' ') : 'n/a'],
    ['Layout', s.layoutName],
    ['Clients', Object.entries(s.clients || {}).map(([k, v]) => `${k}:${v}`).join(' ') || 'none'],
    ['Uptime', `${Math.floor(s.uptimeSec / 60)} min`],
  ];
  if (s.peer) {
    rows.push(['Leader', `${s.peer.leader} ${s.peer.connected ? 'connected' : 'DISCONNECTED'}`]);
    if (s.peer.clockOffsetMs != null) rows.push(['Clock vs leader', `${fmt(s.peer.clockOffsetMs)} ms (rtt ${fmt(s.peer.rttMs)} ms)`]);
  }
  for (const p of s.projectors || []) {
    const age = Math.round((s.time - p.received) / 1000);
    rows.push([`Projector ${p.from}`,
      `${p.w}×${p.h} ${fmt(p.fps)} fps, ${p.videos} video, dropped ${p.dropped}/${p.total}` +
      (p.driftMs != null ? `, drift ${fmt(p.driftMs)} ms` : '') + (age > 6 ? ` (${age}s ago)` : '')]);
  }
  if (s.interPiOffsetMs != null) rows.push(['Pi-to-Pi offset', fmt(s.interPiOffsetMs) + ' ms']);
  el.innerHTML = '';
  rows.forEach(([k, v]) => {
    const a = document.createElement('div'); a.textContent = k;
    const b = document.createElement('div'); b.textContent = v;
    el.append(a, b);
  });
}

// ---- render ----------------------------------------------------------------------

function render() {
  $('#edit-btn').textContent = `Edit mode: ${st.edit ? 'ON' : 'off'}`;
  $('#edit-btn').classList.toggle('on', st.edit);
  $('#blackout-btn').classList.toggle('on', st.blackout);
  $('#pattern').value = st.pattern;

  const ls = $('#layouts');
  ls.innerHTML = '';
  st.layouts.forEach((n) => ls.add(new Option(n, n, false, n === st.layoutName)));

  const list = $('#surface-list');
  list.innerHTML = '';
  st.layout.surfaces.forEach((s) => {
    const b = document.createElement('button');
    b.textContent = `${s.id} · ${s.content?.type || '?'}`;
    b.classList.toggle('sel', s.id === st.sel);
    b.addEventListener('click', () => { st.sel = s.id; render(); });
    list.appendChild(b);
  });
  if (!st.layout.surfaces.length) list.textContent = 'No surfaces yet.';

  $$('#corners [data-c]').forEach((b) => b.classList.toggle('sel', Number(b.dataset.c) === st.corner));
  $('#step').textContent = String(st.step);

  const s = surface();
  $('#content-section').style.display = s ? '' : 'none';
  if (s) {
    const c = s.content || { type: 'color' };
    $('#ctype').value = c.type;
    $('#csize').value = `${s.w}x${s.h}`;
    const vids = st.media.filter((m) => m.kind === 'video').map((m) => m.name);
    const imgs = st.media.filter((m) => m.kind === 'image').map((m) => m.name);
    fillSelect($('#cvideo'), vids, c.type === 'video' ? c.src : []);
    fillSelect($('#cimage'), imgs, c.type === 'image' ? c.src : '', true);
    if (c.type === 'canvas') $('#csketch').value = c.sketch || 'testcard';
    if (c.type === 'color') $('#ccolor').value = c.color || '#ffffff';
    $('#cfit').value = c.fit || 'cover';
    $('#c-video').style.display = c.type === 'video' ? '' : 'none';
    $('#c-image').style.display = c.type === 'image' ? '' : 'none';
    $('#c-canvas').style.display = c.type === 'canvas' ? '' : 'none';
    $('#c-color').style.display = c.type === 'color' ? '' : 'none';
    $('#c-fit').style.display = c.type === 'video' || c.type === 'image' ? '' : 'none';
  }
  drawEditor();
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.style.display = 'none'), 3000);
}

render();
