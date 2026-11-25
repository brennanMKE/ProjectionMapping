// Projector page: builds surfaces from the active layout, warps them with
// maptastic, follows cues from mapd, and reports health/drift back.

import { Link, runAt } from './link.js';
import { sketches } from './sketches.js';
import { drawPattern } from './patterns.js';

const stage = document.getElementById('stage');
const hud = document.getElementById('hud');

const state = {
  pi: '',
  layoutName: '',
  layout: { surfaces: [] },
  edit: false,
  pattern: 'none',
  blackout: false,
  clip: 0,
  playStart: null, // server ms when the last play/next cue started
  connected: false,
};

// id -> { el, key, content, canvas?, sketch?, pattern }
const built = new Map();

const map = new maptastic.Maptastic({
  autoSave: false,  // layouts live on the server, not in localStorage
  autoLoad: false,
  labels: true,
  crosshairs: false,
  onchange: onMapChange,
});

const link = new Link({
  role: 'projector',
  name: 'projector',
  onMessage,
  onState: (up) => { state.connected = up; document.body.classList.toggle('offline', !up); updateHud(); },
});

// ---- messages -------------------------------------------------------------

function onMessage(m) {
  switch (m.type) {
    case 'welcome':
      // mapd restarted (likely a new deploy): reload to pick up new page code
      if (state.boot && m.boot !== state.boot) { location.reload(); return; }
      state.boot = m.boot;
      state.pi = m.pi;
      state.clip = m.clip || 0;
      setEdit(m.edit);
      setPattern(m.pattern);
      setBlackout(m.blackout);
      applyLayout(m.layoutName, m.layout);
      break;
    case 'layout':
      applyLayout(m.name, m.layout);
      break;
    case 'edit':
      setEdit(m.value);
      break;
    case 'pattern':
      setPattern(m.value);
      break;
    case 'cue':
      onCue(m);
      break;
    case 'error':
      console.warn('mapd:', m.error);
      break;
  }
  updateHud();
}

// ---- layout ---------------------------------------------------------------

function rect(w, h) { return [[0, 0], [w, 0], [w, h], [0, h]]; }

function normalizeSurface(s) {
  const w = s.w || 640, h = s.h || 360;
  return {
    ...s,
    w, h,
    content: s.content || { type: 'color', color: '#333' },
    targetPoints: s.targetPoints || rect(w, h),
    sourcePoints: s.sourcePoints || rect(w, h),
  };
}

function applyLayout(name, layout) {
  state.layoutName = name;
  state.layout = layout || { surfaces: [] };
  const surfaces = (state.layout.surfaces || []).map(normalizeSurface);
  state.layout.surfaces = surfaces;
  const wanted = new Set(surfaces.map((s) => s.id));

  for (const [id, b] of built) {
    if (!wanted.has(id)) removeSurface(id, b);
  }
  surfaces.forEach((s) => {
    const key = JSON.stringify([s.w, s.h, s.content]);
    const b = built.get(s.id);
    if (b && b.key === key) return;
    if (b) removeSurface(s.id, b);
    buildSurface(s, key);
  });
  // keep DOM order = layout order (later surfaces draw on top)
  surfaces.forEach((s) => stage.appendChild(built.get(s.id).el));

  map.setLayout(surfaces.map((s) => ({ id: s.id, targetPoints: s.targetPoints, sourcePoints: s.sourcePoints })));
  redrawPatterns();
}

function removeSurface(id, b) {
  map.removeLayer(b.el);
  b.el.querySelectorAll('video').forEach((v) => { v.pause(); v.removeAttribute('src'); v.load(); });
  b.el.remove();
  built.delete(id);
}

function playlist(content) {
  const src = content.src;
  const list = Array.isArray(src) ? src : src ? [src] : [];
  return list.filter(Boolean);
}

function mediaURL(name) {
  return '/media/' + String(name).split('/').map(encodeURIComponent).join('/');
}

function buildSurface(s, key) {
  const el = document.createElement('div');
  el.className = 'surface';
  el.id = s.id;
  el.style.width = s.w + 'px';
  el.style.height = s.h + 'px';
  const b = { el, key, content: s.content };

  const c = s.content;
  let node;
  switch (c.type) {
    case 'video': {
      node = document.createElement('video');
      node.muted = true;
      node.loop = true;
      node.playsInline = true;
      node.autoplay = true;
      node.preload = 'auto';
      const list = playlist(c);
      b.playlist = list;
      if (list.length) node.src = mediaURL(list[state.clip % list.length]);
      node.addEventListener('error', () => console.warn('video error', node.src, node.error));
      break;
    }
    case 'image':
      node = document.createElement('img');
      if (c.src) node.src = mediaURL(Array.isArray(c.src) ? c.src[0] : c.src);
      break;
    case 'canvas':
      node = document.createElement('canvas');
      node.width = s.w;
      node.height = s.h;
      b.canvas = node;
      b.ctx = node.getContext('2d');
      b.sketch = sketches[c.sketch] || sketches.testcard;
      break;
    default: // color
      node = document.createElement('div');
      node.style.background = c.color || '#fff';
  }
  node.classList.add('content');
  if (c.fit && (c.type === 'video' || c.type === 'image')) node.style.objectFit = c.fit;
  el.appendChild(node);

  const pat = document.createElement('canvas');
  pat.className = 'pattern';
  pat.width = s.w;
  pat.height = s.h;
  b.pattern = pat;
  el.appendChild(pat);

  stage.appendChild(el);
  built.set(s.id, b);
  map.addLayer(el, s.targetPoints);
}

function redrawPatterns() {
  document.body.classList.toggle('show-pattern', state.pattern !== 'none');
  for (const [id, b] of built) drawPattern(b.pattern, state.pattern, id);
}

// Corner edits made on the projector itself (mouse/keyboard in edit mode).
let liveTimer = null, saveTimer = null;
function onMapChange() {
  const pts = new Map(map.getLayout().map((l) => [l.id, l]));
  for (const s of state.layout.surfaces) {
    const p = pts.get(s.id);
    if (p) { s.targetPoints = p.targetPoints; s.sourcePoints = p.sourcePoints; }
  }
  state.layout.screen = { w: innerWidth, h: innerHeight };
  if (!liveTimer) {
    liveTimer = setTimeout(() => {
      liveTimer = null;
      link.send({ type: 'layout', layout: state.layout, persist: false });
    }, 80);
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => link.send({ type: 'layout', layout: state.layout, persist: true }), 500);
}

// ---- modes ----------------------------------------------------------------

function setEdit(on) {
  state.edit = !!on;
  if (map.configActive !== state.edit) map.setConfigEnabled(state.edit);
  document.body.classList.toggle('edit', state.edit);
}

// maptastic toggles edit mode itself on Shift+Space; tell the server so the
// control page stays in sync.
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.shiftKey) {
    setTimeout(() => {
      if (map.configActive !== state.edit) {
        setEdit(map.configActive);
        link.send({ type: 'edit', value: state.edit });
        updateHud();
      }
    }, 0);
  }
});

function setPattern(p) {
  state.pattern = p || 'none';
  redrawPatterns();
}

function setBlackout(on) {
  state.blackout = !!on;
  document.body.classList.toggle('blackout', state.blackout);
}

// ---- cues -----------------------------------------------------------------

function videos() { return [...stage.querySelectorAll('video')]; }

function prepareVideos(clip) {
  for (const [, b] of built) {
    if (!b.playlist || !b.playlist.length) continue;
    const v = b.el.querySelector('video');
    const want = mediaURL(b.playlist[clip % b.playlist.length]);
    if (!v.src.endsWith(want)) v.src = want;
    v.pause();
    v.currentTime = 0;
  }
}

function onCue(m) {
  const { cue, at } = m;
  switch (cue) {
    case 'play':
    case 'next':
      state.clip = Number(m.value) || 0;
      prepareVideos(state.clip);
      runAt(link, at, () => {
        videos().forEach((v) => v.play().catch((e) => console.warn('play failed', e)));
        state.playStart = at;
      });
      break;
    case 'pause':
      runAt(link, at, () => { videos().forEach((v) => v.pause()); state.playStart = null; });
      break;
    case 'blackout':
      runAt(link, at, () => setBlackout(m.value === true || m.value === 'true'));
      break;
  }
}

// ---- render loop, fps -----------------------------------------------------

let frames = 0, fps = 0, fpsT = performance.now();
function frame(now) {
  frames++;
  if (now - fpsT >= 1000) { fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now; }
  const t = link.serverNow() / 1000;
  for (const [, b] of built) {
    if (b.sketch) b.sketch(b.ctx, b.canvas.width, b.canvas.height, t);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- reports --------------------------------------------------------------

function measureDrift() {
  if (state.playStart == null) return null;
  const now = link.serverNow();
  if (now < state.playStart + 500) return null;
  const v = videos().find((x) => !x.paused && isFinite(x.duration) && x.duration > 0);
  if (!v) return null;
  const dur = v.duration;
  const expected = ((now - state.playStart) / 1000) % dur;
  let d = v.currentTime - expected;
  if (d > dur / 2) d -= dur;
  if (d < -dur / 2) d += dur;
  return Math.round(d * 10000) / 10;
}

setInterval(() => {
  let dropped = 0, total = 0;
  const vs = videos();
  vs.forEach((v) => {
    const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
    if (q) { dropped += q.droppedVideoFrames; total += q.totalVideoFrames; }
  });
  const drift = measureDrift();
  link.send({
    type: 'report',
    report: {
      w: innerWidth, h: innerHeight,
      fps: Math.round(fps * 10) / 10,
      dropped, total,
      driftMs: drift == null ? undefined : drift,
      playing: vs.some((v) => !v.paused),
      videos: vs.length,
    },
  });
  updateHud(drift);
}, 2000);

function updateHud(drift) {
  const lines = [
    `${state.pi || '?'}  layout: ${state.layoutName}  ${state.connected ? '' : '[OFFLINE]'}`,
    `${innerWidth}x${innerHeight}  ${fps.toFixed(1)} fps  clip ${state.clip}`,
  ];
  if (drift != null) lines.push(`drift ${drift} ms`);
  if (state.edit) lines.push('edit mode: drag corners, Shift+Space to exit');
  hud.textContent = lines.join('\n');
}

window.addEventListener('resize', updateHud);
