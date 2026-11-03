// Waiter screens: menu, order, table map (tablet), today's history, stock, PIN switch.
import { SECTIONS, TABLES, LATE_MIN, eur, eurShort, esc, $, $$, today, hhmm, ms, roomLabel, uid, dayLabel } from './data.js';
import {
  S, LS, tableRow, tableData, stockLeft, views, tableOp, submitOrder, stockSet, stockNewDay, setAlert, count,
  reopenOrder, deleteOrder, waiterLogin, waiterLogout, logout, openedMs, flush, reload,
} from './store.js';
import { toast, sheet, sheetBody, openSheet, closeSheet, armed, copyText, ticketText, receptionView, buzz } from './ui.js';

let cur = String(LS.get('cur', '1'));
let screen = 'map';                       // tablet only: 'map' or 'order'
export const isTablet = () => document.body.classList.contains('tablet');
export const goOwner = () => { location.hash = '#owner'; };

// ---------- helpers ----------
let itemCache = null, itemSrc = null;
export function ITEM() {
  if (itemSrc !== S.menu) { itemSrc = S.menu; itemCache = Object.fromEntries(S.menu.map(m => [m.id, m])); }
  return itemCache;
}
const itemsOf = (sec, all) => S.menu.filter(m => m.section === sec && (all || !m.hidden)).sort((a, b) => a.sort - b.sort);
const fee = () => Number(S.settings.room_fee ?? 10);
function total(d) {
  const I = ITEM(); let s = 0;
  for (const [id, q] of Object.entries(d.items)) s += (I[id] ? Number(I[id].price) : 0) * q;
  if (d.room && count(d)) s += fee();
  return s;
}
const mins = row => { const t = openedMs(row); return t ? Math.max(0, Math.floor((Date.now() - t) / 60000)) : 0; };
const waitLabel = row => { const m = mins(row); return m < 1 ? 'just now' : m + ' min'; };
const orderedLabel = row => { const m = mins(row); return m < 1 ? 'Ordered just now' : 'Ordered ' + m + ' min ago'; };
function toServe(d) { let w = 0; for (const [id, q] of Object.entries(d.items)) w += Math.max(0, q - (d.served[id] || 0)); return w; }
const who = d => [d.client && d.client.trim(), roomLabel(d) ? 'Room ' + roomLabel(d) : ''].filter(Boolean).join(' · ');

// Typing (names, notes) is sent after a short pause, not at every letter
const drafts = {};
function draft(key, fn) { clearTimeout(drafts[key]?.t); drafts[key] = { fn, t: setTimeout(() => { delete drafts[key]; fn(); }, 600) }; }
export function flushDrafts() { for (const k of Object.keys(drafts)) { clearTimeout(drafts[k].t); const f = drafts[k].fn; delete drafts[k]; f(); } }

// History entries in one shape (server rows and orders still waiting to upload)
export function fromServer(o) {
  return {
    key: 's' + o.id, id: o.id, uid: o.uid, table: String(o.table_no), client: o.client, roomNo: o.room_no, building: o.building, waiter: o.waiter_name,
    items: (o.order_lines || []).slice().sort((a, b) => a.pos - b.pos).map(l => ({ id: l.item_id, it: l.name, qty: l.qty, p: Number(l.price), sec: l.section, note: l.note })),
    roomService: o.room_service, roomFee: Number(o.room_fee), note: o.note, total: Number(o.total), closedAt: ms(o.closed_at), status: o.status, day: o.day, source: o.source,
  };
}
function todayOrders() {
  const srv = S.today.filter(o => o.day === today()).map(fromServer);
  const have = new Set(srv.map(o => o.uid));
  const pend = views().pendingOrders.filter(o => !have.has(o.uid)).map(o => ({ ...o, key: 'p' + o.uid, pending: true, status: 'closed' }));
  return [...pend.reverse(), ...srv];
}

function snapshot(n) {
  const d = tableData(n), lines = [], seen = new Set();
  for (const s of SECTIONS) for (const m of itemsOf(s.id, true)) if (d.items[m.id]) {
    seen.add(m.id); lines.push({ id: m.id, it: m.name_it, qty: d.items[m.id], p: Number(m.price), sec: s.it, note: (d.notes[m.id] || '').trim() });
  }
  for (const [id, q] of Object.entries(d.items)) if (!seen.has(id)) lines.push({ id, it: id, qty: q, p: 0, sec: '', note: d.notes[id] || '' });
  const now = Date.now();
  return {
    uid: uid(), table: String(n), client: d.client.trim(), roomNo: d.roomNo.trim(), building: d.building, waiter: S.waiter?.name || '',
    items: lines, roomService: !!d.room, roomFee: d.room ? fee() : 0, note: d.note.trim(), total: total(d), closedAt: now, day: today(),
  };
}

// ---------- the page skeleton ----------
export function mountWork(app) {
  app.innerHTML = `
  <div id="menuCol">
    <header id="hdr">
      <div class="brand"><div class="wbox"><h1>Comande</h1><button class="wchip" id="waiterBtn" aria-label="Change waiter"><span id="waiterName"></span> ▾</button><span class="sync" id="sync" hidden></span></div>
        <div class="right"><button class="hbtn" id="stockBtn"><svg><use href="#i-stock"/></svg><span class="t">Stock</span></button><button class="hbtn" id="histBtn"><svg><use href="#i-hist"/></svg><span class="t">History</span></button><button class="ibtn" id="moreBtn" aria-label="More"><svg><use href="#i-more"/></svg></button></div></div>
      <div class="row">
        <button class="tablebtn" id="tableBtn" aria-label="Choose table"><small id="tableLbl">Tavolo ▾</small><b id="tableNum">1</b></button>
        <div class="search"><input id="q" type="search" placeholder="Find dish or drink…" autocomplete="off" aria-label="Search the menu"><button id="qx" aria-label="Clear search" hidden>×</button></div>
      </div>
      <nav class="tabs" id="tabs" aria-label="Menu sections"></nav>
    </header>
    <div id="mapView"></div>
    <div id="menuArea"><main id="menu"></main><p class="empty-search" id="noRes">Nothing found. Try another word.</p></div>
  </div>
  <aside id="orderPanel" aria-label="Current order"><div class="sh-head"><h3 id="opTitle"></h3></div><div class="sh-body" id="opBody"></div></aside>
  <div class="bar empty" id="bar"><button id="barBtn"><span class="l"><small id="barTable">Tavolo 1</small><b id="barText">Tap a dish to add it</b></span><span class="r num" id="barTotal">€ 0,00</span></button></div>`;

  $('#menu').addEventListener('click', e => {
    const cell = e.target.closest('.cell'); if (!cell) return;
    if (e.target.closest('.minus')) add(cell.dataset.id, -1); else if (e.target.closest('.card')) add(cell.dataset.id, 1);
  });
  $('#tableBtn').onclick = () => { if (isTablet()) { flushDrafts(); screen = 'map'; render(); scrollTo(0, 0); } else { renderTables(); openSheet(sheet('tableSheet', 'Choose table')); } };
  $('#barBtn').onclick = () => { const s = sheet('orderSheet'); openSheet(s); renderOrder(sheetBody(s), true); };
  $('#stockBtn').onclick = () => { openSheet(sheet('stockSheet', 'Stock')); renderStock(); };
  $('#histBtn').onclick = () => { openSheet(sheet('histSheet', 'History · today')); renderHistory(); };
  $('#waiterBtn').onclick = () => openWaiterSheet();
  $('#moreBtn').onclick = () => { openSheet(sheet('moreSheet', 'More')); renderMore(); };
  const q = $('#q');
  q.addEventListener('input', doSearch);
  $('#qx').onclick = () => { q.value = ''; doSearch(); q.focus(); };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', () => { setHH(); onScroll(); });
  document.fonts?.ready.then(setHH);
  sheet('orderSheet').addEventListener('click', e => { if (e.target.id === 'orderSheet' || e.target.closest('[data-close]')) flushDrafts(); });
  menuSig = '';
  render();
  setHH(); onScroll();
}

// ---------- menu ----------
let menuSig = '';
function buildMenu() {
  const sig = JSON.stringify(S.menu.map(m => [m.id, m.name_it, m.name_en, m.price, m.hidden, m.sort, m.section]));
  if (sig === menuSig) return; menuSig = sig;
  const menuEl = $('#menu'), tabsEl = $('#tabs'); menuEl.innerHTML = ''; tabsEl.innerHTML = '';
  for (const s of SECTIONS) {
    const items = itemsOf(s.id); if (!items.length) continue;
    if (s.start) { const l = document.createElement('div'); l.className = 'menu-label'; l.textContent = s.start; menuEl.appendChild(l); }
    const sec = document.createElement('section'); sec.id = 's-' + s.id; sec.style.setProperty('--h', s.h);
    sec.innerHTML = `<h2>${s.it} <em>${s.en}</em></h2><div class="grid">${items.map(m => `
      <div class="cell" data-id="${esc(m.id)}" data-q="${esc((m.name_it + ' ' + m.name_en + ' ' + s.it).toLowerCase())}">
      <button class="card" aria-label="Add ${esc(m.name_it)}"><span class="toprow"><span class="ic"><svg><use href="#i-${s.icon}"/></svg></span><span class="stk" hidden></span></span>
      <span class="nm">${esc(m.name_it)}</span><span class="en">${esc(m.name_en)}</span><span class="pr num">${eur(m.price)}</span></button>
      <span class="qty num"></span><button class="minus" aria-label="Remove one ${esc(m.name_it)}">−</button></div>`).join('')}</div>`;
    menuEl.appendChild(sec);
    const t = document.createElement('button'); t.className = 'tab'; t.dataset.s = s.id; t.style.setProperty('--h', s.h);
    t.innerHTML = `<svg><use href="#i-${s.icon}"/></svg>${s.tab}<span class="dot num" hidden></span>`;
    t.onclick = () => document.getElementById('s-' + s.id).scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    tabsEl.appendChild(t);
  }
  if (!S.menu.length) menuEl.innerHTML = '<p class="empty-order">Loading the menu… (needs internet the first time)</p>';
  activeId = ''; doSearch();
}

function add(id, d, silent) {
  if (!S.waiter) { openWaiterSheet(); return; }
  const m = ITEM()[id]; const name = m ? m.name_it : id;
  const before = stockLeft(id);
  let msg = `${d > 0 ? '+1' : '−1'} ${name}`;
  if (d > 0 && before != null && before <= 0) msg = 'Finished! Check with the kitchen · ' + name;
  else if (d > 0 && before === 1) msg = 'That was the last one · ' + name;
  tableOp(cur, { t: 'item', id, d }); buzz();
  if (!silent) toast(msg, 'Undo', () => { add(id, -d, true); toast('Undone'); });
}

// ---------- render everything ----------
export function render() {
  if (!$('#menuCol')) return;
  buildMenu();
  document.body.classList.toggle('scr-map', isTablet() && screen === 'map');
  document.body.classList.toggle('scr-order', isTablet() && screen === 'order');
  const row = tableRow(cur), d = tableData(cur);
  $('#tableNum').textContent = cur;
  $('#tableLbl').textContent = isTablet() ? '‹ Tavoli' : 'Tavolo ▾';
  $$('.cell').forEach(c => { const q = d.items[c.dataset.id] || 0; c.classList.toggle('has', q > 0); c.querySelector('.qty').textContent = q || ''; });
  $$('.tab').forEach(tb => { const q = itemsOf(tb.dataset.s).reduce((a, m) => a + (d.items[m.id] || 0), 0); const dot = tb.querySelector('.dot'); dot.hidden = !q; dot.textContent = q; });
  updateBar(row, d); paintStock(); showWaiter(); showSync();
  if (isTablet()) {
    if (screen === 'map') renderMap(); else { $('#opTitle').textContent = 'Tavolo ' + cur; renderOrder($('#opBody')); }
  }
  const os = document.getElementById('orderSheet');
  if (os && !os.hidden) { if (isTablet()) closeSheet(os); else renderOrder(sheetBody(os)); }
  if (!document.getElementById('histSheet')?.hidden) renderHistory();
  if (!document.getElementById('stockSheet')?.hidden) renderStock();
  if (!document.getElementById('tableSheet')?.hidden) renderTables();
  if (!document.getElementById('moreSheet')?.hidden) renderMore();
}
export function modeChanged() { // phone <-> tablet
  $('#opBody') && ($('#opBody').innerHTML = '');
  const os = document.getElementById('orderSheet'); if (os) sheetBody(os).innerHTML = '';
  if (!isTablet()) screen = 'order'; else if (screen !== 'order') screen = 'map';
  render(); setHH();
}

function updateBar(row, d) {
  const n = count(d), w = who(d);
  $('#bar').classList.toggle('empty', !n);
  $('#barTable').textContent = 'Tavolo ' + cur + (w ? ' · ' + w : '');
  $('#barText').textContent = n ? `${n} item${n > 1 ? 's' : ''} · ${waitLabel(row)} · View order` : 'Tap a dish to add it';
  $('#barTotal').textContent = eur(total(d));
}
function showWaiter() { $('#waiterName').textContent = S.waiter?.name || 'Who are you?'; $('#waiterBtn').classList.toggle('unset', !S.waiter); }
function showSync() {
  const el = $('#sync'), n = S.queue.length;
  if (S.sync === 'error') { el.hidden = false; el.className = 'sync err'; el.textContent = 'Log in again'; }
  else if (n && (S.sync === 'offline' || !navigator.onLine)) { el.hidden = false; el.className = 'sync'; el.textContent = `Offline · ${n} waiting`; }
  else if (!navigator.onLine) { el.hidden = false; el.className = 'sync'; el.textContent = 'Offline'; }
  else el.hidden = true;
}

// ---------- active tab while scrolling + search ----------
function setHH() { const h = $('#hdr'); if (h) document.documentElement.style.setProperty('--hh', h.offsetHeight + 'px'); }
let activeId = '';
function onScroll() {
  const hdr = $('#hdr'); if (!hdr) return;
  const lim = hdr.getBoundingClientRect().bottom + 20; let c = '';
  for (const s of $$('#menu section')) { if (!c) c = s.id; if (s.offsetParent && s.getBoundingClientRect().top <= lim) c = s.id; }
  if (c === activeId) return; activeId = c;
  const tabsEl = $('#tabs');
  $$('.tab').forEach(tb => { const on = 's-' + tb.dataset.s === c; tb.classList.toggle('on', on);
    if (on) tabsEl.scrollTo({ left: tb.offsetLeft - tabsEl.clientWidth / 2 + tb.offsetWidth / 2, behavior: 'smooth' }); });
}
function doSearch() {
  const q = $('#q'); if (!q) return;
  const v = q.value.trim().toLowerCase(); $('#qx').hidden = !v; let any = false;
  $$('#menu section').forEach(sec => { let vis = 0; sec.querySelectorAll('.cell').forEach(c => { const m = !v || c.dataset.q.includes(v); c.hidden = !m; if (m) vis++; }); sec.hidden = !vis; if (vis) any = true; });
  $$('.menu-label').forEach(l => { l.hidden = !!v; });
  $('#noRes').style.display = any || !S.menu.length ? 'none' : 'block';
  activeId = ''; onScroll();
}

// ---------- stock colors on cards ----------
const alertN = () => Number(S.settings.stock_alert ?? 2);
function level(n) { if (n == null) return ''; if (n <= 0) return 'out'; if (n <= alertN()) return 'warn'; return 'ok'; }
const stockLabel = n => n <= 0 ? 'Finished' : n + ' left';
function paintStock() {
  $$('.cell').forEach(c => {
    const n = stockLeft(c.dataset.id), lv = level(n), p = c.querySelector('.stk');
    c.classList.remove('lvl-ok', 'lvl-warn', 'lvl-out'); if (lv) c.classList.add('lvl-' + lv);
    p.hidden = !lv; p.className = 'stk ' + lv; p.textContent = lv ? stockLabel(n) : '';
  });
}

// ---------- the order (phone: bottom sheet · tablet: right panel) ----------
function renderOrder(body, force) {
  const ae = document.activeElement;
  if (!force && ae && body.contains(ae) && /INPUT|TEXTAREA/.test(ae.tagName)) return;
  const n = cur, row = tableRow(n), d = tableData(n), k = count(d);
  const os = document.getElementById('orderSheet'); if (os) os.querySelector('h3').textContent = 'Tavolo ' + n;
  const ws = k ? toServe(d) : 0;
  let h = (k ? `<p class="ostat"><span class="osWait">${orderedLabel(row)}</span>${row?.waiter_name ? ' · ' + esc(row.waiter_name) : ''} · ${ws ? `<b>${ws} to serve</b>` : '<b class="done">All served ✓</b>'}</p>` : '') +
    `<div class="fields"><label>Client name<input id="cname" type="text" autocomplete="off" placeholder="e.g. Rossi" value="${esc(d.client)}"></label>
    <label>Room<input id="croom" type="text" inputmode="numeric" autocomplete="off" placeholder="e.g. 214" value="${esc(d.roomNo)}"></label></div>
    <div class="bld" id="bld" role="group" aria-label="Building"><span>Building</span><button data-b="HCO" class="${d.building === 'HCO' ? 'on' : ''}"><b>HCO</b> Concordia</button><button data-b="DEP" class="${d.building === 'DEP' ? 'on' : ''}"><b>DEP</b> Dépendance</button></div>`;
  if (!k) {
    body.innerHTML = h + `<p class="empty-order">No items yet.<br>${isTablet() ? 'Tap dishes on the menu on the left.' : 'Close this and tap dishes on the menu.'}</p>`;
    bindFields(body, n); return;
  }
  for (const s of SECTIONS) {
    const lines = itemsOf(s.id, true).filter(m => d.items[m.id]); if (!lines.length) continue;
    h += `<div class="grp">${s.it}</div>`;
    for (const m of lines) {
      const q = d.items[m.id], sv = d.served[m.id] || 0, nt = d.notes[m.id] || '', id = esc(m.id);
      h += `<div class="line${sv >= q ? ' served' : ''}"><div class="t">${esc(m.name_it)}<small>${esc(m.name_en)}</small></div>
      <div class="step"><button data-d="-1" data-id="${id}" aria-label="One less">−</button><span class="n num">${q}</span><button data-d="1" data-id="${id}" aria-label="One more">+</button></div>
      <div class="lt num">${q} × ${eur(m.price)} = <b>${eur(q * m.price)}</b></div>
      <div class="lx"><button class="srv${sv >= q ? ' on' : ''}" data-srv="${id}">${sv >= q ? '✓ Served' : `Served ${sv}/${q}`}</button><button class="nb" data-nb="${id}">${nt ? 'Edit note' : '+ Note'}</button></div>
      <input class="inote" data-inote="${id}" type="text" autocomplete="off" placeholder="Note for this dish (e.g. no pepper)" value="${esc(nt)}" ${nt ? '' : 'hidden'}></div>`;
    }
  }
  h += `<div class="opt"><label for="room">Room service<small>Supplemento servizio in camera ${eur(fee())}</small></label><input type="checkbox" id="room" ${d.room ? 'checked' : ''}></div>
  <textarea id="note" placeholder="Notes for kitchen (e.g. no cheese, allergy)…">${esc(d.note)}</textarea>
  <div class="total"><span>Totale</span><b class="num">${eur(total(d))}</b></div>
  <div class="actions"><button class="btn" id="copyBtn">Copy order</button><button class="btn primary" id="closeBtn">Send to reception</button>
  <button class="btn wide" id="recvBtn">Reception view (big text)</button></div>
  <p class="status">“Send to reception” saves the order in History and copies it. Clients pay at reception.</p>
  <button class="linkbtn" id="clearBtn">Delete order without saving</button>
  <div id="copyFallback"></div>`;
  const keep = body.scrollTop; body.innerHTML = h; body.scrollTop = keep;
  bindFields(body, n);
  body.querySelectorAll('.step button').forEach(b => { b.onclick = () => add(b.dataset.id, +b.dataset.d); });
  body.querySelectorAll('[data-srv]').forEach(b => { b.onclick = () => { const id = b.dataset.srv, q = d.items[id], sv = d.served[id] || 0; tableOp(n, { t: 'served', id, n: sv >= q ? 0 : sv + 1 }); buzz(); }; });
  body.querySelectorAll('[data-nb]').forEach(b => { b.onclick = () => { const i = body.querySelector(`[data-inote="${CSS.escape(b.dataset.nb)}"]`); i.hidden = false; i.focus(); }; });
  body.querySelectorAll('[data-inote]').forEach(i => { i.oninput = () => { const id = i.dataset.inote, v = i.value; draft('in' + n + id, () => tableOp(n, { t: 'inote', id, note: v })); }; i.onblur = flushDrafts; });
  $('#room', body).onchange = e => tableOp(n, { t: 'set', fields: { room: e.target.checked } });
  const note = $('#note', body); note.oninput = () => { const v = note.value; draft('note' + n, () => tableOp(n, { t: 'set', fields: { note: v } })); }; note.onblur = flushDrafts;
  $('#closeBtn', body).onclick = () => closeTable(n);
  $('#recvBtn', body).onclick = () => { flushDrafts(); receptionView({ ...snapshot(n), closedAt: 0 }); };
  armed($('#clearBtn', body), 'Tap again to delete', () => { flushDrafts(); tableOp(n, { t: 'clear' }); toast('Tavolo ' + n + ' deleted'); if (isTablet()) screen = 'map'; else closeSheet(sheet('orderSheet')); render(); });
  $('#copyBtn', body).onclick = async () => { flushDrafts(); if (await copyText(ticketText(snapshot(n)), $('#copyFallback', body))) toast('Order copied'); };
}

function bindFields(body, n) {
  const cn = $('#cname', body), cr = $('#croom', body);
  cn.oninput = () => { const v = cn.value; draft('c' + n, () => tableOp(n, { t: 'set', fields: { client: v } })); };
  cr.oninput = () => { const v = cr.value; draft('r' + n, () => tableOp(n, { t: 'set', fields: { roomNo: v } })); };
  cn.onblur = cr.onblur = flushDrafts;
  body.querySelectorAll('#bld [data-b]').forEach(b => { b.onclick = () => {
    flushDrafts(); const d = tableData(n); tableOp(n, { t: 'set', fields: { building: d.building === b.dataset.b ? '' : b.dataset.b } }); $('#bld', body).classList.remove('need');
  }; });
}

async function closeTable(n) {
  if (!S.waiter) { openWaiterSheet(); return; }
  flushDrafts();
  const d = tableData(n); if (!count(d)) return;
  if (d.roomNo.trim() && !d.building) {
    const b = $('#bld'); if (b) { b.classList.add('need'); b.scrollIntoView({ block: 'center' }); }
    toast('Choose the building: HCO or DEP'); return;
  }
  const o = snapshot(n);
  copyText(ticketText(o));
  submitOrder(o);
  if (isTablet()) { screen = 'map'; scrollTo(0, 0); } else closeSheet(sheet('orderSheet'));
  render();
  toast(`Tavolo ${n} sent · ${eur(o.total)} · order copied`, 'Show', () => receptionView(o), 6000);
}

export function openTable(n) {
  flushDrafts(); cur = String(n); LS.set('cur', cur);
  if (isTablet()) { screen = 'order'; scrollTo(0, 0); }
  render();
}

// ---------- table map (tablet home) ----------
function renderMap() {
  const v = views().tables; let open = 0, sum = 0;
  let tiles = '';
  for (let i = 1; i <= TABLES; i++) {
    const row = v[i], d = tableData(i), k = count(d), m = mins(row), late = k && m >= LATE_MIN, ws = toServe(d);
    if (k) { open++; sum += total(d); }
    tiles += `<button class="tile${k ? ' open' : ''}${late ? ' late' : ''}" data-t="${i}" aria-label="Table ${i}${k ? ', open' : ''}">
      <b class="n">${i}</b>${k ? `<span class="min num${late ? ' late' : ''}">${m}′</span>` : ''}
      ${d.client ? `<span class="c">${esc(d.client)}</span>` : ''}${roomLabel(d) ? `<span class="m">Room ${esc(roomLabel(d))}</span>` : ''}
      ${k && row?.waiter_name ? `<span class="m">${esc(row.waiter_name)}</span>` : ''}
      ${k ? `<span class="serve${ws ? '' : ' done'}">${ws ? ws + ' to serve' : 'All served ✓'}</span><span class="tot num">${eur(total(d))}</span>` : '<span class="free">Free</span>'}</button>`;
  }
  $('#mapView').innerHTML = `<div class="maplegend"><span><i></i>Free</span><span><i class="o"></i>Open order</span><span><i class="l"></i>Waiting ${LATE_MIN}+ min</span>
    <span style="margin-left:auto"><b class="num">${open}</b> open · <b class="num">${eur(sum)}</b> not sent yet</span></div><div class="map">${tiles}</div>`;
  $$('#mapView .tile').forEach(b => { b.onclick = () => openTable(b.dataset.t); });
}

// phone: choose table sheet
function renderTables() {
  const s = sheet('tableSheet'); const v = views().tables;
  let h = '<p class="hint">Gold tables have an open order. The number under it is the bill so far.</p><div class="tgrid">';
  for (let i = 1; i <= TABLES; i++) {
    const k = String(i), d = tableData(i), o = count(d) > 0, m = mins(v[i]);
    h += `<button class="tg${o ? ' open' : ''}${k === cur ? ' cur' : ''}" data-t="${k}"><b>${i}</b><small class="num">${o ? eurShort(total(d)) : ''}</small>${o ? `<small class="tw${m >= LATE_MIN ? ' late' : ''}">${m}′</small>` : ''}</button>`;
  }
  sheetBody(s).innerHTML = h + '</div>';
  sheetBody(s).querySelectorAll('.tg').forEach(b => { b.onclick = () => { closeSheet(s); openTable(b.dataset.t); toast('Tavolo ' + b.dataset.t); }; });
}

// ---------- history of today ----------
let histWaiter = 'all';
function dayText(list) {
  const [Y, M, D] = today().split('-');
  let out = `COMANDE ${D}/${M}/${Y}` + (histWaiter !== 'all' ? ` · ${histWaiter}` : '') + '\n';
  [...list].reverse().forEach(o => {
    out += `\n${hhmm(o.closedAt)} Tavolo ${o.table}` + (o.client ? ` · ${o.client}` : '') + (roomLabel(o) ? ` · Camera ${roomLabel(o)}` : '') + ` · ${o.waiter} — ${eur(o.total)}\n`;
    o.items.forEach(l => { out += `  ${l.qty}x ${l.it}${l.note ? ` — ${l.note}` : ''}\n`; });
    if (o.roomService) out += '  Servizio in camera\n'; if (o.note) out += `  Note: ${o.note}\n`;
  });
  return out + `\nTOTALE GIORNO ${eur(list.reduce((a, o) => a + o.total, 0))} (${list.length} tavoli)`;
}
export function orderCard(o, opts = {}) {
  return `<div class="ho${o.status === 'reopened' ? ' reopened' : ''}"><div class="ho-top"><div class="ho-t">Tavolo ${esc(o.table)}<small>${opts.withDay ? esc(dayLabel(o.day)) + ' · ' : ''}${hhmm(o.closedAt)} · ${esc(o.waiter || '—')}${o.pending ? '<span class="waitbadge">waiting to upload</span>' : ''}${o.status === 'reopened' ? '<span class="waitbadge">reopened · not counted</span>' : ''}${o.source === 'import' ? ' · old app' : ''}</small></div><div class="ho-tot num">${eur(o.total)}</div>
    ${(o.client || roomLabel(o)) ? `<div class="ho-who">${esc(o.client || '—')}${roomLabel(o) ? `<span class="rm">Room ${esc(roomLabel(o))}</span>` : ''}</div>` : ''}</div>
    <ul class="ho-items">${o.items.map(l => `<li><b>${l.qty}×</b> ${esc(l.it)}${l.note ? ` <i>(${esc(l.note)})</i>` : ''} <span class="num">· ${eur(l.qty * l.p)}</span></li>`).join('')}
    ${o.roomService ? `<li><b>+</b> Room service · ${eur(o.roomFee || 10)}</li>` : ''}</ul>
    ${o.note ? `<div class="ho-note">Note: ${esc(o.note)}</div>` : ''}
    <div class="ho-act"><button data-recv="${o.key}">Reception view</button>${!o.pending && o.status === 'closed' && opts.reopen !== false ? `<button data-reopen="${o.key}">Reopen</button>` : ''}${S.role === 'owner' && !o.pending ? `<button class="del" data-del="${o.key}">Delete</button>` : ''}</div></div>`;
}
export function bindOrderCards(body, list, after) {
  const byKey = Object.fromEntries(list.map(o => [o.key, o]));
  body.querySelectorAll('[data-recv]').forEach(b => { b.onclick = () => receptionView(byKey[b.dataset.recv]); });
  body.querySelectorAll('[data-reopen]').forEach(b => { b.onclick = async () => {
    const o = byKey[b.dataset.reopen]; b.disabled = true;
    try { await reopenOrder(o.id); closeSheet(sheet('histSheet')); toast(`Tavolo ${o.table} reopened`); if (location.hash === '#owner') location.hash = ''; openTable(o.table); }
    catch (e) { toast(e.message); b.disabled = false; }
  }; });
  body.querySelectorAll('[data-del]').forEach(b => armed(b, 'Tap again', async () => {
    const o = byKey[b.dataset.del];
    const reason = prompt(`Delete the order of Tavolo ${o.table} (${eur(o.total)})?\nIt stays in the audit log.\nReason (optional):`, '');
    if (reason === null) return;
    try { await deleteOrder(o.id, reason); toast('Order deleted · saved in the audit log'); after && after(); } catch (e) { toast(e.message); }
  }));
}
function renderHistory() {
  const s = sheet('histSheet'), body = sheetBody(s);
  const all = todayOrders(), counted = all.filter(o => o.status === 'closed');
  const names = [...new Set([...S.waiters.filter(w => w.active).map(w => w.name), ...all.map(o => o.waiter || '—')])];
  if (histWaiter !== 'all' && !names.includes(histWaiter)) histWaiter = 'all';
  const list = all.filter(o => histWaiter === 'all' || o.waiter === histWaiter);
  const cl = list.filter(o => o.status === 'closed');
  const sum = cl.reduce((a, o) => a + o.total, 0), items = cl.reduce((a, o) => a + o.items.reduce((b, l) => b + l.qty, 0), 0);
  let h = `<div class="days">${['all', ...names].map(w => { const tot = counted.filter(o => w === 'all' || o.waiter === w).reduce((a, o) => a + o.total, 0); return `<button class="day${w === histWaiter ? ' on' : ''}" data-w="${esc(w)}">${w === 'all' ? 'Everyone' : esc(w)} · <span class="num">${eurShort(tot)}</span></button>`; }).join('')}</div>
    <div class="sum"><small>Total · Today</small><b class="num">${eur(sum)}</b><span class="num">${cl.length} table${cl.length === 1 ? '' : 's'} sent · ${items} items</span></div>`;
  if (S.role === 'owner') h += `<div class="actions" style="grid-template-columns:1fr"><button class="btn" id="toOwner">Full history & dashboard →</button></div>`;
  const v = views().tables, open = Object.keys(v).filter(k => count(tableData(k))).sort((a, b) => a - b);
  if (open.length) {
    h += '<div class="subhead">Not sent yet · not in total</div>';
    open.forEach(n => { const d = tableData(n);
      h += `<div class="ho open"><div class="ho-top"><div class="ho-t">Tavolo ${n}<small>${waitLabel(v[n])}${toServe(d) ? ` · ${toServe(d)} to serve` : ''}${v[n]?.waiter_name ? ' · ' + esc(v[n].waiter_name) : ''}</small></div><div class="ho-tot num">${eur(total(d))}</div>
        ${who(d) ? `<div class="ho-who">${esc(d.client || '')}${roomLabel(d) ? `<span class="rm">Room ${esc(roomLabel(d))}</span>` : ''}</div>` : ''}</div>
        <div class="ho-act"><button data-go="${n}">Go to table</button></div></div>`; });
  }
  h += '<div class="subhead">Sent to reception</div>';
  if (!list.length) h += '<p class="empty-order">Nothing sent yet today.<br>When the order is complete, open it and tap “Send to reception”.</p>';
  h += list.map(o => orderCard(o)).join('');
  if (cl.length) h += `<div class="actions" style="grid-template-columns:1fr"><button class="btn primary" id="copyDay">Copy day summary</button></div><div id="dayFallback"></div>`;
  h += `<p class="status">${syncText()}</p>`;
  const keep = body.scrollTop; body.innerHTML = h; body.scrollTop = keep;
  body.querySelectorAll('[data-w]').forEach(b => { b.onclick = () => { histWaiter = b.dataset.w; renderHistory(); }; });
  body.querySelectorAll('[data-go]').forEach(b => { b.onclick = () => { closeSheet(s); openTable(b.dataset.go); if (!isTablet()) { const os = sheet('orderSheet'); openSheet(os); renderOrder(sheetBody(os), true); } }; });
  bindOrderCards(body, list);
  const to = $('#toOwner', body); if (to) to.onclick = () => { closeSheet(s); goOwner(); };
  const cd = $('#copyDay', body); if (cd) cd.onclick = async () => { if (await copyText(dayText(cl), $('#dayFallback', body))) toast('Day summary copied'); };
}
export function syncText() {
  const n = S.queue.length;
  if (S.sync === 'error') return 'Your login expired: open More → Log out, then log in again. ' + (n ? n + ' changes are kept on this device.' : '');
  if (n) return `${n} change${n > 1 ? 's' : ''} waiting to upload. ${navigator.onLine ? 'Uploading…' : 'No internet: they are kept on this device and sent when internet is back.'}`;
  return navigator.onLine ? 'Everything saved online. Safe even if you close the app.' : 'No internet now. New changes are kept on this device.';
}

// ---------- stock ----------
function renderStock() {
  const s = sheet('stockSheet'), body = sheetBody(s);
  let h = `<p class="hint">Tap + or − to set how many portions are left. Each dish you add to an order takes one away by itself.</p>
  <div class="legend"><span class="stk ok">In stock</span><span class="stk warn">Almost finished</span><span class="stk out">Finished</span></div>
  <div class="srow"><div class="t">Orange when left is<small>“Almost finished” warning</small></div>
    <div class="step"><button data-alert="-1" aria-label="Lower">−</button><span class="n num">${alertN()}</span><button data-alert="1" aria-label="Higher">+</button></div></div>`;
  for (const sec of SECTIONS.filter(x => x.food)) {
    h += `<div class="grp">${sec.it}</div>`;
    for (const m of itemsOf(sec.id)) {
      const n = stockLeft(m.id), lv = level(n), id = esc(m.id);
      h += `<div class="srow"><div class="t">${esc(m.name_it)}<small>${lv ? `<span class="stk ${lv}">${stockLabel(n)}</span> <button class="stop" data-stop="${id}">stop counting</button>` : 'Not counted'}</small></div>
        <div class="step"><button data-s="${id}" data-d="-1" aria-label="One less">−</button><span class="${lv ? 'n num' : 'off'}">${lv ? Math.max(0, n) : '—'}</span><button data-s="${id}" data-d="1" aria-label="One more">+</button></div></div>`;
    }
  }
  h += `<div class="actions" style="grid-template-columns:1fr"><button class="btn" id="newCount">Start new day count</button></div>
  <p class="status">New day: tap this (all counts go back to “not counted”), then set today's numbers.</p>`;
  const keep = body.scrollTop; body.innerHTML = h; body.scrollTop = keep;
  body.querySelectorAll('[data-alert]').forEach(b => { b.onclick = () => setAlert(Math.max(0, Math.min(10, alertN() + +b.dataset.alert))).catch(e => toast('Needs internet: ' + e.message)); });
  body.querySelectorAll('[data-s]').forEach(b => { b.onclick = () => {
    const id = b.dataset.s, n = stockLeft(id), d = +b.dataset.d;
    if (n == null) { if (d > 0) stockSet(id, 1); return; }
    stockSet(id, Math.max(0, Math.max(0, n) + d));
  }; });
  body.querySelectorAll('[data-stop]').forEach(b => { b.onclick = () => stockSet(b.dataset.stop, null); });
  const nb = $('#newCount', body); nb.classList.add('warn');
  armed(nb, 'Tap again to start new count', () => { stockNewDay(); toast('New count started'); });
}

// ---------- waiter switch with PIN ----------
export function pinPicker(container, onDone) {
  const list = S.waiters.filter(w => w.active);
  container.innerHTML = `<p class="hint">Choose your name, then type your 4-number PIN.</p>
    <div class="pinwho">${list.map(w => `<button class="wpick${w.id === S.waiter?.id ? ' on' : ''}" data-w="${w.id}">${esc(w.name)}</button>`).join('') || '<p class="hint">No waiters yet. The owner adds them in Owner → Waiters.</p>'}</div>`;
  container.querySelectorAll('[data-w]').forEach(b => { b.onclick = () => pad(list.find(w => w.id === b.dataset.w)); });
  function pad(w) {
    let pin = '';
    container.innerHTML = `<div class="pinpad"><h4>${esc(w.name)}</h4><div class="dots">${'<i></i>'.repeat(4)}</div><p class="err" style="text-align:center"></p>
      <div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(k => `<button data-k="${k}">${k}</button>`).join('')}<button class="ghost" data-back>‹ Names</button><button data-k="0">0</button><button class="ghost" data-del aria-label="Delete digit">⌫</button></div></div>`;
    const dots = container.querySelectorAll('.dots i'), err = container.querySelector('.err');
    const show = () => dots.forEach((d, i) => d.classList.toggle('on', i < pin.length));
    container.querySelector('[data-back]').onclick = () => pinPicker(container, onDone);
    container.querySelector('[data-del]').onclick = () => { pin = pin.slice(0, -1); show(); };
    container.querySelectorAll('[data-k]').forEach(b => { b.onclick = async () => {
      if (pin.length >= 4) return; pin += b.dataset.k; show(); err.textContent = '';
      if (pin.length < 4) return;
      try { await waiterLogin(w, pin); onDone(); toast('Hi ' + w.name + '!'); }
      catch (e) { err.textContent = e.message; pin = ''; show(); const p = container.querySelector('.pinpad'); p.classList.remove('shake'); void p.offsetWidth; p.classList.add('shake'); }
    }; });
  }
}
export function openWaiterSheet() {
  const s = sheet('waiterSheet', 'Who is working?'); openSheet(s);
  const done = () => { closeSheet(s); render(); };
  pinPicker(sheetBody(s), done);
  // new waiters added by the owner appear at once
  if (navigator.onLine) reload('waiters').then(() => { if (!s.hidden && !sheetBody(s).querySelector('.pinpad')) pinPicker(sheetBody(s), done); });
}

// ---------- More: theme, owner, lock, install, log out ----------
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
export function setTheme(t) {
  LS.set('theme', t);
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
}
function renderMore() {
  const s = sheet('moreSheet'), body = sheetBody(s), th = LS.get('theme', 'auto');
  body.innerHTML = `
    <div class="grp">Theme</div><div class="seg" style="grid-template-columns:repeat(3,1fr)">${['auto', 'light', 'dark'].map(t => `<button data-th="${t}" class="${t === th ? 'on' : ''}">${t === 'auto' ? 'Auto' : t === 'light' ? 'Light' : 'Dark'}</button>`).join('')}</div>
    <div class="grp">Waiter</div>
    <div class="actions"><button class="btn" id="mSwitch">Switch waiter</button><button class="btn" id="mLock">Lock (${esc(S.waiter?.name || '—')} out)</button></div>
    ${S.role === 'owner' ? '<div class="grp">Owner</div><div class="actions" style="grid-template-columns:1fr"><button class="btn primary" id="mOwner">Owner dashboard</button></div>' : ''}
    ${installEvt ? '<div class="actions" style="grid-template-columns:1fr"><button class="btn" id="mInstall">Install the app on this device</button></div>' : ''}
    <div class="grp">Connection</div><p class="hint">${syncText()}</p>
    ${S.queue.length ? '<div class="actions" style="grid-template-columns:1fr"><button class="btn" id="mFlush">Try to upload now</button></div>' : ''}
    <p class="hint">This device is logged in as <b>${esc(S.email)}</b> (${esc(S.role)}).</p>
    <button class="linkbtn" id="mLogout">Log out this device</button>`;
  body.querySelectorAll('[data-th]').forEach(b => { b.onclick = () => { setTheme(b.dataset.th); renderMore(); }; });
  $('#mSwitch', body).onclick = () => { closeSheet(s); openWaiterSheet(); };
  $('#mLock', body).onclick = () => { closeSheet(s); waiterLogout(); };
  const mo = $('#mOwner', body); if (mo) mo.onclick = () => { closeSheet(s); goOwner(); };
  const mi = $('#mInstall', body); if (mi) mi.onclick = async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; renderMore(); };
  const mf = $('#mFlush', body); if (mf) mf.onclick = () => { flush(); toast('Uploading…'); };
  armed($('#mLogout', body), 'Tap again to log out', () => logout());
}

// minutes on tiles/bars move on their own
setInterval(() => { if ($('#menuCol') && !document.hidden) { const a = document.activeElement; if (!(a && /INPUT|TEXTAREA/.test(a.tagName))) render(); else { $$('.osWait').forEach(el => { el.textContent = orderedLabel(tableRow(cur)); }); } } }, 30000);
