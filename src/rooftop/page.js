// "3D Live Rooftop" page inside the Owner dashboard.
// STAGE 1 (layout preview): static rooftop, camera, table panel with layout data only. No live data yet.
import { TABLES, FLOOR, BAR, ENTRANCE, WALKWAY, DIMS, chairSlots } from './config.js';
import { S, onChange, reload, tableData, count } from '../store.js';
import { hasWebGL, createRooftop, BOUNDS } from './scene.js';
import { getLang } from '../i18n.js';

const L = (en, it) => (getLang() === 'it' ? it : en);

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let view = null, host = null, picked = null;

// live data (chairs + table settings) — read from the existing store, updated by Supabase Realtime
const roofRow = id => S.roof.tables.find(r => r.id === id) || null;
const chairsOf = t => (S.roof.tables.length ? (S.roof.chairs[t.id] ?? 0) : t.defaultChairs);
const benchOf = t => roofRow(t.id)?.bench_seats ?? (t.bench ? t.bench.seats : 0);
function totals() {
  const live = !!S.roof.tables.length;
  const onRoof = TABLES.reduce((a, t) => a + chairsOf(t), 0), st = live ? (S.roof.chairs.storage ?? 0) : null;
  return { onRoof, st, total: st == null ? null : onRoof + st, bench: TABLES.reduce((a, t) => a + benchOf(t), 0), live };
}
function refresh() {
  if (!host) return;
  for (const t of TABLES) view?.setChairs?.(t.id, chairsOf(t));
  const k = totals(), el = host.querySelector('#rtpStats');
  if (el) el.innerHTML = statsHtml(k);
  if (picked) showPanel(picked, true);
  if (!view) { const st = host.querySelector('#rtpStage'); if (st && st.querySelector('svg')) { st.innerHTML = planSvg(); bindPlan(st); } }
}
let subscribed = false;
function statsHtml(k) {
  return `<div><small>${L('Physical tables', 'Tavoli fisici')}</small><b>${TABLES.length}</b></div>
    <div><small>${L('Chairs on the rooftop', 'Sedie sul rooftop')}</small><b>${k.onRoof}</b></div><div><small>${L('Reserve in storage', 'Riserva in magazzino')}</small><b>${k.st ?? '—'}</b></div>
    <div><small>${L('Total physical chairs', 'Totale sedie fisiche')}</small><b>${k.total ?? '—'}</b></div><div><small>${L('Bench seats', 'Posti panca')}</small><b>${k.bench}</b></div>
    <div class="dim"><small>${L('Occupied · available · waiting', 'Occupati · liberi · in attesa')}</small><b>— · — · —</b></div><div class="dim"><small>${L('Revenue · orders today', 'Incasso · ordini oggi')}</small><b>— · —</b></div>`;
}

export function openRooftop({ onBack }) {
  closeRooftop();
  host = document.createElement('div'); host.className = 'rtp'; host.setAttribute('role', 'dialog'); host.setAttribute('aria-label', L('3D Live Rooftop', 'Rooftop 3D live'));
  host.innerHTML = `
    <div class="rtp-top">
      <button class="rtp-btn" id="rtpBack">‹ ${L('Owner dashboard', 'Dashboard titolare')}</button>
      <div class="rtp-title"><svg aria-hidden="true"><use href="#i-stock"/></svg><b>${L('3D Live Rooftop', 'Rooftop 3D live')}</b><span class="rtp-badge">${L('Layout preview · chairs live · orders not connected yet', 'Anteprima pianta · sedie live · ordini non ancora collegati')}</span></div>
    </div>
    <div class="rtp-stats" id="rtpStats">${statsHtml(totals())}</div>
    <div class="rtp-stage" id="rtpStage"></div>
    <div class="rtp-tools" role="toolbar" aria-label="${L('Camera', 'Visuale')}">
      <button class="rtp-btn" data-v="iso" title="${L('Isometric aerial view', 'Vista aerea isometrica')}">${L('Aerial', 'Aerea')}</button><button class="rtp-btn" data-v="top" title="${L('Top-down view', 'Vista dall\'alto')}">${L('Top', 'Dall\'alto')}</button>
      <button class="rtp-btn" data-z="0.8" aria-label="${L('Zoom in', 'Ingrandisci')}">＋</button><button class="rtp-btn" data-z="1.25" aria-label="${L('Zoom out', 'Rimpicciolisci')}">−</button>
      <button class="rtp-btn" id="rtpReset">${L('Reset', 'Ripristina')}</button><button class="rtp-btn" id="rtpPlan">${L('2D plan', 'Pianta 2D')}</button><button class="rtp-btn" id="rtpFull" aria-label="${L('Fullscreen', 'Schermo intero')}">⤢</button>
    </div>
    <p class="rtp-help">${L('Drag to rotate · pinch or wheel to zoom · two fingers / right-click to move · tap a table', 'Trascina per ruotare · pizzica o rotella per lo zoom · due dita / tasto destro per spostare · tocca un tavolo')}</p>
    <button class="rtp-btn rtp-backov" id="rtpOverview" hidden>‹ ${L('Back to rooftop', 'Torna al rooftop')}</button>
    <aside class="rtp-panel" id="rtpPanel" hidden></aside>`;
  document.body.appendChild(host); document.body.style.overflow = 'hidden';
  const stage = host.querySelector('#rtpStage');
  let plan2d = !hasWebGL();
  const draw = () => {
    view?.dispose?.(); view = null; stage.innerHTML = '';
    if (plan2d) { stage.innerHTML = planSvg(); bindPlan(stage); }
    else { view = createRooftop(stage, { onPick: pickTable }); if (import.meta.env.DEV) window.__rooftop = view; }
    host.querySelector('#rtpPlan').textContent = plan2d ? L('3D view', 'Vista 3D') : L('2D plan', 'Pianta 2D');
    host.querySelectorAll('[data-v],[data-z],#rtpReset').forEach(b => { b.disabled = plan2d; });
  };
  draw(); refresh();
  if (!subscribed) { subscribed = true; onChange(refresh); }
  reload('roof').catch(() => {});
  host.querySelector('#rtpBack').onclick = () => { closeRooftop(); onBack && onBack(); };
  host.querySelectorAll('[data-v]').forEach(b => { b.onclick = () => { showPanel(null); setBack(false); view?.setView(b.dataset.v); }; });
  host.querySelector('#rtpOverview').onclick = backToRooftop;
  host.querySelectorAll('[data-z]').forEach(b => { b.onclick = () => view?.zoom(+b.dataset.z); });
  host.querySelector('#rtpReset').onclick = backToRooftop;
  host.querySelector('#rtpPlan').onclick = () => { if (!hasWebGL()) return; plan2d = !plan2d; showPanel(null); setBack(false); draw(); };
  host.querySelector('#rtpFull').onclick = () => { const d = document; if (d.fullscreenElement) d.exitFullscreen?.(); else host.requestFullscreen?.().catch(() => {}); };
  addEventListener('keydown', onKey);
}

// tap on a table: fly to it and open its panel · tap on empty space: only close the panel (the camera stays)
function pickTable(id) {
  if (id) { view?.focus?.(id); showPanel(id, true); setBack(true); }
  else showPanel(null, true);
}
function backToRooftop() { showPanel(null); setBack(false); view?.overview?.(); }
function setBack(on) {
  const b = host?.querySelector('#rtpOverview'); if (!b) return;
  b.hidden = !on;
  const st = host.querySelector('#rtpStage'); b.style.top = (st.getBoundingClientRect().top - host.getBoundingClientRect().top + 12) + 'px';
}

function onKey(e) { if (e.key === 'Escape' && host) { if (!host.querySelector('#rtpPanel').hidden) showPanel(null); } }

export function closeRooftop() {
  view?.dispose?.(); view = null; picked = null;
  if (host) { host.remove(); host = null; document.body.style.overflow = ''; }
  removeEventListener('keydown', onKey);
}

// guests now at this table (the existing OSPITI field of the open order) and chairs still needed
function guestsRow(t) {
  const app = roofRow(t.id)?.app_table; if (!app) return '';
  const d = tableData(app); if (!count(d) && !d.covers) return `<dt>${L('Guests now', 'Ospiti ora')}</dt><dd><span class="rtp-muted">${L('no open order', 'nessun ordine aperto')}</span></dd>`;
  const need = (d.covers || 0) - (chairsOf(t) + benchOf(t));
  return `<dt>${L('Guests now', 'Ospiti ora')}</dt><dd>${d.covers || 0}</dd><dt>${L('Chairs needed', 'Sedie necessarie')}</dt><dd>${need > 0 ? `<span style="color:#f5a54a">${need} ${L('more', 'in più')}</span>` : `<span style="color:#7bd08f">${L('enough', 'sufficienti')} ✓</span>`}</dd>`;
}

function bindPlan(el) { el.querySelectorAll('[data-t]').forEach(g => { g.onclick = () => showPanel(g.dataset.t); }); }

function showPanel(id, keep) {
  if (!host) return;
  const p = host.querySelector('#rtpPanel'), t = TABLES.find(x => x.id === id);
  picked = t ? id : null;
  if (!keep) view?.select?.(id || null);
  if (!t) { p.hidden = true; view?.setInset?.(0, 0); return; }
  p.hidden = false;
  p.innerHTML = `<div class="rtp-ph"><div><small>${L('Physical table', 'Tavolo fisico')}</small><b>${esc(t.id)}</b></div><button class="rtp-x" aria-label="${L('Close', 'Chiudi')}">×</button></div>
    <dl class="rtp-dl">
      <dt>${L('Shape', 'Forma')}</dt><dd>${t.shape === 'round' ? L('Round', 'Rotondo') : L('Square', 'Quadrato')}</dd>
      <dt>${L('Chairs here now', 'Sedie qui ora')}</dt><dd>${chairsOf(t)}${benchOf(t) ? ` <span class="rtp-muted">${L('+ bench for', '+ panca per')} ${benchOf(t)}</span>` : ''}</dd>
      <dt>${L('Seats now', 'Posti ora')}</dt><dd>${chairsOf(t) + benchOf(t)}</dd>
      ${guestsRow(t)}
      <dt>${L('App table number', 'Numero tavolo app')}</dt><dd>${roofRow(t.id)?.app_table ? 'Tavolo ' + roofRow(t.id).app_table : `<span class="rtp-muted">${L('not linked — set it in Menu &amp; prices', 'non collegato — impostalo in Menu e prezzi')}</span>`}</dd>
      <dt>${L('Position', 'Posizione')}</dt><dd>x ${t.x.toFixed(2)} m · z ${t.z.toFixed(2)} m · ${t.rot || 0}°</dd>
      <dt>${L('Operational status', 'Stato operativo')}</dt><dd>${!roofRow(t.id) ? '<span class="rtp-muted">—</span>' : roofRow(t.id).active ? '<span class="rtp-dot on"></span>' + L('ACTIVE', 'ATTIVO') : '<span class="rtp-dot off"></span>' + L('CLOSED', 'CHIUSO')}</dd>
    </dl>
    <p class="rtp-muted">${L('Chairs update live when waiters move them. Order status, revenue, recent orders and ⭐ favourites come after you approve the layout.', 'Le sedie si aggiornano live quando i camerieri le spostano. Stato ordini, incasso, ultimi ordini e ⭐ preferiti arrivano dopo che approvi la pianta.')}</p>`;
  p.querySelector('.rtp-x').onclick = () => showPanel(null, true);   // close the panel, keep the camera where it is
  // keep the table visible next to the panel (right side on a computer, bottom sheet on a phone)
  const small = innerWidth <= 700;
  view?.setInset?.(small ? 0 : p.offsetWidth + 28, small ? p.offsetHeight + 8 : 0);
}

// 2D plan (fallback when WebGL is not available, and to compare with the drawing)
function planSvg() {
  const pad = 0.6, w = BOUNDS.maxX - BOUNDS.minX + pad * 2 + 0.3, h = BOUNDS.maxZ - BOUNDS.minZ + pad * 2 + 0.2;
  const pts = a => a.map(([x, z]) => `${x},${z}`).join(' ');
  const walk = WALKWAY.path.map(([x, z]) => `${x},${z}`).join(' ');
  const tables = TABLES.map(t => {
    const chairs = chairSlots(t, chairsOf(t)).map(c => `<rect x="${c.dx - 0.2}" y="${c.dz - 0.2}" width="0.4" height="0.4" rx="0.08" class="ch"/>`).join('')
      + (t.bench ? `<rect x="${t.bench.dx - 0.24}" y="${t.bench.dz - t.bench.length / 2}" width="0.48" height="${t.bench.length}" rx="0.08" class="bn"/>` : '');
    const sz = (t.size || DIMS.SQ.size) + 0.06;
    const top = t.shape === 'round' ? `<circle r="${DIMS.RD.diameter / 2 + 0.03}" class="tb"/>` : `<rect x="${-sz / 2}" y="${-sz / 2}" width="${sz}" height="${sz}" class="tb"/>`;
    return `<g data-t="${t.id}" transform="translate(${t.x} ${t.z}) rotate(${t.rot || 0})" role="button" tabindex="0" aria-label="${t.id}">${chairs}${top}<text y="0.12" class="tl">${esc(t.label)}</text></g>`;
  }).join('');
  return `<svg class="rtp-plan" viewBox="${BOUNDS.minX - pad} ${BOUNDS.minZ - pad} ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-label="${L('Rooftop plan', 'Pianta rooftop')}">
    <polygon points="${pts(FLOOR)}" class="fl"/><polygon points="${pts(BAR.area)}" class="bar"/>
    <polyline points="${walk}" class="wk" style="stroke-width:${WALKWAY.width}"/>
    <text x="${(BAR.area[0][0] + BAR.area[2][0]) / 2}" y="${(BAR.area[0][1] + BAR.area[2][1]) / 2}" class="lb">BAR</text>
    <line x1="${ENTRANCE.a[0]}" y1="${ENTRANCE.a[1]}" x2="${ENTRANCE.b[0]}" y2="${ENTRANCE.b[1]}" class="dr"/>
    <text x="${ENTRANCE.a[0] - 0.6}" y="${(ENTRANCE.a[1] + ENTRANCE.b[1]) / 2}" class="lb sm">${L('Entrance', 'Ingresso')}</text>${tables}</svg>`;
}
