// Reception screen (PC of the reception). Three tabs:
//  · Today (live): pop-up + sound + PC notification for every new order, "Charged ✓"
//  · To charge: every order not charged yet (any day), grouped by room, "Charge all", print the room bill, stats table
//  · History: any day (last 60 days), with "Charged ✓" too (a room often pays everything at check-out)
import { esc, eur, $, $$, today, addDays, dayLabel, hhmm, roomLabel, ms, coverAmt } from './data.js';
import { S, LS, sb, reload, markCharged, markChargedMany, logout, fetchOrders, fetchReception } from './store.js';
import { fromServer, coversLabel } from './waiter.js';
import { toast } from './ui.js';
import { t, getLang, chooseLang } from './i18n.js';
import { buildXlsx, download } from './xlsx.js';

let root = null, started = false, seen = null, known = null, popupQueue = [], timer = null, audio = null, mountAt = 0, baseline = true;
const soundOn = () => LS.get('recvSound', true);
// tab: 'today' | 'todo' | 'hist'
let tab = 'today', viewDay = null, past = null, pastErr = '', pastSeq = 0, histDays = null, canChargeOld = false;
let pool = null, poolErr = '', poolSeq = 0, poolAt = 0, search = '';
const minDay = () => (S.role === 'owner' ? '2020-01-01' : addDays(today(), -(histDays || 60)));
const poolMin = () => addDays(today(), -(S.role === 'owner' ? 60 : (histDays || 60)));   // older orders: only the ones not charged
const withCharge = o => ({ ...fromServer(o), chargedAt: ms(o.charged_at), chargedBy: o.charged_by });

export function mountReception(app) {
  root = app;
  // orders already there when the screen opens: no pop-up for them
  const saved = LS.get('recvSeen:' + today(), null);
  seen = new Set(saved || []);
  baseline = !!saved;          // first time on this PC today: orders already there are only listed, no pop-up
  mountAt = Date.now(); known = null; popupQueue = []; viewDay = addDays(today(), -1); past = null; pool = null;
  draw();
  checkHistory();
  clearInterval(timer);
  timer = setInterval(() => {
    if (!navigator.onLine) return;
    reload('today');                                               // safety net if a live message is lost
    if (tab === 'todo') loadPool(); else if (tab === 'hist') loadDay(true);   // other PCs may have charged something
  }, 20000);
  reload('today');
}
export const leaveReception = () => { clearInterval(timer); root = null; started = false; popupQueue = []; };

function orders() {
  return S.today.filter(o => o.day === today()).map(withCharge).sort((a, b) => b.closedAt - a.closedAt);
}

// called by main.js on every change of data
export function receptionRender() {
  if (!root || !$('#recvList')) return;
  const list = orders();
  detectChanges(list);           // pop-ups for new orders work in every tab
  const live = $('#rcpLive'); if (live) { const on = navigator.onLine; live.textContent = on ? '● ' + t('live') : '● ' + t('reconnecting'); live.classList.toggle('off', !on); }
  drawTabs();
  if (tab === 'today') drawToday(list); else if (tab === 'todo') drawTodo(); else drawPast();
}

// ---------- which features the database has (SQL steps 11 / 12) ----------
async function checkHistory() {
  if (S.role === 'owner') { histDays = 99999; canChargeOld = true; loadPool(); return; }
  try { const { data, error } = await sb.rpc('reception_history_days'); histDays = error ? 0 : data; } catch { histDays = 0; }
  try { const { error } = await sb.rpc('reception_can_see', { p_day: today(), p_status: 'closed', p_charged: null }); canChargeOld = !error; } catch { canChargeOld = false; }
  receptionRender();
  loadPool();   // the number on the "To charge" tab
}

// ---------- tabs ----------
function drawTabs() {
  const el = $('#rcpTabs'); if (!el) return;
  const todo = toChargeList();
  const n = todo ? todo.length : null;
  const html = `<button data-rtab="today" class="${tab === 'today' ? 'on' : ''}">${t('tabToday')}</button>
    <button data-rtab="todo" class="${tab === 'todo' ? 'on' : ''}">${t('tabToCharge')}${n ? ` <span class="rcp-cnt">${n}</span>` : ''}</button>
    <button data-rtab="hist" class="${tab === 'hist' ? 'on' : ''}">${t('tabHistory')}</button>`;
  if (el.innerHTML !== html) el.innerHTML = html;
  $$('[data-rtab]', el).forEach(b => { b.onclick = () => setTab(b.dataset.rtab); });
}
function setTab(k) {
  tab = k; search = '';
  if (k === 'todo') loadPool();
  if (k === 'hist') loadDay();
  receptionRender();
  scrollTo({ top: 0 });
}

// ---------- TODAY (live) ----------
function drawToday(list) {
  const ok = list.filter(o => o.status === 'closed'), todo = ok.filter(o => !o.chargedAt);
  $('#recvSum').innerHTML = `<div class="kpi main"><small>${t('todayTotal')}</small><b class="num">${eur(ok.reduce((a, o) => a + o.total, 0))}</b></div>
    <div class="kpi"><small>${t('ordersN', { n: ok.length })}</small><b class="num">${todo.length ? t('toChargeN', { n: todo.length }) : t('allCharged')}</b></div>`;
  const el = $('#recvList');
  if (!list.length) { el.innerHTML = `<p class="empty-order">${t('noOrdersToday')}</p>`; return; }
  el.innerHTML = list.map(o => card(o)).join('');
  bindCharge(el, list);
}

// ---------- TO CHARGE: every order not charged yet, grouped by room ----------
async function loadPool() {
  if (histDays === 0) { pool = null; poolErr = t('histNotInstalled'); return; }
  const seq = ++poolSeq;
  try {
    const rows = await fetchReception(poolMin(), addDays(today(), -1));
    if (seq !== poolSeq) return;
    pool = rows.map(withCharge); poolErr = ''; poolAt = Date.now();
  } catch (e) { if (seq === poolSeq && !pool) poolErr = e.message + '. ' + t('checkInternet'); }
  receptionRender();
}
// past days come from the server, today comes live
const allOrders = () => (pool ? [...pool.filter(o => o.day < today()), ...orders()] : null);
function toChargeList() { const a = allOrders(); return a && a.filter(o => o.status === 'closed' && !o.chargedAt); }
const roomKey = o => (roomLabel(o) ? roomLabel(o).toUpperCase() : '');

function statsHtml(a) {
  const y = addDays(today(), -1), w = addDays(today(), -6);
  const rows = [[t('today'), o => o.day === today()], [t('yesterday'), o => o.day === y], [t('last7'), o => o.day >= w],
    [t('lastNdays', { n: histDays && histDays < 9999 ? histDays : 60 }), o => o.day >= poolMin()], [t('olderUnpaid'), o => o.day < poolMin()]];
  const cell = (l) => `<b class="num">${l.length}</b> <small class="num">${eur(l.reduce((s, o) => s + o.total, 0))}</small>`;
  return `<table class="rcp-stats"><thead><tr><th></th><th>${t('orders')}</th><th>✓ ${t('charged')}</th><th>⏳ ${t('toCharge')}</th></tr></thead><tbody>
    ${rows.map(([lbl, f]) => { const l = a.filter(o => o.status === 'closed' && f(o)); if (!l.length && lbl === t('olderUnpaid')) return '';
      const c = l.filter(o => o.chargedAt), u = l.filter(o => !o.chargedAt);
      return `<tr><th>${esc(lbl)}</th><td>${cell(l)}</td><td class="ok">${cell(c)}</td><td class="${u.length ? 'todo' : ''}">${cell(u)}</td></tr>`; }).join('')}
    </tbody></table>`;
}

function drawTodo() {
  const el = $('#recvList'), sum = $('#recvSum');
  if (poolErr && !pool) { sum.innerHTML = ''; el.innerHTML = `<p class="err">${esc(poolErr)}</p>`; return; }
  const a = allOrders();
  if (!a) { sum.innerHTML = ''; el.innerHTML = `<p class="hint">${t('loading')}</p>`; return; }
  const todo = toChargeList(), tot = todo.reduce((s, o) => s + o.total, 0);
  sum.innerHTML = `<div class="kpi main"><small>${t('stillToCharge')}</small><b class="num">${eur(tot)}</b></div>
    <div class="kpi"><small>${t('ordersN', { n: todo.length })}</small><b class="num">${todo.length ? t('roomsN', { n: new Set(todo.map(o => roomKey(o) || 'o' + o.id)).size }) : t('allCharged')}</b></div>`;
  // search keeps the focus while the list changes
  const q = search.trim().toLowerCase();
  const shown = q ? todo.filter(o => (roomKey(o) + ' ' + (o.client || '') + ' ' + o.table).toLowerCase().includes(q)) : todo;
  const groups = new Map();
  for (const o of shown.slice().sort((x, y) => x.closedAt - y.closedAt)) { const k = roomKey(o) || '—'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); }
  const gl = [...groups.entries()].sort((x, y) => (x[0] === '—') - (y[0] === '—') || x[1][0].closedAt - y[1][0].closedAt);
  const html = `<details class="rcp-statbox" ${LS.get('recvStatsOpen', true) ? 'open' : ''}><summary>📊 ${t('statsTitle')}</summary>${statsHtml(a)}</details>
    <div class="rcp-search"><input type="search" id="rcpSearch" placeholder="${t('searchRoom')}" value="${esc(search)}" aria-label="${t('searchRoom')}"></div>
    ${!canChargeOld ? `<p class="rcp-warn">${t('oldChargeOff')}</p>` : ''}
    ${!todo.length ? `<p class="empty-order">🎉 ${t('nothingToCharge')}</p>` : !gl.length ? `<p class="empty-order">${t('nothingFound')}</p>` : ''}
    ${gl.map(([k, l]) => {
      const sumG = l.reduce((s, o) => s + o.total, 0), days = [...new Set(l.map(o => o.day))];
      const names = [...new Set(l.map(o => (o.client || '').trim()).filter(Boolean))];
      const can = canChargeOld || l.every(o => o.day === today());
      return `<section class="rgroup" data-room="${esc(k)}">
        <header><div><h3>${k === '—' ? t('noRoom') : `${t('room')} ${esc(k)}`}</h3>
          <small>${names.length ? esc(names.join(', ')) + ' · ' : ''}${l.length === 1 ? t('order1') : t('ordersN', { n: l.length })} · ${days.map(d => esc(dayLabel(d))).join(', ')}</small></div>
          <div class="rg-r"><b class="num">${eur(sumG)}</b>
          ${k !== '—' ? `<button class="btn" data-print="${esc(k)}">🖨 ${t('printBill')}</button>${can ? `<button class="btn primary" data-all="${esc(k)}">${t('chargeAll')}</button>` : ''}` : ''}</div></header>
        ${l.map(o => card(o, { day: true, noCharge: !can && o.day !== today() })).join('')}</section>`;
    }).join('')}`;
  const focus = document.activeElement?.id === 'rcpSearch', pos = focus ? document.activeElement.selectionStart : 0;
  el.innerHTML = html;
  const s = $('#rcpSearch'); s.oninput = () => { search = s.value; drawTodo(); };
  if (focus) { s.focus(); try { s.setSelectionRange(pos, pos); } catch { /* ignore */ } }
  $('.rcp-statbox', el).ontoggle = e => LS.set('recvStatsOpen', e.target.open);
  bindCharge(el, shown);
  $$('[data-all]', el).forEach(b => { b.onclick = () => chargeAll(groups.get(b.dataset.all), b); });
  $$('[data-print]', el).forEach(b => { b.onclick = () => printBill(b.dataset.print, groups.get(b.dataset.print)); });
}

async function chargeAll(list, btn) {
  if (!list?.length) return;
  const tot = list.reduce((s, o) => s + o.total, 0);
  if (!confirm(t('chargeAllConfirm', { n: list.length, room: roomKey(list[0]), tot: eur(tot) }))) return;
  btn.disabled = true;
  try { await markChargedMany(list.map(o => o.id), 'Reception'); toast(t('chargedAllOk', { n: list.length, tot: eur(tot) })); }
  catch (e) { toast(e.message, null, null, 6000); btn.disabled = false; }
  await loadPool();
}

// a clean page for the guest at check-out (print or save as PDF)
function printBill(room, list) {
  if (!list?.length) return;
  const tot = list.reduce((s, o) => s + o.total, 0), it = getLang() === 'it';
  const rows = list.map(o => `<tr><td>${esc(o.day.split('-').reverse().join('/'))} ${hhmm(o.closedAt)}</td><td>${o.items.map(l => `${l.qty}× ${esc(l.it)}`).join('<br>')}${o.roomService ? `<br>+ ${t('roomService')}` : ''}${coverAmt(o) ? `<br>+ ${t('tableService')} ${o.covers} × ${eur(o.coverFee)}` : ''}</td><td class="n">${eur(o.total)}</td></tr>`).join('');
  const w = window.open('', '_blank'); if (!w) { toast(t('popupBlocked')); return; }
  w.document.write(`<!doctype html><html lang="${it ? 'it' : 'en'}"><head><meta charset="utf-8"><title>${t('room')} ${esc(room)}</title>
    <style>body{font:15px/1.45 system-ui,sans-serif;color:#111;margin:32px}h1{font-size:22px;margin:0}small{color:#555}table{width:100%;border-collapse:collapse;margin-top:18px}
    td,th{border-bottom:1px solid #ddd;padding:8px 6px;text-align:left;vertical-align:top}.n{text-align:right;white-space:nowrap}tfoot td{font-weight:800;font-size:18px;border:0}
    @media print{button{display:none}}</style></head><body>
    <h1>Ristorante Concordia · Fugari Bistrot</h1><small>${it ? 'Riepilogo ristorante' : 'Restaurant summary'} · ${t('room')} <b>${esc(room)}</b>${[...new Set(list.map(o => o.client).filter(Boolean))].length ? ' · ' + esc([...new Set(list.map(o => o.client).filter(Boolean))].join(', ')) : ''}</small>
    <table><thead><tr><th>${it ? 'Data' : 'Date'}</th><th>${it ? 'Consumazioni' : 'Items'}</th><th class="n">${it ? 'Importo' : 'Amount'}</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td></td><td class="n">${it ? 'Totale' : 'Total'}</td><td class="n">${eur(tot)}</td></tr></tfoot></table>
    <p><small>${it ? 'Documento non fiscale' : 'Not a fiscal receipt'}</small></p><button onclick="print()">🖨 ${it ? 'Stampa' : 'Print'}</button></body></html>`);
  w.document.close(); w.focus(); setTimeout(() => { try { w.print(); } catch { /* ignore */ } }, 300);
}

// ---------- HISTORY: any day ----------
function drawDayBar() {
  const d = viewDay;
  return `<div class="rcp-days"><button class="hbtn" id="dPrev" aria-label="${t('prevDay')}" ${d <= minDay() ? 'disabled' : ''}>‹</button>
    <label class="rcp-pick"><span>${esc(dayLabel(d, true))}</span><input type="date" id="dPick" value="${d}" min="${minDay()}" max="${addDays(today(), -1)}" aria-label="${t('chooseDay')}"></label>
    <button class="hbtn" id="dNext" aria-label="${t('nextDay')}" ${d >= addDays(today(), -1) ? 'disabled' : ''}>›</button>
    ${d !== addDays(today(), -1) ? `<button class="hbtn" id="dYest">${t('yesterday')}</button>` : ''}</div>`;
}
function goDay(d) {
  if (d >= today()) { setTab('today'); return; }
  if (d < minDay()) d = minDay();
  viewDay = d; past = null; pastErr = ''; loadDay(); receptionRender();
}
async function loadDay(quiet) {
  if (histDays === 0) { pastErr = t('histNotInstalled'); receptionRender(); return; }
  const seq = ++pastSeq, d = viewDay;
  try {
    const rows = await fetchOrders(d, d);
    if (seq !== pastSeq) return;
    past = rows.map(withCharge).sort((a, b) => b.closedAt - a.closedAt); pastErr = '';
  } catch (e) { if (seq !== pastSeq || quiet) return; pastErr = e.message + '. ' + t('checkInternet'); }
  receptionRender();
}
function drawPast() {
  const el = $('#recvList'), sum = $('#recvSum');
  const bar = drawDayBar();
  const bindBar = () => {
    $('#dPrev').onclick = () => goDay(addDays(viewDay, -1));
    $('#dNext').onclick = () => goDay(addDays(viewDay, 1));
    $('#dPick').onchange = e => { if (e.target.value) goDay(e.target.value); };
    const y = $('#dYest'); if (y) y.onclick = () => goDay(addDays(today(), -1));
  };
  if (pastErr) { sum.innerHTML = ''; el.innerHTML = bar + `<p class="err">${esc(pastErr)}</p>`; bindBar(); return; }
  if (!past) { sum.innerHTML = ''; el.innerHTML = bar + `<p class="hint">${t('loading')}</p>`; bindBar(); return; }
  const ok = past.filter(o => o.status === 'closed'), todo = ok.filter(o => !o.chargedAt);
  sum.innerHTML = `<div class="kpi main"><small>${esc(dayLabel(viewDay, true))}</small><b class="num">${eur(ok.reduce((a, o) => a + o.total, 0))}</b></div>
    <div class="kpi"><small>${t('ordersN', { n: ok.length })}</small><b class="num">${todo.length ? t('notChargedN', { n: todo.length }) : (ok.length ? t('allCharged') : '—')}</b></div>`;
  el.innerHTML = bar + (!canChargeOld ? `<p class="rcp-warn">${t('oldChargeOff')}</p>` : '')
    + (past.length ? past.map(o => card(o, { noCharge: !canChargeOld })).join('') : `<p class="empty-order">${t('noOrdersDay')}</p>`);
  bindBar(); bindCharge(el, past);
}

// ---------- one order ----------
function card(o, opt = {}) {
  const reopened = o.status === 'reopened';
  return `<div class="rcard${o.chargedAt ? ' done' : ''}${reopened ? ' reopened' : ''}">
    <div class="rc-l"><div class="rc-t">${t('tableLabel', { n: o.table })}</div><div class="rc-h num">${opt.day && o.day !== today() ? esc(dayLabel(o.day)) + ' · ' : ''}${hhmm(o.closedAt)}</div>${o.covers ? `<div class="rc-cv">👥 ${coversLabel(o.covers)}</div>` : ''}</div>
    <div class="rc-m">
      <div class="rc-who">${esc(o.client || '—')}${roomLabel(o) ? `<span class="rc-room">${t('room')} ${esc(roomLabel(o))}</span>` : ''}</div>
      <div class="rc-items">${o.items.map(l => `<b>${l.qty}×</b> ${esc(l.it)}${l.note ? ` <i>(${esc(l.note)})</i>` : ''}`).join(' · ')}${o.roomService ? ` · <b>+</b> ${t('roomService')}` : ''}${coverAmt(o) ? ` · <b>+</b> ${t('tableService')} ${o.covers} × ${eur(o.coverFee)}` : ''}</div>
      ${o.note ? `<div class="rc-note">${esc(o.note)}</div>` : ''}
      <div class="rc-w">${t('waiterShort')}: ${esc(o.waiter || '—')}</div>
    </div>
    <div class="rc-r"><div class="rc-tot num">${eur(o.total)}</div>
      ${reopened ? `<span class="waitbadge">${t('reopenedBadge')}</span>`
        : o.chargedAt ? `<span class="rc-ok">${t('chargedBadge', { time: (o.chargedAt && dayKeyOf(o.chargedAt) !== today() ? new Date(o.chargedAt).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Rome' }) + ' ' : '') + hhmm(o.chargedAt) })}</span>${opt.noCharge ? '' : `<button class="linkbtn" data-charge="${o.id}" data-on="0">${t('notCharged')}</button>`}`
          : opt.noCharge ? `<span class="waitbadge">${t('notChargedBadge')}</span>` : `<button class="btn primary" data-charge="${o.id}" data-on="1">${t('markCharged')}</button>`}</div></div>`;
}
const dayKeyOf = v => new Date(v).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
function bindCharge(el, list) {
  $$('[data-charge]', el).forEach(b => { b.onclick = () => charge(list.find(o => String(o.id) === b.dataset.charge), b.dataset.on === '1', b); });
}

async function charge(o, on, btn) {
  if (!o) return;
  btn.disabled = true;
  try {
    await markCharged(o.id, on, 'Reception'); if (on) toast(t('chargedOk'));
    if (o.day !== today() || tab !== 'today') { if (tab === 'hist') await loadDay(); else await loadPool(); }
  } catch (e) { toast(e.message, null, null, 5000); btn.disabled = false; }
}

function detectChanges(list) {
  const byId = new Map(list.map(o => [o.id, o]));
  if (known) {
    // deleted by the owner
    for (const [id, o] of known) if (!byId.has(id) && o.status === 'closed' && !o.chargedAt) alertMsg(t('orderGone', { n: o.table, tot: eur(o.total) }));
    // reopened by a waiter
    for (const o of list) { const k = known.get(o.id); if (k && k.status === 'closed' && o.status === 'reopened') alertMsg(t('orderReopenedMsg', { n: o.table })); }
  }
  known = byId;
  if (!baseline) {
    if ((S.todayLoadedAt || 0) < mountAt) return;     // wait for fresh data from the server
    list.forEach(o => seen.add(o.id)); LS.set('recvSeen:' + today(), [...seen]); baseline = true; return;
  }
  // new orders
  const fresh = list.filter(o => o.status === 'closed' && !seen.has(o.id)).reverse();
  if (!fresh.length) return;
  fresh.forEach(o => seen.add(o.id));
  LS.set('recvSeen:' + today(), [...seen]);
  popupQueue.push(...fresh);
  chime(); fresh.forEach(notify);
  if (!$('.recv-pop')) nextPopup();
}

function alertMsg(m) { chime(true); toast(m, null, null, 9000); systemNote(t('reception'), m, 'msg-' + Date.now()); }

// ---------- layout ----------
function draw() {
  const notif = typeof Notification === 'undefined' ? 'none' : Notification.permission;
  root.innerHTML = `<div class="rcp">
    <div class="rcp-top">
      <div class="rcp-brand"><img src="/logo.png" alt="" width="44" height="44"><div><b>${t('receptionScreen')}</b><small id="rcpDate"></small></div></div>
      <div class="tools">
        <span class="rcp-live" id="rcpLive"></span>
        <button class="hbtn" id="rcpLang">${getLang() === 'it' ? 'EN' : 'IT'}</button>
        <button class="hbtn" id="rcpSound">${t('sound')}: ${soundOn() ? t('on') : t('off')}</button>
        <button class="hbtn" id="rcpXlsx">${t('downloadExcel')}</button>
        <button class="hbtn" id="rcpExit">${S.role === 'owner' ? '‹ ' + t('ownerDashboard') : t('logOut')}</button>
      </div>
    </div>
    ${started ? '' : `<button class="rcp-start" id="recvStart"><b>${t('startRecv')}</b><span>${t('startHint')}</span></button>`}
    ${notif === 'denied' ? `<p class="rcp-warn">${t('notifBlocked')}</p>` : ''}
    <nav class="seg seg3 rcp-tabs" id="rcpTabs"></nav>
    <div class="rcp-sum" id="recvSum"></div>
    <div id="recvList"></div></div>`;
  $('#rcpDate').textContent = new Date().toLocaleDateString(getLang() === 'it' ? 'it-IT' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome' });
  const st = $('#recvStart'); if (st) st.onclick = start;
  $('#rcpLang').onclick = () => chooseLang(getLang() === 'it' ? 'en' : 'it', null);
  $('#rcpSound').onclick = () => { LS.set('recvSound', !soundOn()); if (soundOn()) chime(); draw(); receptionRender(); };
  $('#rcpXlsx').onclick = exportDay;
  $('#rcpExit').onclick = () => {
    if (S.role === 'owner') { leaveReception(); location.hash = '#owner'; return; }   // the owner just goes back to the dashboard
    if (confirm(t('exitRecv'))) { leaveReception(); logout(); }
  };
  receptionRender();
}

// The browser allows sound + notifications only after a click
async function start() {
  started = true;
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); await audio.resume(); } catch { audio = null; }
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch { /* ignore */ } }
  chime();
  draw();
}

// ---------- pop-up ----------
function nextPopup() {
  const o = popupQueue.shift(); if (!o) return;
  const el = document.createElement('div'); el.className = 'recv recv-pop'; el.setAttribute('role', 'alertdialog');
  el.innerHTML = `<div class="in">
    <div class="top"><div><div class="lbl">🔔 ${t('newOrder')}${popupQueue.length ? ` · +${popupQueue.length}` : ''}</div><h2>${t('tableLabel', { n: o.table })}</h2></div><div class="rc-h num" style="font-size:22px">${hhmm(o.closedAt)}</div></div>
    ${o.client ? `<div class="who">${esc(o.client)}</div>` : ''}${roomLabel(o) ? `<div class="room">${t('room')} ${esc(roomLabel(o))}</div>` : ''}${o.covers ? `<div class="covers">👥 ${coversLabel(o.covers)}</div>` : ''}
    <ul>${o.items.map(l => `<li><b>${l.qty}×</b><span>${esc(l.it)}${l.note ? `<i>${esc(l.note)}</i>` : ''}</span><span class="num">${eur(l.qty * l.p)}</span></li>`).join('')}
    ${o.roomService ? `<li><b>+</b><span>${t('roomService')}</span><span class="num">${eur(o.roomFee || 10)}</span></li>` : ''}${coverAmt(o) ? `<li><b>+</b><span>${t('tableService')} ${o.covers} × ${eur(o.coverFee)}</span><span class="num">${eur(coverAmt(o))}</span></li>` : ''}</ul>
    ${o.note ? `<div class="note">${esc(o.note)}</div>` : ''}
    <div class="grand"><span>Totale</span><b class="num">${eur(o.total)}</b></div>
    <div class="meta">${t('waiterShort')}: ${esc(o.waiter || '—')}</div>
    <div class="actions" style="margin-top:18px"><button class="btn" data-pop="ok">${t('ok')}</button><button class="btn primary" data-pop="charge">${t('markCharged')}</button></div></div>`;
  document.body.appendChild(el);
  const close = () => { el.remove(); nextPopup(); };
  el.querySelector('[data-pop="ok"]').onclick = close;
  el.querySelector('[data-pop="charge"]').onclick = async e => { await charge(o, true, e.currentTarget); close(); };
}

// ---------- sound + PC notification ----------
function chime(soft) {
  if (!soundOn() || !audio) return;
  try {
    const now = audio.currentTime;
    (soft ? [660, 520] : [880, 1175, 1568]).forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(audio.destination);
      const s = now + i * 0.18; g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.35, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.5);
      o.start(s); o.stop(s + 0.55);
    });
  } catch { /* ignore */ }
}
function notify(o) {
  systemNote(t('notifTitle', { n: o.table, tot: eur(o.total) }),
    [o.client, roomLabel(o) ? t('room') + ' ' + roomLabel(o) : ''].filter(Boolean).join(' · ') + '\n' + o.items.map(l => `${l.qty}× ${l.it}`).join(', '), 'order-' + o.id);
}
function systemNote(title, body, tag) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const n = new Notification(title, { body, tag, icon: '/icon-192.png', requireInteraction: true });
    n.onclick = () => { window.focus(); n.close(); };
  } catch { /* some browsers only allow notifications from the service worker */ }
}

// ---------- Excel: the tab you are looking at ----------
function exportDay() {
  const rows = [['Data / Date', 'Ora / Time', 'Tavolo', 'Cliente', 'Edificio', 'Camera', 'Ordine / Items', 'Serv. camera', 'Note', 'Coperti', 'Servizio al tavolo €', 'Totale €', 'Cameriere', 'Stato', 'Addebitato / Charged']];
  const name = tab === 'hist' ? viewDay : tab === 'todo' ? 'da_addebitare_' + today() : today();
  const list = tab === 'hist' ? (past || []) : tab === 'todo' ? (toChargeList() || []) : orders();
  for (const o of list.slice().sort((a, b) => a.closedAt - b.closedAt)) rows.push([o.day.split('-').reverse().join('/'), hhmm(o.closedAt), +o.table, o.client, o.building, o.roomNo,
    o.items.map(l => `${l.qty}x ${l.it}${l.note ? ' (' + l.note + ')' : ''}`).join(', '), o.roomService ? 'Sì' : '', o.note, o.covers || 0, coverAmt(o), o.total, o.waiter,
    o.status === 'closed' ? 'Inviato' : 'Riaperto', o.chargedAt ? new Date(o.chargedAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '']);
  download(buildXlsx([{ name: name.slice(0, 31), rows }]), `reception_${name}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
