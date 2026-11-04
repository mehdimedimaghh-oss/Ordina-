// Reception screen (PC of the reception): today's orders live, pop-up + sound + PC notification
// for every new order, "Charged ✓" button, Excel of the day.
import { esc, eur, $, $$, today, hhmm, roomLabel, ms } from './data.js';
import { S, LS, reload, markCharged } from './store.js';
import { fromServer } from './waiter.js';
import { toast } from './ui.js';
import { t, getLang, chooseLang } from './i18n.js';
import { buildXlsx, download } from './xlsx.js';

let root = null, started = false, seen = null, known = null, popupQueue = [], timer = null, audio = null, mountAt = 0, baseline = true;
const soundOn = () => LS.get('recvSound', true);

export function mountReception(app) {
  root = app;
  // orders already there when the screen opens: no pop-up for them
  const saved = LS.get('recvSeen:' + today(), null);
  seen = new Set(saved || []);
  baseline = !!saved;          // first time on this PC today: orders already there are only listed, no pop-up
  mountAt = Date.now(); known = null; popupQueue = [];
  draw();
  clearInterval(timer);
  timer = setInterval(() => { if (navigator.onLine) reload('today'); }, 20000);   // safety net if a live message is lost
  reload('today');
}
export const leaveReception = () => { clearInterval(timer); root = null; started = false; popupQueue = []; };

function orders() {
  return S.today.filter(o => o.day === today()).map(o => ({ ...fromServer(o), chargedAt: ms(o.charged_at), chargedBy: o.charged_by }))
    .sort((a, b) => b.closedAt - a.closedAt);
}

// called by main.js on every change of data
export function receptionRender() {
  if (!root || !$('#recvList')) return;
  const list = orders();
  detectChanges(list);
  drawList(list);
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
        <button class="hbtn" id="rcpExit">${t('exit')}</button>
      </div>
    </div>
    ${started ? '' : `<button class="rcp-start" id="recvStart"><b>${t('startRecv')}</b><span>${t('startHint')}</span></button>`}
    ${notif === 'denied' ? `<p class="rcp-warn">${t('notifBlocked')}</p>` : ''}
    <div class="rcp-sum" id="recvSum"></div>
    <div id="recvList"></div></div>`;
  $('#rcpDate').textContent = new Date().toLocaleDateString(getLang() === 'it' ? 'it-IT' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome' });
  const st = $('#recvStart'); if (st) st.onclick = start;
  $('#rcpLang').onclick = () => chooseLang(getLang() === 'it' ? 'en' : 'it', null);
  $('#rcpSound').onclick = () => { LS.set('recvSound', !soundOn()); if (soundOn()) chime(); draw(); receptionRender(); };
  $('#rcpXlsx').onclick = exportDay;
  $('#rcpExit').onclick = () => { if (confirm(t('exitRecv'))) { LS.del('mode'); leaveReception(); location.hash = ''; location.reload(); } };
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

function drawList(list) {
  const ok = list.filter(o => o.status === 'closed'), todo = ok.filter(o => !o.chargedAt);
  const live = $('#rcpLive'); if (live) { const on = navigator.onLine; live.textContent = on ? '● ' + t('live') : '● ' + t('reconnecting'); live.classList.toggle('off', !on); }
  $('#recvSum').innerHTML = `<div class="kpi main"><small>${t('todayTotal')}</small><b class="num">${eur(ok.reduce((a, o) => a + o.total, 0))}</b></div>
    <div class="kpi"><small>${t('ordersN', { n: ok.length })}</small><b class="num">${todo.length ? t('toChargeN', { n: todo.length }) : t('allCharged')}</b></div>`;
  const el = $('#recvList');
  if (!list.length) { el.innerHTML = `<p class="empty-order">${t('noOrdersToday')}</p>`; return; }
  el.innerHTML = list.map(card).join('');
  $$('[data-charge]', el).forEach(b => { b.onclick = () => charge(list.find(o => String(o.id) === b.dataset.charge), b.dataset.on === '1', b); });
}

function card(o) {
  const reopened = o.status === 'reopened';
  return `<div class="rcard${o.chargedAt ? ' done' : ''}${reopened ? ' reopened' : ''}">
    <div class="rc-l"><div class="rc-t">${t('tableLabel', { n: o.table })}</div><div class="rc-h num">${hhmm(o.closedAt)}</div></div>
    <div class="rc-m">
      <div class="rc-who">${esc(o.client || '—')}${roomLabel(o) ? `<span class="rc-room">${t('room')} ${esc(roomLabel(o))}</span>` : ''}</div>
      <div class="rc-items">${o.items.map(l => `<b>${l.qty}×</b> ${esc(l.it)}${l.note ? ` <i>(${esc(l.note)})</i>` : ''}`).join(' · ')}${o.roomService ? ` · <b>+</b> ${t('roomService')}` : ''}</div>
      ${o.note ? `<div class="rc-note">${esc(o.note)}</div>` : ''}
      <div class="rc-w">${t('waiterShort')}: ${esc(o.waiter || '—')}</div>
    </div>
    <div class="rc-r"><div class="rc-tot num">${eur(o.total)}</div>
      ${reopened ? `<span class="waitbadge">${t('reopenedBadge')}</span>`
        : o.chargedAt ? `<span class="rc-ok">${t('chargedBadge', { time: hhmm(o.chargedAt) })}</span><button class="linkbtn" data-charge="${o.id}" data-on="0">${t('notCharged')}</button>`
          : `<button class="btn primary" data-charge="${o.id}" data-on="1">${t('markCharged')}</button>`}</div></div>`;
}

async function charge(o, on, btn) {
  if (!o) return;
  btn.disabled = true;
  try { await markCharged(o.id, on, 'Reception'); if (on) toast(t('chargedOk')); }
  catch (e) { toast(e.message, null, null, 5000); btn.disabled = false; }
}

// ---------- pop-up ----------
function nextPopup() {
  const o = popupQueue.shift(); if (!o) return;
  const el = document.createElement('div'); el.className = 'recv recv-pop'; el.setAttribute('role', 'alertdialog');
  el.innerHTML = `<div class="in">
    <div class="top"><div><div class="lbl">🔔 ${t('newOrder')}${popupQueue.length ? ` · +${popupQueue.length}` : ''}</div><h2>${t('tableLabel', { n: o.table })}</h2></div><div class="rc-h num" style="font-size:22px">${hhmm(o.closedAt)}</div></div>
    ${o.client ? `<div class="who">${esc(o.client)}</div>` : ''}${roomLabel(o) ? `<div class="room">${t('room')} ${esc(roomLabel(o))}</div>` : ''}
    <ul>${o.items.map(l => `<li><b>${l.qty}×</b><span>${esc(l.it)}${l.note ? `<i>${esc(l.note)}</i>` : ''}</span><span class="num">${eur(l.qty * l.p)}</span></li>`).join('')}
    ${o.roomService ? `<li><b>+</b><span>${t('roomService')}</span><span class="num">${eur(o.roomFee || 10)}</span></li>` : ''}</ul>
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

// ---------- Excel of the day ----------
function exportDay() {
  const rows = [['Ora / Time', 'Tavolo', 'Cliente', 'Edificio', 'Camera', 'Ordine / Items', 'Serv. camera', 'Note', 'Totale €', 'Cameriere', 'Stato', 'Addebitato / Charged']];
  for (const o of orders().slice().reverse()) rows.push([hhmm(o.closedAt), +o.table, o.client, o.building, o.roomNo,
    o.items.map(l => `${l.qty}x ${l.it}${l.note ? ' (' + l.note + ')' : ''}`).join(', '), o.roomService ? 'Sì' : '', o.note, o.total, o.waiter,
    o.status === 'closed' ? 'Inviato' : 'Riaperto', o.chargedAt ? hhmm(o.chargedAt) : '']);
  download(buildXlsx([{ name: today(), rows }]), `reception_${today()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
