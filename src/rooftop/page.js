// "3D Live Rooftop" page inside the Owner dashboard.
// STAGE 1 (layout preview): static rooftop, camera, table panel with layout data only. No live data yet.
import { TABLES, FLOOR, BAR, ENTRANCE, WALKWAY, DIMS } from './config.js';
import { hasWebGL, createRooftop, BOUNDS } from './scene.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let view = null, host = null;

export function openRooftop({ onBack }) {
  closeRooftop();
  host = document.createElement('div'); host.className = 'rtp'; host.setAttribute('role', 'dialog'); host.setAttribute('aria-label', '3D Live Rooftop');
  const seats = TABLES.reduce((a, t) => a + t.chairs.length, 0);
  host.innerHTML = `
    <div class="rtp-top">
      <button class="rtp-btn" id="rtpBack">‹ Owner dashboard</button>
      <div class="rtp-title"><svg aria-hidden="true"><use href="#i-stock"/></svg><b>3D Live Rooftop</b><span class="rtp-badge">Layout preview · live data not connected yet</span></div>
    </div>
    <div class="rtp-stats">
      <div><small>Physical tables</small><b>${TABLES.length}</b></div><div><small>Seating capacity</small><b>${seats}</b></div>
      <div><small>Round · square</small><b>${TABLES.filter(t => t.shape === 'round').length} · ${TABLES.filter(t => t.shape === 'square').length}</b></div>
      <div class="dim"><small>Occupied · available · waiting</small><b>— · — · —</b></div><div class="dim"><small>Revenue · orders today</small><b>— · —</b></div>
    </div>
    <div class="rtp-stage" id="rtpStage"></div>
    <div class="rtp-tools" role="toolbar" aria-label="Camera">
      <button class="rtp-btn" data-v="iso" title="Isometric aerial view">Aerial</button><button class="rtp-btn" data-v="top" title="Top-down view">Top</button>
      <button class="rtp-btn" data-z="0.8" aria-label="Zoom in">＋</button><button class="rtp-btn" data-z="1.25" aria-label="Zoom out">−</button>
      <button class="rtp-btn" id="rtpReset">Reset</button><button class="rtp-btn" id="rtpPlan">2D plan</button><button class="rtp-btn" id="rtpFull" aria-label="Fullscreen">⤢</button>
    </div>
    <p class="rtp-help">Drag to rotate · pinch or wheel to zoom · two fingers / right-click to move · tap a table</p>
    <aside class="rtp-panel" id="rtpPanel" hidden></aside>`;
  document.body.appendChild(host); document.body.style.overflow = 'hidden';
  const stage = host.querySelector('#rtpStage');
  let plan2d = !hasWebGL();
  const draw = () => {
    view?.dispose?.(); view = null; stage.innerHTML = '';
    if (plan2d) { stage.innerHTML = planSvg(); stage.querySelectorAll('[data-t]').forEach(g => { g.onclick = () => showPanel(g.dataset.t); }); }
    else { view = createRooftop(stage, { onPick: showPanel }); if (import.meta.env.DEV) window.__rooftop = view; }
    host.querySelector('#rtpPlan').textContent = plan2d ? '3D view' : '2D plan';
    host.querySelectorAll('[data-v],[data-z],#rtpReset').forEach(b => { b.disabled = plan2d; });
  };
  draw();
  host.querySelector('#rtpBack').onclick = () => { closeRooftop(); onBack && onBack(); };
  host.querySelectorAll('[data-v]').forEach(b => { b.onclick = () => view?.setView(b.dataset.v); });
  host.querySelectorAll('[data-z]').forEach(b => { b.onclick = () => view?.zoom(+b.dataset.z); });
  host.querySelector('#rtpReset').onclick = () => { view?.reset(); showPanel(null); };
  host.querySelector('#rtpPlan').onclick = () => { if (!hasWebGL()) return; plan2d = !plan2d; showPanel(null); draw(); };
  host.querySelector('#rtpFull').onclick = () => { const d = document; if (d.fullscreenElement) d.exitFullscreen?.(); else host.requestFullscreen?.().catch(() => {}); };
  addEventListener('keydown', onKey);
}

function onKey(e) { if (e.key === 'Escape' && host) { if (!host.querySelector('#rtpPanel').hidden) showPanel(null); } }

export function closeRooftop() {
  view?.dispose?.(); view = null;
  if (host) { host.remove(); host = null; document.body.style.overflow = ''; }
  removeEventListener('keydown', onKey);
}

function showPanel(id) {
  if (!host) return;
  const p = host.querySelector('#rtpPanel'), t = TABLES.find(x => x.id === id);
  view?.select?.(id || null);
  if (!t) { p.hidden = true; return; }
  p.hidden = false;
  p.innerHTML = `<div class="rtp-ph"><div><small>Physical table</small><b>${esc(t.id)}</b></div><button class="rtp-x" aria-label="Close">×</button></div>
    <dl class="rtp-dl">
      <dt>Shape</dt><dd>${t.shape === 'round' ? 'Round' : 'Square'}</dd>
      <dt>Seating capacity</dt><dd>${t.chairs.length} chairs</dd>
      <dt>App table number</dt><dd>${t.app ? esc(t.app) : '<span class="rtp-muted">not linked yet — waiting for your confirmation</span>'}</dd>
      <dt>Position</dt><dd>x ${t.x.toFixed(2)} m · z ${t.z.toFixed(2)} m · ${t.rot || 0}°</dd>
      <dt>Operational status</dt><dd><span class="rtp-muted">comes with the next step (Menu &amp; prices)</span></dd>
    </dl>
    <p class="rtp-muted">Live status, today's revenue, recent orders and the ⭐ favourite ranking will appear here after you approve the layout.</p>`;
  p.querySelector('.rtp-x').onclick = () => showPanel(null);
}

// 2D plan (fallback when WebGL is not available, and to compare with the drawing)
function planSvg() {
  const pad = 0.6, w = BOUNDS.maxX - BOUNDS.minX + pad * 2 + 0.3, h = BOUNDS.maxZ - BOUNDS.minZ + pad * 2 + 0.2;
  const pts = a => a.map(([x, z]) => `${x},${z}`).join(' ');
  const walk = WALKWAY.path.map(([x, z]) => `${x},${z}`).join(' ');
  const tables = TABLES.map(t => {
    const chairs = t.chairs.map(c => `<rect x="${c.dx - 0.2}" y="${c.dz - 0.2}" width="0.4" height="0.4" rx="0.08" class="ch"/>`).join('');
    const top = t.shape === 'round' ? `<circle r="${DIMS.RD.diameter / 2 + 0.03}" class="tb"/>` : `<rect x="${-DIMS.SQ.size / 2 - 0.03}" y="${-DIMS.SQ.size / 2 - 0.03}" width="${DIMS.SQ.size + 0.06}" height="${DIMS.SQ.size + 0.06}" class="tb"/>`;
    return `<g data-t="${t.id}" transform="translate(${t.x} ${t.z}) rotate(${t.rot || 0})" role="button" tabindex="0" aria-label="${t.id}">${chairs}${top}<text y="0.12" class="tl">${esc(t.label)}</text></g>`;
  }).join('');
  return `<svg class="rtp-plan" viewBox="${BOUNDS.minX - pad} ${BOUNDS.minZ - pad} ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-label="Rooftop plan">
    <polygon points="${pts(FLOOR)}" class="fl"/><polygon points="${pts(BAR.area)}" class="bar"/>
    <polyline points="${walk}" class="wk" style="stroke-width:${WALKWAY.width}"/>
    <text x="${(BAR.area[0][0] + BAR.area[2][0]) / 2}" y="${(BAR.area[0][1] + BAR.area[2][1]) / 2}" class="lb">BAR</text>
    <line x1="${ENTRANCE.a[0]}" y1="${ENTRANCE.a[1]}" x2="${ENTRANCE.b[0]}" y2="${ENTRANCE.b[1]}" class="dr"/>
    <text x="${ENTRANCE.a[0] - 0.9}" y="${(ENTRANCE.a[1] + ENTRANCE.b[1]) / 2}" class="lb sm">Entrance</text>${tables}</svg>`;
}
