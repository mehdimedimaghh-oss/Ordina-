// Waiter screens: menu, order, table map (tablet), today's history, stock, PIN switch.
import { SECTIONS, TABLES, LATE_MIN, eur, eurShort, esc, $, $$, today, hhmm, ms, roomLabel, uid, dayLabel } from './data.js';
import {
  S, LS, tableRow, tableData, stockLeft, views, tableOp, submitOrder, stockSet, stockNewDay, setAlert, count,
  reopenOrder, deleteOrder, waiterLogin, waiterLogout, logout, openedMs, flush, reload, roofOfApp, chairsAt, moveChairs,
} from './store.js';
import { toast, sheet, sheetBody, openSheet, closeSheet, armed, copyText, ticketText, receptionView, buzz } from './ui.js';
import { t, tServer, getLang, chooseLang, langForWaiter } from './i18n.js';

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
const mins = row => { const o = openedMs(row); return o ? Math.max(0, Math.floor((Date.now() - o) / 60000)) : 0; };
const waitLabel = row => { const m = mins(row); return m < 1 ? t('justNow') : t('minN', { m }); };
const orderedLabel = row => { const m = mins(row); return m < 1 ? t('orderedNow') : t('orderedAgo', { m }); };
export const coversLabel = n => (n === 1 ? t('covers1') : t('coversN', { n }));
function toServe(d) { let w = 0; for (const [id, q] of Object.entries(d.items)) w += Math.max(0, q - (d.served[id] || 0)); return w; }
const who = d => [d.client && d.client.trim(), roomLabel(d) ? t('room') + ' ' + roomLabel(d) : ''].filter(Boolean).join(' · ');

// Typing (names, notes) is sent after a short pause, not at every letter
const drafts = {};
function draft(key, fn) { clearTimeout(drafts[key]?.t); drafts[key] = { fn, t: setTimeout(() => { delete drafts[key]; fn(); }, 600) }; }
export function flushDrafts() { for (const k of Object.keys(drafts)) { clearTimeout(drafts[k].t); const f = drafts[k].fn; delete drafts[k]; f(); } }
// never lose typed letters: save them when the app goes to the background, closes, or reloads for an update
addEventListener('pagehide', flushDrafts);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushDrafts(); });

// History entries in one shape (server rows and orders still waiting to upload)
export function fromServer(o) {
  return {
    key: 's' + o.id, id: o.id, uid: o.uid, table: String(o.table_no), client: o.client, roomNo: o.room_no, building: o.building, waiter: o.waiter_name,
    items: (o.order_lines || []).slice().sort((a, b) => a.pos - b.pos).map(l => ({ id: l.item_id, it: l.name, qty: l.qty, p: Number(l.price), sec: l.section, note: l.note })),
    roomService: o.room_service, roomFee: Number(o.room_fee), note: o.note, total: Number(o.total), closedAt: ms(o.closed_at), status: o.status, day: o.day, source: o.source, chargedAt: ms(o.charged_at), chargedBy: o.charged_by, covers: o.covers || 0,
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
    uid: uid(), table: String(n), client: d.client.trim(), roomNo: d.roomNo.trim(), building: d.building, waiter: S.waiter?.name || '', covers: d.covers || 0,
    items: lines, roomService: !!d.room, roomFee: d.room ? fee() : 0, note: d.note.trim(), total: total(d), closedAt: now, day: today(),
  };
}

// ---------- the page skeleton ----------
export function mountWork(app) {
  app.innerHTML = `
  <div id="menuCol">
    <header id="hdr">
      <div class="brand"><div class="wbox"><h1><img class="hlogo" src="/logo.png" alt="" width="30" height="30">Comande</h1><button class="wchip" id="waiterBtn" aria-label="${t('changeWaiter')}"><span id="waiterName"></span> ▾</button><span class="sync" id="sync" hidden></span></div>
        <div class="right"><button class="hbtn" id="stockBtn"><svg><use href="#i-stock"/></svg><span class="t">${t('stock')}</span></button><button class="hbtn" id="histBtn"><svg><use href="#i-hist"/></svg><span class="t">${t('history')}</span></button><button class="ibtn lang" id="langBtn" aria-label="${t('language')}">${getLang().toUpperCase()}</button><button class="ibtn" id="moreBtn" aria-label="${t('more')}"><svg><use href="#i-more"/></svg></button></div></div>
      <div class="row">
        <button class="tablebtn" id="tableBtn" aria-label="${t('chooseTable')}"><small id="tableLbl">${t('tableBtn')}</small><b id="tableNum">1</b></button>
        <div class="search"><input id="q" type="search" placeholder="${t('search')}" autocomplete="off" aria-label="${t('searchLabel')}"><button id="qx" aria-label="${t('clearSearch')}" hidden>×</button></div>
      </div>
      <nav class="tabs" id="tabs" aria-label="Menu sections"></nav>
    </header>
    <div id="mapView"></div>
    <div id="menuArea"><main id="menu"></main><p class="empty-search" id="noRes">${t('nothingFound')}</p></div>
  </div>
  <aside id="orderPanel" aria-label="Current order"><div class="sh-head"><h3 id="opTitle"></h3></div><div class="sh-body" id="opBody"></div></aside>
  <div class="bar empty" id="bar"><button id="barBtn"><span class="l"><small id="barTable">Tavolo 1</small><b id="barText">${t('tapDish')}</b></span><span class="r num" id="barTotal">€ 0,00</span></button></div>`;

  $('#menu').addEventListener('click', e => {
    const cell = e.target.closest('.cell'); if (!cell) return;
    if (e.target.closest('.minus')) add(cell.dataset.id, -1); else if (e.target.closest('.card')) add(cell.dataset.id, 1);
  });
  $('#tableBtn').onclick = () => { if (isTablet()) { flushDrafts(); screen = 'map'; render(); scrollTo(0, 0); } else { renderTables(); openSheet(sheet('tableSheet', t('chooseTable'))); } };
  $('#barBtn').onclick = () => { const s = sheet('orderSheet'); openSheet(s); renderOrder(sheetBody(s), true); };
  $('#stockBtn').onclick = () => { openSheet(sheet('stockSheet', t('stock'))); renderStock(); };
  $('#histBtn').onclick = () => { openSheet(sheet('histSheet', t('history') + ' · ' + (getLang() === 'it' ? 'oggi' : 'today'))); renderHistory(); };
  $('#waiterBtn').onclick = () => openWaiterSheet();
  $('#moreBtn').onclick = () => { openSheet(sheet('moreSheet', t('more'))); renderMore(); };
  $('#langBtn').onclick = () => toggleLang();
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
      <button class="card" aria-label="${esc(t('add', { name: m.name_it }))}"><span class="toprow"><span class="ic"><svg><use href="#i-${s.icon}"/></svg></span><span class="stk" hidden></span></span>
      <span class="nm">${esc(m.name_it)}</span><span class="en">${esc(m.name_en)}</span><span class="pr num">${eur(m.price)}</span></button>
      <span class="qty num"></span><button class="minus" aria-label="${esc(t('removeOne', { name: m.name_it }))}">−</button></div>`).join('')}</div>`;
    menuEl.appendChild(sec);
    const tb = document.createElement('button'); tb.className = 'tab'; tb.dataset.s = s.id; tb.style.setProperty('--h', s.h);
    tb.innerHTML = `<svg><use href="#i-${s.icon}"/></svg>${s.tab}<span class="dot num" hidden></span>`;
    tb.onclick = () => document.getElementById('s-' + s.id).scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    tabsEl.appendChild(tb);
  }
  if (!S.menu.length) menuEl.innerHTML = `<p class="empty-order">${t('loadingMenu')}</p>`;
  activeId = ''; doSearch();
}

function add(id, d, silent) {
  if (!S.waiter) { openWaiterSheet(); return; }
  const m = ITEM()[id]; const name = m ? m.name_it : id;
  const before = stockLeft(id);
  let msg = `${d > 0 ? '+1' : '−1'} ${name}`;
  if (d > 0 && before != null && before <= 0) msg = t('finishedKitchen', { name });
  else if (d > 0 && before === 1) msg = t('lastOne', { name });
  tableOp(cur, { t: 'item', id, d }); buzz();
  if (!silent) toast(msg, t('undo'), () => { add(id, -d, true); toast(t('undone')); });
}

// ---------- render everything ----------
export function render() {
  if (!$('#menuCol')) return;
  buildMenu();
  document.body.classList.toggle('scr-map', isTablet() && screen === 'map');
  document.body.classList.toggle('scr-order', isTablet() && screen === 'order');
  const row = tableRow(cur), d = tableData(cur);
  $('#tableNum').textContent = cur;
  $('#tableLbl').textContent = isTablet() ? t('tablesBack') : t('tableBtn');
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
  if (!document.getElementById('chairSheet')?.hidden) renderChairSheet();
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
  $('#barTable').textContent = 'Tavolo ' + cur + (d.covers ? ' · ' + coversLabel(d.covers) : '') + (w ? ' · ' + w : '');
  $('#barText').textContent = n ? `${n === 1 ? t('items1') : t('itemsN', { n })} · ${waitLabel(row)} · ${t('viewOrder')}` : t('tapDish');
  $('#barTotal').textContent = eur(total(d));
}
function showWaiter() { $('#waiterName').textContent = S.waiter?.name || t('whoAreYou'); $('#waiterBtn').classList.toggle('unset', !S.waiter); }
function showSync() {
  const el = $('#sync'), n = S.queue.length;
  if (S.sync === 'error') { el.hidden = false; el.className = 'sync err'; el.textContent = t('loginAgain'); }
  else if (n && (S.sync === 'offline' || !navigator.onLine)) { el.hidden = false; el.className = 'sync'; el.textContent = t('offlineWaiting', { n }); }
  else if (!navigator.onLine) { el.hidden = false; el.className = 'sync'; el.textContent = t('offline'); }
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
const stockLabel = n => n <= 0 ? t('finished') : t('left', { n });
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
  let h = (k ? `<p class="ostat"><span class="osWait">${orderedLabel(row)}</span>${row?.waiter_name ? ' · ' + esc(row.waiter_name) : ''} · ${ws ? `<b>${t('toServe', { n: ws })}</b>` : `<b class="done">${t('allServed')}</b>`}</p>` : '') +
    `<div class="fields"><label>${t('clientName')}<input id="cname" type="text" autocomplete="off" placeholder="${t('egClient')}" value="${esc(d.client)}"></label>
    <label>${t('room')}<input id="croom" type="text" inputmode="numeric" autocomplete="off" placeholder="${t('egRoom')}" value="${esc(d.roomNo)}"></label></div>
    <div class="bld" id="bld" role="group" aria-label="${t('building')}"><span>${t('building')}</span><button data-b="HCO" class="${d.building === 'HCO' ? 'on' : ''}"><b>HCO</b> Concordia</button><button data-b="DEP" class="${d.building === 'DEP' ? 'on' : ''}"><b>DEP</b> Dépendance</button></div>
    <div class="cov${!d.covers && k ? ' need0' : ''}" id="cov"><span>${t('covers')}<small>${t('coversHelp')}</small></span><div class="step"><button data-cov="-1" aria-label="${t('fewer')}">−</button><span class="n num">${d.covers || 0}</span><button data-cov="1" aria-label="${t('more2')}">+</button></div></div>${chairBox(n, d)}`;
  if (!k) {
    body.innerHTML = h + `<p class="empty-order">${t('noItems')}<br>${isTablet() ? t('tapLeft') : t('closeAndTap')}</p>`;
    bindFields(body, n); return;
  }
  for (const s of SECTIONS) {
    const lines = itemsOf(s.id, true).filter(m => d.items[m.id]); if (!lines.length) continue;
    h += `<div class="grp">${s.it}</div>`;
    for (const m of lines) {
      const q = d.items[m.id], sv = d.served[m.id] || 0, nt = d.notes[m.id] || '', id = esc(m.id);
      h += `<div class="line${sv >= q ? ' served' : ''}"><div class="t">${esc(m.name_it)}<small>${esc(m.name_en)}</small></div>
      <div class="step"><button data-d="-1" data-id="${id}" aria-label="${t('oneLess')}">−</button><span class="n num">${q}</span><button data-d="1" data-id="${id}" aria-label="${t('oneMore')}">+</button></div>
      <div class="lt num">${q} × ${eur(m.price)} = <b>${eur(q * m.price)}</b></div>
      <div class="lx"><button class="srv${sv >= q ? ' on' : ''}" data-srv="${id}">${sv >= q ? t('served') : t('servedXY', { a: sv, b: q })}</button><button class="nb" data-nb="${id}">${nt ? t('editNote') : t('addNote')}</button></div>
      <input class="inote" data-inote="${id}" type="text" autocomplete="off" placeholder="${t('dishNote')}" value="${esc(nt)}" ${nt ? '' : 'hidden'}></div>`;
    }
  }
  h += `<div class="opt"><label for="room">${t('roomService')}<small>${t('roomFee', { fee: eur(fee()) })}</small></label><input type="checkbox" id="room" ${d.room ? 'checked' : ''}></div>
  <textarea id="note" placeholder="${t('kitchenNote')}">${esc(d.note)}</textarea>
  <div class="total"><span>Totale</span><b class="num">${eur(total(d))}</b></div>
  <div class="actions"><button class="btn" id="copyBtn">${t('copyOrder')}</button><button class="btn primary" id="closeBtn">${t('sendReception')}</button>
  <button class="btn wide" id="recvBtn">${t('receptionBig')}</button></div>
  <p class="status">${t('sendHint')}</p>
  <button class="linkbtn" id="clearBtn">${t('deleteNoSave')}</button>
  <div id="copyFallback"></div>`;
  const keep = body.scrollTop; body.innerHTML = h; body.scrollTop = keep;
  bindFields(body, n);
  body.querySelectorAll('.step button[data-id]').forEach(b => { b.onclick = () => add(b.dataset.id, +b.dataset.d); });
  body.querySelectorAll('[data-srv]').forEach(b => { b.onclick = () => { const id = b.dataset.srv, q = d.items[id], sv = d.served[id] || 0; tableOp(n, { t: 'served', id, n: sv >= q ? 0 : sv + 1 }); buzz(); }; });
  body.querySelectorAll('[data-nb]').forEach(b => { b.onclick = () => { const i = body.querySelector(`[data-inote="${CSS.escape(b.dataset.nb)}"]`); i.hidden = false; i.focus(); }; });
  body.querySelectorAll('[data-inote]').forEach(i => { i.oninput = () => { const id = i.dataset.inote, v = i.value; draft('in' + n + id, () => tableOp(n, { t: 'inote', id, note: v })); }; i.onblur = flushDrafts; });
  $('#room', body).onchange = e => tableOp(n, { t: 'set', fields: { room: e.target.checked } });
  const note = $('#note', body); note.oninput = () => { const v = note.value; draft('note' + n, () => tableOp(n, { t: 'set', fields: { note: v } })); }; note.onblur = flushDrafts;
  $('#closeBtn', body).onclick = () => closeTable(n);
  $('#recvBtn', body).onclick = () => { flushDrafts(); receptionView({ ...snapshot(n), closedAt: 0 }); };
  armed($('#clearBtn', body), t('tapAgainDelete'), () => { flushDrafts(); tableOp(n, { t: 'clear' }); toast(t('tableDeleted', { n })); if (isTablet()) screen = 'map'; else closeSheet(sheet('orderSheet')); render(); });
  $('#copyBtn', body).onclick = async () => { flushDrafts(); if (await copyText(ticketText(snapshot(n)), $('#copyFallback', body))) toast(t('orderCopied')); };
}

function bindFields(body, n) {
  const cn = $('#cname', body), cr = $('#croom', body);
  cn.oninput = () => { const v = cn.value; draft('c' + n, () => tableOp(n, { t: 'set', fields: { client: v } })); };
  cr.oninput = () => { const v = cr.value; draft('r' + n, () => tableOp(n, { t: 'set', fields: { roomNo: v } })); };
  cn.onblur = cr.onblur = flushDrafts;
  const cb = $('#chairBtn', body); if (cb) cb.onclick = () => openChairSheet(n);
  body.querySelectorAll('[data-cov]').forEach(b => { b.onclick = () => { const c = tableData(n).covers || 0, v = Math.max(0, Math.min(99, c + +b.dataset.cov)); if (v !== c) { tableOp(n, { t: 'set', fields: { covers: v } }); buzz(); } }; });
  body.querySelectorAll('#bld [data-b]').forEach(b => { b.onclick = () => {
    flushDrafts(); const d = tableData(n); tableOp(n, { t: 'set', fields: { building: d.building === b.dataset.b ? '' : b.dataset.b } }); $('#bld', body).classList.remove('need');
  }; });
}

const askedCovers = {};
async function closeTable(n) {
  if (!S.waiter) { openWaiterSheet(); return; }
  flushDrafts();
  const d = tableData(n); if (!count(d)) return;
  if (!d.covers && !askedCovers[n]) {   // gentle reminder, the second tap sends anyway
    askedCovers[n] = setTimeout(() => { delete askedCovers[n]; }, 8000);
    const c = $('#cov'); if (c) { c.classList.add('need'); c.scrollIntoView({ block: 'center' }); }
    toast(t('coversAsk'), null, null, 5000); return;
  }
  clearTimeout(askedCovers[n]); delete askedCovers[n];
  if (d.roomNo.trim() && !d.building) {
    const b = $('#bld'); if (b) { b.classList.add('need'); b.scrollIntoView({ block: 'center' }); }
    toast(t('chooseBuilding')); return;
  }
  const o = snapshot(n);
  copyText(ticketText(o));
  submitOrder(o);
  if (isTablet()) { screen = 'map'; scrollTo(0, 0); } else closeSheet(sheet('orderSheet'));
  render();
  toast(t('tableSent', { n, tot: eur(o.total) }), t('show'), () => receptionView(o), 6000);
}

export function openTable(n) {
  flushDrafts(); cur = String(n); LS.set('cur', cur);
  if (isTablet()) { screen = 'order'; scrollTo(0, 0); }
  render();
}

// ---------- chairs (physical, movable; the guests field is the existing "covers") ----------
function seatsOf(rt) { return chairsAt(rt.id) + (rt.bench_seats || 0); }
function chairBox(n, d) {
  const rt = roofOfApp(n); if (!rt) return '';
  const c = chairsAt(rt.id), g = d.covers || 0, need = g - seatsOf(rt);
  const msg = !g ? '' : need > 0 ? `<b class="cneed">${t('chairsNeed', { n: need })}</b>` : need < 0 ? `<b class="cextra">${t('chairsExtra', { n: -need })}</b>` : `<b class="cok">${t('chairsOk')}</b>`;
  return `<div class="chairs"><span>🪑 ${t('chairsHere', { n: c })}${rt.bench_seats ? ' ' + t('benchPlus', { n: rt.bench_seats }) : ''} ${msg}</span><button class="btn" id="chairBtn">${t('moveChairs')}</button></div>`;
}
let chairTable = null;
function openChairSheet(n) { chairTable = String(n); openSheet(sheet('chairSheet', t('chairsTitle', { n }))); renderChairSheet(); }
function renderChairSheet() {
  const s = sheet('chairSheet'), body = sheetBody(s), rt = roofOfApp(chairTable);
  if (!rt) { body.innerHTML = `<p class="hint">${t('notOnRooftop')}</p>`; return; }
  const d = tableData(chairTable), g = d.covers || 0, need = Math.max(0, g - seatsOf(rt));
  const extra = Math.max(0, chairsAt(rt.id) - Math.max(0, g - (rt.bench_seats || 0)));
  const live = views().tables;
  const places = [{ id: 'storage', name: t('storage') }, ...S.roof.tables.filter(r => r.id !== rt.id).map(r => ({ id: r.id, name: r.id + (r.app_table ? ' · Tavolo ' + r.app_table : ''), busy: r.app_table && count(tableData(r.app_table)) > 0 && live[r.app_table] }))]
    .map(p => ({ ...p, n: chairsAt(p.id) })).filter(p => p.n > 0);
  const tot = Object.values(S.roof.chairs).reduce((a, b) => a + b, 0), st = chairsAt('storage');
  let h = `<p class="ostat">${t('guestsSeats', { g, s: seatsOf(rt) })} · 🪑 ${t('chairsHere', { n: chairsAt(rt.id) })}${need ? ` · <b>${t('chairsNeed', { n: need })}</b>` : g ? ` · <b class="done">${t('chairsOk')}</b>` : ''}</p>
    <div class="grp">${t('bringFrom')}</div>`;
  h += places.length ? places.map(p => `<div class="srow"><div class="t">${esc(p.name)}<small>🪑 ${p.n}${p.busy ? ` · <span class="stk warn">${t('inUse')}</span>` : ''}</small></div>
      <div class="cmv"><button class="btn" data-from="${p.id}" data-n="1">${t('take', { n: 1 })}</button>${need > 1 && p.n > 1 ? `<button class="btn primary" data-from="${p.id}" data-n="${Math.min(need, p.n)}">${t('take', { n: Math.min(need, p.n) })}</button>` : ''}</div></div>`).join('')
    : `<p class="hint">${t('nothingToTake')}</p>`;
  if (chairsAt(rt.id) > 0) h += `<div class="grp">${t('sendBack')}</div><div class="srow"><div class="t">${t('storage')}<small>🪑 ${st}</small></div>
      <div class="cmv"><button class="btn" data-to="storage" data-n="1">${t('toStorage', { n: 1 })}</button>${extra > 1 ? `<button class="btn" data-to="storage" data-n="${extra}">${t('toStorage', { n: extra })}</button>` : ''}</div></div>`;
  h += `<p class="status">${t('chairsTotals', { d: tot - st, s: st, t: tot })}</p>`;
  body.innerHTML = h;
  const go = async (from, to, k, b) => {
    if (!navigator.onLine) { toast(t('chairsNeedNet')); return; }
    b.disabled = true;
    try { await moveChairs(from, to, k); toast(t('chairsMoved', { n: k })); buzz(); } catch (e) { toast(e.message, null, null, 5000); b.disabled = false; }
  };
  body.querySelectorAll('[data-from]').forEach(b => { b.onclick = () => go(b.dataset.from, rt.id, +b.dataset.n, b); });
  body.querySelectorAll('[data-to]').forEach(b => { b.onclick = () => go(rt.id, b.dataset.to, +b.dataset.n, b); });
}

// ---------- table map (tablet home) ----------
function renderMap() {
  const v = views().tables; let open = 0, sum = 0;
  let tiles = '';
  for (let i = 1; i <= TABLES; i++) {
    const row = v[i], d = tableData(i), k = count(d), m = mins(row), late = k && m >= LATE_MIN, ws = toServe(d);
    if (k) { open++; sum += total(d); }
    tiles += `<button class="tile${k ? ' open' : ''}${late ? ' late' : ''}" data-t="${i}" aria-label="${t('tableLabel', { n: i })}${k ? t('tableOpen') : ''}">
      <b class="n">${i}</b>${k ? `<span class="min num${late ? ' late' : ''}">${m}′</span>` : ''}
      ${d.client ? `<span class="c">${esc(d.client)}</span>` : ''}${roomLabel(d) ? `<span class="m">${t('room')} ${esc(roomLabel(d))}</span>` : ''}${d.covers ? `<span class="m">👥 ${coversLabel(d.covers)}</span>` : ''}
      ${k && row?.waiter_name ? `<span class="m">${esc(row.waiter_name)}</span>` : ''}
      ${k ? `<span class="serve${ws ? '' : ' done'}">${ws ? t('toServe', { n: ws }) : t('allServed')}</span><span class="tot num">${eur(total(d))}</span>` : `<span class="free">${t('free')}</span>`}</button>`;
  }
  $('#mapView').innerHTML = `<div class="maplegend"><span><i></i>${t('free')}</span><span><i class="o"></i>${t('openOrder')}</span><span><i class="l"></i>${t('waitingMin', { m: LATE_MIN })}</span>
    <span style="margin-left:auto">${t('openNotSent', { open: `<b class="num">${open}</b>`, sum: `<b class="num">${eur(sum)}</b>` })}</span></div><div class="map">${tiles}</div>`;
  $$('#mapView .tile').forEach(b => { b.onclick = () => openTable(b.dataset.t); });
}

// phone: choose table sheet
function renderTables() {
  const s = sheet('tableSheet'); const v = views().tables;
  let h = `<p class="hint">${t('goldHint')}</p><div class="tgrid">`;
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
  return `<div class="ho${o.status === 'reopened' ? ' reopened' : ''}"><div class="ho-top"><div class="ho-t">Tavolo ${esc(o.table)}<small>${opts.withDay ? esc(dayLabel(o.day)) + ' · ' : ''}${hhmm(o.closedAt)} · ${esc(o.waiter || '—')}${o.covers ? ' · 👥 ' + coversLabel(o.covers) : ''}${o.pending ? `<span class="waitbadge">${t('waitingUpload')}</span>` : ''}${o.status === 'reopened' ? `<span class="waitbadge">${t('reopenedNotCounted')}</span>` : ''}${o.source === 'import' ? ' · ' + t('oldApp') : ''}${o.chargedAt ? `<span class="rc-ok sm">${t('chargedBadge', { time: hhmm(o.chargedAt) })}</span>` : ''}</small></div><div class="ho-tot num">${eur(o.total)}</div>
    ${(o.client || roomLabel(o)) ? `<div class="ho-who">${esc(o.client || '—')}${roomLabel(o) ? `<span class="rm">${t('room')} ${esc(roomLabel(o))}</span>` : ''}</div>` : ''}</div>
    <ul class="ho-items">${o.items.map(l => `<li><b>${l.qty}×</b> ${esc(l.it)}${l.note ? ` <i>(${esc(l.note)})</i>` : ''} <span class="num">· ${eur(l.qty * l.p)}</span></li>`).join('')}
    ${o.roomService ? `<li><b>+</b> ${t('roomService')} · ${eur(o.roomFee || 10)}</li>` : ''}</ul>
    ${o.note ? `<div class="ho-note">Note: ${esc(o.note)}</div>` : ''}
    <div class="ho-act"><button data-recv="${o.key}">${t('receptionView')}</button>${!o.pending && o.status === 'closed' && opts.reopen !== false ? `<button data-reopen="${o.key}">${t('reopen')}</button>` : ''}${S.role === 'owner' && !o.pending ? `<button class="del" data-del="${o.key}">${t('delete')}</button>` : ''}</div></div>`;
}
export function bindOrderCards(body, list, after) {
  const byKey = Object.fromEntries(list.map(o => [o.key, o]));
  body.querySelectorAll('[data-recv]').forEach(b => { b.onclick = () => receptionView(byKey[b.dataset.recv]); });
  body.querySelectorAll('[data-reopen]').forEach(b => { b.onclick = async () => {
    const o = byKey[b.dataset.reopen]; b.disabled = true;
    try { await reopenOrder(o.id); closeSheet(sheet('histSheet')); toast(t('tableReopened', { n: o.table })); if (location.hash === '#owner') location.hash = ''; openTable(o.table); }
    catch (e) { toast(tServer(e.message)); b.disabled = false; }
  }; });
  body.querySelectorAll('[data-del]').forEach(b => armed(b, t('tapAgain'), async () => {
    const o = byKey[b.dataset.del];
    const reason = prompt(t('deletePrompt', { n: o.table, tot: eur(o.total) }), '');
    if (reason === null) return;
    try { await deleteOrder(o.id, reason); toast(t('orderDeleted')); after && after(); } catch (e) { toast(e.message); }
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
  let h = `<div class="days">${['all', ...names].map(w => { const tot = counted.filter(o => w === 'all' || o.waiter === w).reduce((a, o) => a + o.total, 0); return `<button class="day${w === histWaiter ? ' on' : ''}" data-w="${esc(w)}">${w === 'all' ? t('everyone') : esc(w)} · <span class="num">${eurShort(tot)}</span></button>`; }).join('')}</div>
    <div class="sum"><small>${t('totalToday')}</small><b class="num">${eur(sum)}</b><span class="num">${cl.length === 1 ? t('tablesSent1', { i: items }) : t('tablesSentN', { n: cl.length, i: items })}</span></div>`;
  if (S.role === 'owner') h += `<div class="actions" style="grid-template-columns:1fr"><button class="btn" id="toOwner">${t('fullHistory')}</button></div>`;
  const v = views().tables, open = Object.keys(v).filter(k => count(tableData(k))).sort((a, b) => a - b);
  if (open.length) {
    h += `<div class="subhead">${t('notSentYet')}</div>`;
    open.forEach(n => { const d = tableData(n);
      h += `<div class="ho open"><div class="ho-top"><div class="ho-t">Tavolo ${n}<small>${waitLabel(v[n])}${toServe(d) ? ' · ' + t('toServe', { n: toServe(d) }) : ''}${v[n]?.waiter_name ? ' · ' + esc(v[n].waiter_name) : ''}</small></div><div class="ho-tot num">${eur(total(d))}</div>
        ${who(d) ? `<div class="ho-who">${esc(d.client || '')}${roomLabel(d) ? `<span class="rm">${t('room')} ${esc(roomLabel(d))}</span>` : ''}</div>` : ''}</div>
        <div class="ho-act"><button data-go="${n}">${t('goToTable')}</button></div></div>`; });
  }
  h += `<div class="subhead">${t('sentReception')}</div>`;
  if (!list.length) h += `<p class="empty-order">${t('nothingSent')}</p>`;
  h += list.map(o => orderCard(o)).join('');
  if (cl.length) h += `<div class="actions" style="grid-template-columns:1fr"><button class="btn primary" id="copyDay">${t('copyDay')}</button></div><div id="dayFallback"></div>`;
  h += `<p class="status">${syncText()}</p>`;
  const keep = body.scrollTop; body.innerHTML = h; body.scrollTop = keep;
  body.querySelectorAll('[data-w]').forEach(b => { b.onclick = () => { histWaiter = b.dataset.w; renderHistory(); }; });
  body.querySelectorAll('[data-go]').forEach(b => { b.onclick = () => { closeSheet(s); openTable(b.dataset.go); if (!isTablet()) { const os = sheet('orderSheet'); openSheet(os); renderOrder(sheetBody(os), true); } }; });
  bindOrderCards(body, list);
  const to = $('#toOwner', body); if (to) to.onclick = () => { closeSheet(s); goOwner(); };
  const cd = $('#copyDay', body); if (cd) cd.onclick = async () => { if (await copyText(dayText(cl), $('#dayFallback', body))) toast(t('dayCopied')); };
}
export function syncText() {
  const n = S.queue.length;
  if (S.sync === 'error') return t('syncExpired') + (n ? ' ' + t('syncKept', { n }) : '');
  if (n) return `${n === 1 ? t('syncWaiting1') : t('syncWaitingN', { n })} ${navigator.onLine ? t('uploading') : t('noNetKept')}`;
  return navigator.onLine ? t('allSaved') : t('noNetNow');
}

// ---------- stock ----------
function renderStock() {
  const s = sheet('stockSheet'), body = sheetBody(s);
  let h = `<p class="hint">${t('stockHint')}</p>
  <div class="legend"><span class="stk ok">${t('inStock')}</span><span class="stk warn">${t('almostFinished')}</span><span class="stk out">${t('finished')}</span></div>
  <div class="srow"><div class="t">${t('orangeWhen')}<small>${t('almostWarn')}</small></div>
    <div class="step"><button data-alert="-1" aria-label="${t('lower')}">−</button><span class="n num">${alertN()}</span><button data-alert="1" aria-label="${t('higher')}">+</button></div></div>`;
  for (const sec of SECTIONS.filter(x => x.food)) {
    h += `<div class="grp">${sec.it}</div>`;
    for (const m of itemsOf(sec.id)) {
      const n = stockLeft(m.id), lv = level(n), id = esc(m.id);
      h += `<div class="srow"><div class="t">${esc(m.name_it)}<small>${lv ? `<span class="stk ${lv}">${stockLabel(n)}</span> <button class="stop" data-stop="${id}">${t('stopCounting')}</button>` : t('notCounted')}</small></div>
        <div class="step"><button data-s="${id}" data-d="-1" aria-label="${t('oneLess')}">−</button><span class="${lv ? 'n num' : 'off'}">${lv ? Math.max(0, n) : '—'}</span><button data-s="${id}" data-d="1" aria-label="${t('oneMore')}">+</button></div></div>`;
    }
  }
  h += `<div class="actions" style="grid-template-columns:1fr"><button class="btn" id="newCount">${t('newDayCount')}</button></div>
  <p class="status">${t('newDayHint')}</p>`;
  const keep = body.scrollTop; body.innerHTML = h; body.scrollTop = keep;
  body.querySelectorAll('[data-alert]').forEach(b => { b.onclick = () => setAlert(Math.max(0, Math.min(10, alertN() + +b.dataset.alert))).catch(e => toast(t('needsInternet', { msg: e.message }))); });
  body.querySelectorAll('[data-s]').forEach(b => { b.onclick = () => {
    const id = b.dataset.s, n = stockLeft(id), d = +b.dataset.d;
    if (n == null) { if (d > 0) stockSet(id, 1); return; }
    stockSet(id, Math.max(0, Math.max(0, n) + d));
  }; });
  body.querySelectorAll('[data-stop]').forEach(b => { b.onclick = () => stockSet(b.dataset.stop, null); });
  const nb = $('#newCount', body); nb.classList.add('warn');
  armed(nb, t('tapAgainCount'), () => { stockNewDay(); toast(t('countStarted')); });
}

// ---------- waiter switch with PIN ----------
export function pinPicker(container, onDone) {
  const list = S.waiters.filter(w => w.active);
  container.innerHTML = `<p class="hint">${t('pinHint')}</p>
    <div class="pinwho">${list.map(w => `<button class="wpick${w.id === S.waiter?.id ? ' on' : ''}" data-w="${w.id}">${esc(w.name)}</button>`).join('') || `<p class="hint">${t('noWaiters')}</p>`}</div>`;
  container.querySelectorAll('[data-w]').forEach(b => { b.onclick = () => pad(list.find(w => w.id === b.dataset.w)); });
  function pad(w) {
    let pin = '';
    container.innerHTML = `<div class="pinpad"><h4>${esc(w.name)}</h4><div class="dots">${'<i></i>'.repeat(4)}</div><p class="err" style="text-align:center"></p>
      <div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(k => `<button data-k="${k}">${k}</button>`).join('')}<button class="ghost" data-back>${t('names')}</button><button data-k="0">0</button><button class="ghost" data-del aria-label="${t('delDigit')}">⌫</button></div></div>`;
    const dots = container.querySelectorAll('.dots i'), err = container.querySelector('.err');
    const show = () => dots.forEach((d, i) => d.classList.toggle('on', i < pin.length));
    container.querySelector('[data-back]').onclick = () => pinPicker(container, onDone);
    container.querySelector('[data-del]').onclick = () => { pin = pin.slice(0, -1); show(); };
    container.querySelectorAll('[data-k]').forEach(b => { b.onclick = async () => {
      if (pin.length >= 4) return; pin += b.dataset.k; show(); err.textContent = '';
      if (pin.length < 4) return;
      try { await waiterLogin(w, pin); langForWaiter(w.id); onDone(); toast(t('hi', { name: w.name })); }
      catch (e) { err.textContent = tServer(e.message); pin = ''; show(); const p = container.querySelector('.pinpad'); p.classList.remove('shake'); void p.offsetWidth; p.classList.add('shake'); }
    }; });
  }
}
export function openWaiterSheet() {
  const s = sheet('waiterSheet', t('whoWorking')); openSheet(s);
  const done = () => { closeSheet(s); render(); };
  pinPicker(sheetBody(s), done);
  // new waiters added by the owner appear at once
  if (navigator.onLine) reload('waiters').then(() => { if (!s.hidden && !sheetBody(s).querySelector('.pinpad')) pinPicker(sheetBody(s), done); });
}

// ---------- More: theme, owner, lock, install, log out ----------
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
export function setTheme(x) {
  LS.set('theme', x);
  if (x === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = x;
}
export const toggleLang = () => chooseLang(getLang() === 'it' ? 'en' : 'it', S.waiter?.id);
function renderMore() {
  const s = sheet('moreSheet'), body = sheetBody(s), th = LS.get('theme', 'auto');
  body.innerHTML = `
    <div class="grp">${t('language')}</div><div class="seg">${[['it', 'Italiano'], ['en', 'English']].map(([l, n]) => `<button data-lang="${l}" class="${l === getLang() ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div class="grp">${t('theme')}</div><div class="seg" style="grid-template-columns:repeat(3,1fr)">${['auto', 'light', 'dark'].map(x => `<button data-th="${x}" class="${x === th ? 'on' : ''}">${t(x)}</button>`).join('')}</div>
    <div class="grp">${t('waiter')}</div>
    <div class="actions"><button class="btn" id="mSwitch">${t('switchWaiter')}</button><button class="btn" id="mLock">${esc(t('lock', { name: S.waiter?.name || '—' }))}</button></div>
    ${S.role === 'owner' ? `<div class="grp">${t('owner')}</div><div class="actions" style="grid-template-columns:1fr"><button class="btn primary" id="mOwner">${t('ownerDashboard')}</button></div>` : ''}
    ${installEvt ? `<div class="actions" style="grid-template-columns:1fr"><button class="btn" id="mInstall">${t('install')}</button></div>` : ''}
    <div class="grp">${t('connection')}</div><p class="hint">${syncText()}</p>
    ${S.queue.length ? `<div class="actions" style="grid-template-columns:1fr"><button class="btn" id="mFlush">${t('tryUpload')}</button></div>` : ''}
    <p class="hint">${t('loggedInAs', { email: esc(S.email), role: esc(S.role) })}</p>
    <button class="linkbtn" id="mLogout">${t('logoutDevice')}</button>`;
  body.querySelectorAll('[data-lang]').forEach(b => { b.onclick = () => { closeSheet(s); chooseLang(b.dataset.lang, S.waiter?.id); }; });
  body.querySelectorAll('[data-th]').forEach(b => { b.onclick = () => { setTheme(b.dataset.th); renderMore(); }; });
  $('#mSwitch', body).onclick = () => { closeSheet(s); openWaiterSheet(); };
  $('#mLock', body).onclick = () => { closeSheet(s); waiterLogout(); langForWaiter(null); };
  const mo = $('#mOwner', body); if (mo) mo.onclick = () => { closeSheet(s); goOwner(); };
  const mi = $('#mInstall', body); if (mi) mi.onclick = async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; renderMore(); };
  const mf = $('#mFlush', body); if (mf) mf.onclick = () => { flush(); toast(t('uploading')); };
  armed($('#mLogout', body), t('tapAgainLogout'), () => logout());
}

// minutes on tiles/bars move on their own
setInterval(() => { if ($('#menuCol') && !document.hidden) { const a = document.activeElement; if (!(a && /INPUT|TEXTAREA/.test(a.tagName))) render(); else { $$('.osWait').forEach(el => { el.textContent = orderedLabel(tableRow(cur)); }); } } }, 30000);
