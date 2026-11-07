// Owner pages: dashboard (calendar, day/week/month), menu editor, waiters, import, audit log.
// Every text exists in English and Italian: L('English', 'Italiano') picks the language chosen with the IT/EN button.
import { SECTIONS, eur, eurShort, esc, $, $$, today, addDays, parseDay, dayLabel, hhmm, coverAmt } from './data.js';
import { S, fetchAllOrders, fetchOrders, fetchDayTotals, fetchAudit, fetchAllWaiters, saveWaiter, saveMenuItem, addMenuItem, importOrders, setSheetUrl, sheetStatus, sheetTest, reload, ownerSetChairs, ownerSetRoofTable, setCoverFee } from './store.js';
import { fromServer, orderCard, bindOrderCards, setTheme } from './waiter.js';
import { toast } from './ui.js';
import { staffNowHtml } from './staffnow.js';
import { buildXlsx, download } from './xlsx.js';
import { getLang, chooseLang } from './i18n.js';

const L = (en, it) => (getLang() === 'it' ? it : en);
const loc = () => (getLang() === 'it' ? 'it-IT' : 'en-GB');

let tab = 'dash', mode = 'day', sel = today(), calMonth = today().slice(0, 7);
let root = null;

export function mountOwner(app) {
  root = app;
  try { if (sessionStorage.getItem('ordina:open3d')) { sessionStorage.removeItem('ordina:open3d'); tab = 'rooftop'; } } catch { /* ignore */ }
  const tabs = [['dash', L('Dashboard', 'Dashboard')], ['menu', L('Menu & prices', 'Menu e prezzi')], ['waiters', L('Waiters', 'Camerieri')],
    ['rooftop', '<svg class="oti" aria-hidden="true"><use href="#i-stock"/></svg>' + L('3D Live Rooftop', 'Rooftop 3D live')], ['recv', '🔔 ' + L('Reception screen', 'Schermo reception')],
    ['sheet', L('Google Sheet (optional)', 'Google Sheet (facoltativo)')], ['import', L('Backup & import', 'Backup e importa')], ['log', L('Audit log', 'Registro modifiche')]];
  app.innerHTML = `<div class="own">
    <div class="topbar"><button class="hbtn" id="backTables">‹ ${L('Tables', 'Tavoli')}</button><h1>${L('Owner', 'Titolare')}</h1>
      <div class="tools"><button class="hbtn" id="ownLang" aria-label="${L('Language', 'Lingua')}">${getLang() === 'it' ? 'EN' : 'IT'}</button><button class="hbtn" id="ownTheme">${L('Theme', 'Tema')}</button></div></div>
    <div class="obanner"><img class="ph" src="/terrace.jpg" alt="${L('The restaurant terrace at night', 'La terrazza del ristorante di sera')}"><div class="ov"><img src="/logo.png" alt="" width="64" height="64"><span>Ristorante Concordia<small>Fugari Bistrot · ${L('Lunch orders', 'Comande pranzo')}</small></span></div></div>
    <nav class="otabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</nav>
    <div id="ownBody"></div></div>`;
  $('#backTables').onclick = () => { location.hash = ''; };
  $('#ownLang').onclick = () => chooseLang(getLang() === 'it' ? 'en' : 'it', null);   // the page is drawn again in the new language
  $('#ownTheme').onclick = () => { const th = { auto: 'light', light: 'dark', dark: 'auto' }[localStorage.getItem('ordina:theme')?.replace(/"/g, '') || 'auto']; setTheme(th); toast(L('Theme: ', 'Tema: ') + ({ auto: 'Auto', light: L('Light', 'Chiaro'), dark: L('Dark', 'Scuro') }[th])); };
  $$('.otabs button').forEach(b => { b.onclick = () => { tab = b.dataset.tab; $$('.otabs button').forEach(x => x.classList.toggle('on', x === b)); show(); }; });
  show();
}
export function ownerRender() {
  const sn = document.getElementById('staffNow'); if (sn) sn.innerHTML = staffNowHtml();   // live: who is logged in / on shift
  if (root && tab === 'menu' && !root.contains(document.activeElement) && !menuDirty.size && menuSig() !== menuDrawn) show();
}
setInterval(() => { const sn = document.getElementById('staffNow'); if (sn && !document.hidden) sn.innerHTML = staffNowHtml(); }, 60000);
function show() {
  const body = $('#ownBody');
  if (tab === 'rooftop') { openRooftopPage(); return; }
  if (tab === 'recv') { tab = 'dash'; location.hash = '#reception'; return; }   // the owner opens the live reception screen
  ({ dash: dashboard, menu: menuEditor, waiters, sheet: receptionSheet, import: importer, log: auditLog })[tab](body);
}

// ================= Dashboard =================
function range() {
  if (mode === 'day') return [sel, sel];
  if (mode === 'week') { const dow = (parseDay(sel).getUTCDay() + 6) % 7; const a = addDays(sel, -dow); return [a, addDays(a, 6)]; }
  const a = sel.slice(0, 8) + '01', [Y, M] = sel.split('-').map(Number);
  return [a, `${sel.slice(0, 8)}${String(new Date(Date.UTC(Y, M, 0)).getUTCDate()).padStart(2, '0')}`];
}
const fmtRange = ([a, b]) => a === b ? dayLabel(a, true)
  : mode === 'month' ? parseDay(a).toLocaleDateString(loc(), { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : `${parseDay(a).toLocaleDateString(loc(), { day: 'numeric', month: 'short', timeZone: 'UTC' })} – ${parseDay(b).toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
const modeName = m => ({ day: L('Day', 'Giorno'), week: L('Week', 'Settimana'), month: L('Month', 'Mese') }[m]);
const tablesN = n => (n === 1 ? L('1 table', '1 tavolo') : n + L(' tables', ' tavoli'));

async function dashboard(body) {
  const rg = range();
  body.innerHTML = `<div class="dash">
    <div class="panel" id="calP"><div class="seg" style="grid-template-columns:repeat(3,1fr);margin-bottom:12px">${['day', 'week', 'month'].map(m => `<button data-mode="${m}" class="${m === mode ? 'on' : ''}">${modeName(m)}</button>`).join('')}</div>
      <div id="cal"></div><div class="actions" style="grid-template-columns:1fr"><button class="btn" id="goToday">${L('Today', 'Oggi')}</button></div></div>
    <div id="dRight"><p class="hint">${L('Loading', 'Caricamento')} ${esc(fmtRange(rg))}…</p></div></div>`;
  const sn = document.createElement('div'); sn.className = 'panel staffnow'; sn.id = 'staffNow'; sn.innerHTML = staffNowHtml(); body.prepend(sn);
  // gentle reminder: no backup downloaded on this device for more than 30 days
  if (Date.now() - lastBackup() > 30 * 864e5) {
    const r = document.createElement('div'); r.className = 'rcp-warn'; r.style.marginBottom = '12px';
    r.innerHTML = `💾 ${lastBackup() ? L('Your last backup is more than 30 days old.', 'Il tuo ultimo backup ha più di 30 giorni.') : L('No backup downloaded yet on this device.', 'Nessun backup scaricato ancora su questo dispositivo.')} <button class="linkbtn" style="display:inline;margin:0;color:inherit" id="goBk">${L('Download a full backup now', 'Scarica adesso un backup completo')}</button>`;
    body.prepend(r); $('#goBk', body).onclick = () => { tab = 'import'; $$('.otabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === 'import')); show(); };
  }
  $$('[data-mode]', body).forEach(b => { b.onclick = () => { mode = b.dataset.mode; dashboard(body); }; });
  $('#goToday', body).onclick = () => { sel = today(); calMonth = sel.slice(0, 7); dashboard(body); };
  calendar($('#cal', body), body, rg);
  let orders;
  try { orders = (await fetchOrders(rg[0], rg[1])).map(fromServer); }
  catch (e) { $('#dRight', body).innerHTML = `<p class="err">${L('Cannot load', 'Impossibile caricare')}: ${esc(e.message)}. ${L('Check the internet.', 'Controlla internet.')}</p>`; return; }
  if (range()[0] !== rg[0] || range()[1] !== rg[1] || tab !== 'dash') return;   // the owner clicked something else meanwhile
  stats($('#dRight', body), orders, rg, body);
}

async function calendar(el, body, rg) {
  const [Y, M] = calMonth.split('-').map(Number);
  const first = `${calMonth}-01`, days = new Date(Date.UTC(Y, M, 0)).getUTCDate(), last = `${calMonth}-${String(days).padStart(2, '0')}`;
  const lead = (parseDay(first).getUTCDay() + 6) % 7;
  const wd = getLang() === 'it' ? ['Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa', 'Do'] : ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  const draw = totals => {
    let h = `<div class="cal-h"><button data-m="-1" aria-label="${L('Previous month', 'Mese precedente')}">‹</button><b>${parseDay(first).toLocaleDateString(loc(), { month: 'long', year: 'numeric', timeZone: 'UTC' })}</b><button data-m="1" aria-label="${L('Next month', 'Mese successivo')}">›</button></div>
      <div class="cal">${wd.map(d => `<span class="wd">${d}</span>`).join('')}${'<button disabled></button>'.repeat(lead)}`;
    for (let i = 1; i <= days; i++) {
      const k = `${calMonth}-${String(i).padStart(2, '0')}`, t = totals[k];
      h += `<button data-day="${k}" class="${t ? 'has' : ''}${k === sel ? ' sel' : ''}${k >= rg[0] && k <= rg[1] && k !== sel ? ' in' : ''}${k === today() ? ' today' : ''}" aria-label="${k}${t ? ', ' + eur(t) : ''}"><b>${i}</b><small class="num">${t ? eurShort(Math.round(t)) : ''}</small></button>`;
    }
    el.innerHTML = h + '</div>';
    $$('[data-m]', el).forEach(b => { b.onclick = () => { const d = new Date(Date.UTC(Y, M - 1 + +b.dataset.m, 1)); calMonth = d.toISOString().slice(0, 7); calendar(el, body, rg); }; });
    $$('[data-day]', el).forEach(b => { b.onclick = () => { sel = b.dataset.day; dashboard(body); }; });
  };
  draw({});
  try {
    const rows = await fetchDayTotals(first, last), totals = {};
    rows.filter(r => r.status === 'closed').forEach(r => { totals[r.day] = (totals[r.day] || 0) + Number(r.total); });
    draw(totals);
  } catch { /* offline: calendar without totals */ }
}

function stats(el, orders, rg, body) {
  const ok = orders.filter(o => o.status === 'closed');
  const sum = ok.reduce((a, o) => a + o.total, 0), items = ok.reduce((a, o) => a + o.items.reduce((b, l) => b + l.qty, 0), 0);
  const rs = ok.filter(o => o.roomService).length;
  const cv = ok.reduce((a, o) => a + (o.covers || 0), 0), cvSum = ok.filter(o => o.covers).reduce((a, o) => a + o.total, 0);
  const byW = {}, byD = {}, byI = {};
  for (const o of ok) {
    const w = o.waiter || '—'; byW[w] = byW[w] || { t: 0, n: 0 }; byW[w].t += o.total; byW[w].n++;
    byD[o.day] = (byD[o.day] || 0) + o.total;
    for (const l of o.items) { const k = l.it; byI[k] = byI[k] || { q: 0, r: 0 }; byI[k].q += l.qty; byI[k].r += l.qty * l.p; }
  }
  const wl = Object.entries(byW).sort((a, b) => b[1].t - a[1].t), maxW = Math.max(1, ...wl.map(x => x[1].t));
  const il = Object.entries(byI).sort((a, b) => b[1].q - a[1].q || b[1].r - a[1].r).slice(0, 10), maxI = Math.max(1, ...il.map(x => x[1].q));
  const none = `<p class="hint">${L('No orders.', 'Nessun ordine.')}</p>`;
  let cols = '';
  if (mode !== 'day') {
    const ds = []; for (let k = rg[0]; k <= rg[1]; k = addDays(k, 1)) ds.push(k);
    const maxD = Math.max(1, ...ds.map(k => byD[k] || 0));
    cols = `<div class="panel"><h3>${L('Total per day', 'Totale per giorno')}</h3><div class="cols">${ds.map(k => `<div class="col${k === sel ? ' sel' : ''}" data-day="${k}" tabindex="0" role="button" aria-label="${k}: ${eur(byD[k] || 0)}"><span class="tip">${esc(dayLabel(k))} · ${eur(byD[k] || 0)}</span><i style="height:${((byD[k] || 0) / maxD * 100).toFixed(1)}%"></i></div>`).join('')}</div>
      <div class="colx">${ds.map(k => `<span>${mode === 'week' ? parseDay(k).toLocaleDateString(loc(), { weekday: 'short', timeZone: 'UTC' }) : (+k.slice(8) % 5 === 1 ? +k.slice(8) : '')}</span>`).join('')}</div></div>`;
  }
  el.innerHTML = `<h2 style="font-family:var(--display);font-weight:400;margin:0 0 10px;font-size:24px">${esc(fmtRange(rg))}</h2>
    <div class="kpis"><div class="kpi main"><small>${L('Total', 'Totale')}</small><b class="num">${eur(sum)}</b></div><div class="kpi"><small>${L('Tables', 'Tavoli')}</small><b class="num">${ok.length}</b></div>
      <div class="kpi"><small>${L('Average table', 'Media per tavolo')}</small><b class="num">${eur(ok.length ? sum / ok.length : 0)}</b></div><div class="kpi"><small>${L('Items · room service', 'Articoli · servizio in camera')}</small><b class="num">${items} · ${rs}</b></div>
      <div class="kpi"><small>${L('Guests (coperti)', 'Ospiti (coperti)')}</small><b class="num">${cv}</b></div><div class="kpi" title="${L('Only tables where the number of guests was written', 'Solo i tavoli con il numero di ospiti inserito')}"><small>${L('Average per guest', 'Media per ospite')}</small><b class="num">${cv ? eur(cvSum / cv) : '—'}</b></div></div>
    <div style="height:14px"></div>${cols}${cols ? '<div style="height:14px"></div>' : ''}
    <div class="two"><div class="panel"><h3>${L('Total per waiter', 'Totale per cameriere')}</h3><div class="hbars">${wl.map(([w, v]) => `<div class="hb" title="${esc(w)}: ${eur(v.t)}, ${tablesN(v.n)}"><span class="nm2">${esc(w)}</span><span class="track"><span class="fill" style="display:block;width:${(v.t / maxW * 100).toFixed(1)}%"></span></span><span class="v num">${eur(v.t)}<small>${tablesN(v.n)}</small></span></div>`).join('') || none}</div></div>
      <div class="panel"><h3>${L('Best-selling dishes', 'Piatti più venduti')}</h3><div class="hbars">${il.map(([n, v]) => `<div class="hb" title="${esc(n)}: ${v.q} ${L('sold', 'venduti')}, ${eur(v.r)}"><span class="nm2">${esc(n)}</span><span class="track"><span class="fill" style="display:block;width:${(v.q / maxI * 100).toFixed(1)}%"></span></span><span class="v num">${v.q}×<small>${eur(v.r)}</small></span></div>`).join('') || none}</div></div></div>
    <div style="height:14px"></div>
    <div class="panel"><div class="tools" style="justify-content:space-between"><h3 style="margin:0">${L('Orders', 'Ordini')} (${orders.length})</h3><div class="tools"><button class="btn primary" id="xlsx">${L('Export Excel', 'Esporta Excel')}</button><button class="btn" id="csv">${L('Export CSV', 'Esporta CSV')}</button></div></div>
      <div id="olist">${orders.length ? orders.slice().reverse().map(o => orderCard(o, { withDay: mode !== 'day' })).join('') : `<p class="empty-order">${L('No orders on this day.', 'Nessun ordine in questo giorno.')}</p>`}</div></div>`;
  $$('.col', el).forEach(c => { c.onclick = () => { sel = c.dataset.day; mode = 'day'; calMonth = sel.slice(0, 7); dashboard(body); }; });
  bindOrderCards($('#olist', el), orders, () => dashboard(body));
  const name = `comande_${rg[0]}${rg[0] !== rg[1] ? '_' + rg[1] : ''}`;
  $('#xlsx', el).onclick = () => { download(buildXlsx(exportSheets(orders)), name + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); toast(L('Excel file downloaded', 'File Excel scaricato')); };
  $('#csv', el).onclick = () => { download(toCsv(exportSheets(orders)[0].rows), name + '.csv', 'text/csv;charset=utf-8'); toast(L('CSV downloaded', 'CSV scaricato')); };
}

function exportSheets(orders) {
  const date = o => o.day.split('-').reverse().join('/');
  const sent = L('sent', 'inviato'), reo = L('reopened (not counted)', 'riaperto (non conteggiato)');
  const head = L(['Date', 'Time', 'Table', 'Waiter', 'Client', 'Building', 'Room', 'Items', 'Room service', 'Note', 'Guests', 'Table service €', 'Total €', 'Status'],
    ['Data', 'Ora', 'Tavolo', 'Cameriere', 'Cliente', 'Edificio', 'Camera', 'Articoli', 'Servizio in camera', 'Note', 'Ospiti', 'Servizio al tavolo €', 'Totale €', 'Stato']);
  const rows = [head, ...orders.map(o => [date(o), hhmm(o.closedAt), +o.table, o.waiter, o.client, o.building, o.roomNo,
    o.items.map(l => `${l.qty}x ${l.it}${l.note ? ' (' + l.note + ')' : ''}`).join(', '), o.roomService ? L('yes', 'sì') : '', o.note, o.covers || 0, coverAmt(o), o.total, o.status === 'closed' ? sent : reo])];
  const lines = [L(['Date', 'Time', 'Table', 'Waiter', 'Client', 'Building', 'Room', 'Dish', 'Section', 'Qty', 'Price €', 'Line total €', 'Dish note', 'Status'],
    ['Data', 'Ora', 'Tavolo', 'Cameriere', 'Cliente', 'Edificio', 'Camera', 'Piatto', 'Sezione', 'Qtà', 'Prezzo €', 'Totale riga €', 'Nota piatto', 'Stato'])];
  for (const o of orders) for (const l of o.items) lines.push([date(o), hhmm(o.closedAt), +o.table, o.waiter, o.client, o.building, o.roomNo, l.it, l.sec, l.qty, l.p, l.qty * l.p, l.note, o.status === 'closed' ? sent : L('reopened', 'riaperto')]);
  return [{ name: L('Orders', 'Ordini'), rows }, { name: L('Dishes', 'Piatti'), rows: lines }];
}
// Italian Excel: ; between columns and , for decimals
function toCsv(rows) {
  const cell = v => typeof v === 'number' ? String(v).replace('.', ',') : `"${String(v ?? '').replace(/"/g, '""')}"`;
  return '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n');
}

// ================= Menu editor =================
// ---- Rooftop tables: app number, ACTIVE/CLOSED, chair inventory (shown in the 3D view) ----
const chairTotals = (onRoof, st, all) => L(`On the rooftop <b>${onRoof}</b> · storage <b>${st}</b> · total <b>${all}</b> physical chairs`, `Sul rooftop <b>${onRoof}</b> · magazzino <b>${st}</b> · totale <b>${all}</b> sedie fisiche`);
function roofPanel() {
  const title = L('Rooftop tables & chairs', 'Tavoli rooftop e sedie');
  const r = S.roof; if (!r.tables.length) return `<div class="panel" style="margin-bottom:14px"><h3>${title}</h3><p class="hint">${L('Not installed yet: run supabase/migrations/20261107000000_rooftop_chairs.sql in Supabase (SETUP.md, step 10).', 'Non ancora installato: esegui supabase/migrations/20261107000000_rooftop_chairs.sql in Supabase (SETUP.md, passo 10).')}</p></div>`;
  const used = new Set(r.tables.map(x => x.app_table).filter(Boolean));
  const total = Object.values(r.chairs).reduce((a, b) => a + b, 0), st = r.chairs.storage || 0;
  const opts = (cur) => `<option value="">— ${L('not linked', 'non collegato')}</option>` + Array.from({ length: 30 }, (_, i) => i + 1).map(n => `<option value="${n}" ${n === cur ? 'selected' : ''} ${used.has(n) && n !== cur ? 'disabled' : ''}>Tavolo ${n}</option>`).join('');
  return `<div class="panel" style="margin-bottom:14px"><h3>${title}</h3>
    <p class="hint">${L('Link each physical rooftop table (T1–T10, as in the 3D plan) to the table number the waiters tap in the app. ACTIVE / CLOSED is shown in the 3D view only. The chairs are the real chairs: waiters move them from the order screen; here you can correct the count (for example after counting them).',
      'Collega ogni tavolo fisico del rooftop (T1–T10, come nella pianta 3D) al numero di tavolo che i camerieri toccano nell\'app. ATTIVO / CHIUSO si vede solo nella vista 3D. Le sedie sono quelle vere: i camerieri le spostano dalla schermata dell\'ordine; qui puoi correggere il conteggio (per esempio dopo averle contate).')}</p>
    <div class="rtt">${r.tables.map(x => `<div class="rtr" data-rt="${x.id}"><b>${x.id}</b>
      <select data-f="app" aria-label="${L('App table for', 'Tavolo app per')} ${x.id}">${opts(x.app_table)}</select>
      <label class="tog"><input type="checkbox" data-f="active" ${x.active ? 'checked' : ''}>${L('Active', 'Attivo')}</label>
      <label class="rtc">🪑<input type="number" min="0" max="31" data-chairs="${x.id}" value="${r.chairs[x.id] ?? 0}" aria-label="${L('Chairs at', 'Sedie a')} ${x.id}"></label>
      <span class="muted">${x.bench_seats ? L('+ bench ', '+ panca ') + x.bench_seats : ''}</span></div>`).join('')}
      <div class="rtr"><b>${L('Storage', 'Magazzino')}</b><span class="muted">${L('reserve chairs', 'sedie di riserva')}</span><span></span><label class="rtc">🪑<input type="number" min="0" max="31" data-chairs="storage" value="${st}" aria-label="${L('Chairs in storage', 'Sedie in magazzino')}"></label><span></span></div></div>
    <p class="hint" id="rtTot">${chairTotals(total - st, st, total)}</p>
    <div class="tools"><button class="btn primary" id="rtSave">${L('Save tables', 'Salva tavoli')}</button><button class="btn" id="rtChairs">${L('Save chair count', 'Salva conteggio sedie')}</button></div></div>`;
}
function bindRoof(body) {
  const sv = $('#rtSave', body); if (!sv) return;
  const tot = () => { const v = $$('[data-chairs]', body).map(i => ({ k: i.dataset.chairs, n: Math.max(0, parseInt(i.value, 10) || 0) })); const all = v.reduce((a, x) => a + x.n, 0), st = v.find(x => x.k === 'storage').n; $('#rtTot', body).innerHTML = chairTotals(all - st, st, all); return v; };
  $$('[data-chairs]', body).forEach(i => { i.oninput = tot; });
  sv.onclick = async () => {
    const want = $$('[data-rt]', body).map(row => ({ id: row.dataset.rt, app: $('[data-f="app"]', row).value ? +$('[data-f="app"]', row).value : null, active: $('[data-f="active"]', row).checked }));
    const was = id => S.roof.tables.find(q => q.id === id);
    const changed = want.filter(w => was(w.id).app_table !== w.app || was(w.id).active !== w.active);
    try {
      // 1) unlink the tables whose number changes (so two tables can swap numbers), 2) save the new values
      for (const w of changed) if (was(w.id).app_table && was(w.id).app_table !== w.app) await ownerSetRoofTable(w.id, null, w.active);
      for (const w of changed) await ownerSetRoofTable(w.id, w.app, w.active);
      toast(L('Rooftop tables saved', 'Tavoli rooftop salvati')); menuEditor(body);
    } catch (e) { toast(e.message, null, null, 6000); }
  };
  $('#rtChairs', body).onclick = async () => {
    const v = tot(), sum = v.reduce((a, x) => a + x.n, 0), was = Object.values(S.roof.chairs).reduce((a, b) => a + b, 0);
    if (sum !== was && !confirm(L(`The total changes from ${was} to ${sum} physical chairs. Is that right (chairs bought or broken)?`, `Il totale cambia da ${was} a ${sum} sedie fisiche. È giusto (sedie comprate o rotte)?`))) return;
    try { await ownerSetChairs(Object.fromEntries(v.map(x => [x.k, x.n]))); toast(L('Chair count saved', 'Conteggio sedie salvato')); menuEditor(body); } catch (e) { toast(e.message); }
  };
}

// ---- table service (coperto) per person ----
function coverPanel() {
  const on = S.settings.cover_fee != null;
  return `<div class="panel" style="margin-bottom:14px"><h3>${L('Table service (coperto)', 'Servizio al tavolo (coperto)')}</h3>
    ${on ? `<p class="hint">${L('Added by itself to every order: guests × this price (e.g. 2 guests × € 2,00 = € 4,00). The waiter can untick it for one table. Old orders keep the price they had.', 'Aggiunto da solo a ogni ordine: ospiti × questo prezzo (es. 2 ospiti × € 2,00 = € 4,00). Il cameriere può toglierlo per un tavolo. Gli ordini vecchi tengono il prezzo che avevano.')}</p>
    <div class="tools"><label class="field" style="margin:0;max-width:220px">${L('Price per person €', 'Prezzo a persona €')}${priceIn('id="cfee"', S.settings.cover_fee)}</label><button class="btn primary" id="cfeeSave">${L('Save', 'Salva')}</button></div>`
    : `<p class="hint">${L('Not installed yet: run supabase/migrations/20261110000000_new_menu_table_service.sql in Supabase (SETUP.md, step 13).', 'Non ancora installato: esegui supabase/migrations/20261110000000_new_menu_table_service.sql in Supabase (SETUP.md, passo 13).')}</p>`}</div>`;
}
function bindCover(body) {
  const b = $('#cfeeSave', body); if (!b) return;
  b.onclick = async () => {
    const v = priceOf($('#cfee', body).value);
    if (!(v >= 0 && v <= 50)) { toast(L('Write a price between 0 and 50', 'Scrivi un prezzo tra 0 e 50')); return; }
    try { await setCoverFee(v); menuDirty.delete('cover'); toast(L('Table service saved: ', 'Servizio al tavolo salvato: ') + eur(v) + L(' per person', ' a persona')); } catch (e) { toast(e.message, null, null, 6000); }
  };
}

// Unsaved edits in Menu & prices: rows the owner is changing. While there are any, live updates never redraw the page
// (before, a waiter's order or the 1-minute refresh redrew it and the typed name/price was lost).
const menuDirty = new Set();
let menuDrawn = '';
const menuSig = () => JSON.stringify([S.menu, S.settings.cover_fee, S.roof]);
// prices: "12,50" (Italian keyboard) and "12.50" are both fine
const priceOf = v => { const s = String(v ?? '').trim().replace(',', '.'); return /^\d+(\.\d{1,2})?$/.test(s) ? Number(s) : NaN; };
const priceIn = (attrs, val) => `<input type="text" ${attrs} inputmode="decimal" autocomplete="off" ${val == null ? '' : `value="${String(Number(val).toFixed(2)).replace('.', ',')}"`}>`;

function menuEditor(body) {
  menuDirty.clear(); menuDrawn = menuSig();
  if (!S.roof.tables.length) reload('roof').then(() => { if (tab === 'menu' && !body.querySelector('#rtSave')) menuEditor(body); }).catch(() => {});
  let h = coverPanel() + roofPanel() + `<p class="hint">${L('Change a name or a price and tap Save. “Hide” removes a dish from the menu without losing it in old orders. Changes appear on every device at once and are written in the audit log.',
    'Cambia un nome o un prezzo e tocca Salva. “Nascondi” toglie un piatto dal menu senza perderlo negli ordini vecchi. Le modifiche appaiono subito su tutti i dispositivi e vengono scritte nel registro.')}</p>`;
  for (const s of SECTIONS) {
    const items = S.menu.filter(m => m.section === s.id).sort((a, b) => a.sort - b.sort);
    h += `<div class="panel" style="margin-bottom:14px"><h3>${esc(s.it)} · ${esc(s.en)}</h3>
      ${items.map(m => `<div class="mrow${m.hidden ? ' hid' : ''}" data-id="${esc(m.id)}"><input type="text" data-f="name_it" value="${esc(m.name_it)}" aria-label="${L('Italian name', 'Nome italiano')}"><input type="text" data-f="name_en" value="${esc(m.name_en)}" aria-label="${L('English subtitle', 'Sottotitolo inglese')}">
        ${priceIn(`data-f="price" aria-label="${L('Price', 'Prezzo')}"`, m.price)}<label class="tog"><input type="checkbox" data-f="hidden" ${m.hidden ? 'checked' : ''}>${L('Hide', 'Nascondi')}</label><button class="btn" data-save disabled>${L('Save', 'Salva')}</button></div>`).join('')}
      <div class="mrow" data-new="${s.id}"><input type="text" data-f="name_it" placeholder="${L('New dish (Italian)', 'Nuovo piatto (italiano)')}"><input type="text" data-f="name_en" placeholder="${L('English subtitle', 'Sottotitolo inglese')}"><input type="text" data-f="price" inputmode="decimal" autocomplete="off" placeholder="€"><span></span><button class="btn primary" data-add>${L('Add', 'Aggiungi')}</button></div></div>`;
  }
  body.innerHTML = h;
  bindRoof(body); bindCover(body);
  body.removeEventListener('input', body._menuInput || (() => {}));
  body.addEventListener('input', body._menuInput = e => { if (tab !== 'menu') return; const r = e.target.closest('.mrow'); menuDirty.add(r ? (r.dataset.id || 'new:' + r.dataset.new) : (e.target.id === 'cfee' ? 'cover' : 'roof')); });
  $$('.mrow[data-id]', body).forEach(r => {
    const btn = $('[data-save]', r);
    r.addEventListener('input', () => { btn.disabled = false; btn.classList.add('primary'); });
    btn.onclick = async () => {
      const v = f => $(`[data-f="${f}"]`, r);
      const price = priceOf(v('price').value);
      if (!v('name_it').value.trim() || !(price >= 0)) { toast(L('Write the name and a price like 12,50', 'Scrivi il nome e un prezzo come 12,50')); return; }
      btn.disabled = true;
      try { await saveMenuItem(r.dataset.id, { name_it: v('name_it').value.trim(), name_en: v('name_en').value.trim(), price, hidden: v('hidden').checked }); menuDirty.delete(r.dataset.id); menuDrawn = menuSig(); toast(L('Saved', 'Salvato')); btn.classList.remove('primary'); r.classList.toggle('hid', v('hidden').checked); }
      catch (e) { toast(e.message); btn.disabled = false; }
    };
  });
  $$('.mrow[data-new]', body).forEach(r => {
    $('[data-add]', r).onclick = async () => {
      const v = f => $(`[data-f="${f}"]`, r).value.trim(), price = priceOf(v('price'));
      if (!v('name_it') || !(price >= 0)) { toast(L('Write the name and a price like 12,50', 'Scrivi il nome e un prezzo come 12,50')); return; }
      const sec = r.dataset.new, base = v('name_it').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'dish';
      const id = S.menu.some(m => m.id === base) ? base + '-' + Math.random().toString(36).slice(2, 5) : base;
      const sort = Math.max(0, ...S.menu.filter(m => m.section === sec).map(m => m.sort)) + 1;
      try { await addMenuItem({ id, section: sec, name_it: v('name_it'), name_en: v('name_en'), price, sort }); toast(L('Dish added', 'Piatto aggiunto')); setTimeout(() => menuEditor(body), 300); }
      catch (e) { toast(e.message); }
    };
  });
}

// ================= Waiters =================
async function waiters(body) {
  body.innerHTML = `<p class="hint">${L('Loading…', 'Caricamento…')}</p>`;
  let list; try { list = await fetchAllWaiters(); } catch (e) { body.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  body.innerHTML = `<p class="hint">${L('Each waiter has a name and a 4-number PIN. To change a PIN, write the new one and tap Save (leave it empty to keep the old PIN). A waiter who leaves: untick “Active” (old orders keep the name).',
    'Ogni cameriere ha un nome e un PIN di 4 cifre. Per cambiare un PIN scrivi quello nuovo e tocca Salva (lascialo vuoto per tenere quello vecchio). Un cameriere che se ne va: togli “Attivo” (gli ordini vecchi tengono il nome).')}</p>
    <div class="panel">${list.map(w => `<div class="mrow" data-id="${w.id}"><input type="text" data-f="name" value="${esc(w.name)}" aria-label="${L('Name', 'Nome')}"><input type="password" data-f="pin" inputmode="numeric" maxlength="4" pattern="[0-9]*" placeholder="${L('New PIN (4 numbers)', 'Nuovo PIN (4 cifre)')}" autocomplete="new-password" aria-label="${L('New PIN', 'Nuovo PIN')}">
      <span></span><label class="tog"><input type="checkbox" data-f="active" ${w.active ? 'checked' : ''}>${L('Active', 'Attivo')}</label><button class="btn" data-save>${L('Save', 'Salva')}</button></div>`).join('')}
    <div class="mrow" data-new><input type="text" data-f="name" placeholder="${L('New waiter name', 'Nome nuovo cameriere')}"><input type="password" data-f="pin" inputmode="numeric" maxlength="4" pattern="[0-9]*" placeholder="${L('PIN (4 numbers)', 'PIN (4 cifre)')}" autocomplete="new-password"><span></span><span></span><button class="btn primary" data-save>${L('Add', 'Aggiungi')}</button></div></div>`;
  $$('.mrow', body).forEach(r => {
    $('[data-save]', r).onclick = async () => {
      const name = $('[data-f="name"]', r).value.trim(), pin = $('[data-f="pin"]', r).value.trim(), act = $('[data-f="active"]', r);
      if (pin && !/^\d{4}$/.test(pin)) { toast(L('The PIN must be 4 numbers', 'Il PIN deve avere 4 cifre')); return; }
      try { await saveWaiter(r.dataset.id || null, name, pin || null, act ? act.checked : true); toast(r.dataset.id ? L('Saved', 'Salvato') : L('Waiter added', 'Cameriere aggiunto')); waiters(body); }
      catch (e) { toast(e.message); }
    };
  });
}

// ================= Backup + import =================
const lastBackup = () => { try { return +localStorage.getItem('ordina:lastBackup') || 0; } catch { return 0; } };
async function downloadBackup(btn, info) {
  btn.disabled = true; info.innerHTML = `<p class="hint">${L('Reading all orders…', 'Lettura di tutti gli ordini…')}</p>`;
  try {
    const rows = await fetchAllOrders();
    // same format as the old app's export, so "Import" below can restore it (orders already there are skipped)
    const toImport = o => ({
      uid: o.uid, table: String(o.table_no), client: o.client, roomNo: o.room_no, building: o.building, waiter: o.waiter_name,
      items: (o.order_lines || []).slice().sort((a, b) => a.pos - b.pos).map(l => ({ id: l.item_id, it: l.name, qty: l.qty, p: Number(l.price), sec: l.section, note: l.note })),
      roomService: o.room_service, roomFee: Number(o.room_fee), note: o.note, total: Number(o.total), closedAt: Date.parse(o.closed_at), day: o.day,
      covers: o.covers || 0, coverFee: Number(o.cover_fee || 0), chargedAt: o.charged_at, chargedBy: o.charged_by,
    });
    const sent = rows.filter(o => o.status === 'closed'), reopened = rows.filter(o => o.status !== 'closed');
    const stamp = today();
    const data = { app: 'Comande Pranzo', backupOf: 'all orders', exportedAt: new Date().toISOString(), count: sent.length, total: sent.reduce((a, o) => a + Number(o.total), 0), orders: sent.map(toImport), reopened: reopened.map(toImport), menu: S.menu };
    download(JSON.stringify(data, null, 1), `comande_BACKUP_${stamp}.json`, 'application/json');
    const ord = sent.map(fromServer);
    download(buildXlsx(exportSheets(ord)), `comande_ALL_ORDERS_${stamp}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    try { localStorage.setItem('ordina:lastBackup', String(Date.now())); } catch { /* ignore */ }
    info.innerHTML = `<p class="hint" style="color:var(--ok);font-weight:700">${L(`Done: ${sent.length} orders · ${eur(data.total)}. Two files were downloaded: the BACKUP (.json, to restore) and ALL_ORDERS (.xlsx, to read). Keep them in a safe place (e.g. Google Drive + a USB stick).`,
      `Fatto: ${sent.length} ordini · ${eur(data.total)}. Sono stati scaricati due file: il BACKUP (.json, per ripristinare) e ALL_ORDERS (.xlsx, da leggere). Tienili in un posto sicuro (es. Google Drive + una chiavetta USB).`)}</p>`;
  } catch (e) { info.innerHTML = `<p class="err">${esc(e.message)}. ${L('Check the internet and try again.', 'Controlla internet e riprova.')}</p>`; }
  btn.disabled = false;
}

function importer(body) {
  const lb = lastBackup();
  body.innerHTML = `<div class="panel" style="margin-bottom:14px"><h3>${L('Backup — keep a copy of all your money data', 'Backup — tieni una copia di tutti i tuoi incassi')}</h3>
    <p class="hint">${L('Downloads <b>every order since the first day</b>: an Excel file to read, and a backup file that this app can import back if something ever goes wrong. Do it <b>once a week</b> and keep the files in 2 places (e.g. Google Drive + USB stick).',
      'Scarica <b>tutti gli ordini dal primo giorno</b>: un file Excel da leggere e un file di backup che questa app può reimportare se qualcosa va storto. Fallo <b>una volta a settimana</b> e tieni i file in 2 posti (es. Google Drive + chiavetta USB).')}</p>
    <p class="hint">${L('Last backup on this device', 'Ultimo backup su questo dispositivo')}: <b>${lb ? new Date(lb).toLocaleDateString('it-IT') : L('never', 'mai')}</b></p>
    <button class="btn primary" id="bkBtn">${L('Download full backup', 'Scarica backup completo')}</button><div id="bkInfo"></div></div>
    <div class="panel"><h3>${L('Import — old app history or a backup', 'Importa — storico della vecchia app o un backup')}</h3>
    <p class="hint">${L('Choose <b>history-export.json</b> (old comande.html) or a <b>comande_BACKUP_….json</b> file. You can import the same file twice: orders already in the database are skipped, only missing ones come back. Orders without a waiter are saved as “Mehdi”, like the old app showed them.',
      'Scegli <b>history-export.json</b> (vecchia comande.html) o un file <b>comande_BACKUP_….json</b>. Puoi importare lo stesso file due volte: gli ordini già presenti vengono saltati, tornano solo quelli mancanti. Gli ordini senza cameriere vengono salvati come “Mehdi”, come li mostrava la vecchia app.')}</p>
    <label class="field">${L('File', 'File')}<input type="file" id="impFile" accept=".json,application/json"></label><div id="impInfo"></div></div>`;
  $('#bkBtn', body).onclick = () => downloadBackup($('#bkBtn', body), $('#bkInfo', body));
  $('#impFile', body).onchange = async e => {
    const f = e.target.files[0]; if (!f) return; const info = $('#impInfo', body);
    let rows; try { const text = await f.text(); e.target.value = '';   // the same file can be chosen again later
      rows = JSON.parse(text); if (!Array.isArray(rows)) rows = rows.orders || rows.history; if (!Array.isArray(rows)) throw new Error(L('no list of orders', 'nessuna lista di ordini')); }
    catch (er) { info.innerHTML = `<p class="err">${L('This file is not a history export', 'Questo file non è un export dello storico')} (${esc(er.message)}).</p>`; return; }
    const days = rows.map(r => r.day).filter(Boolean).sort(), tot = rows.reduce((a, r) => a + Number(r.total || 0), 0);
    info.innerHTML = `<p><b>${rows.length}</b> ${L('orders · from', 'ordini · dal')} ${esc(days[0] || '?')} ${L('to', 'al')} ${esc(days[days.length - 1] || '?')} · ${L('total', 'totale')} <b>${eur(tot)}</b></p><button class="btn primary block" id="impGo">${L(`Import ${rows.length} orders`, `Importa ${rows.length} ordini`)}</button>`;
    $('#impGo', body).onclick = async () => {
      $('#impGo', body).disabled = true;
      try { const r = await importOrders(rows); info.innerHTML = `<p class="hint" style="color:var(--ok);font-weight:700">${L(`Done: ${r.imported} imported, ${r.already_there} were already there`, `Fatto: ${r.imported} importati, ${r.already_there} erano già presenti`)}${r.errors ? `, ${r.errors} ${L('with errors', 'con errori')}` : ''}.</p>`; if (days[0]) { sel = days[days.length - 1]; calMonth = sel.slice(0, 7); } }
      catch (er) { info.innerHTML = `<p class="err">${esc(er.message)}</p>`; }
    };
  };
}

// ================= Audit log =================
const ACT = {
  order_delete: d => L(`Deleted order · Tavolo ${d.table_no} · ${eur(d.total)} · ${d.day}${d.reason ? ' · reason: ' + d.reason : ''}`, `Ordine eliminato · Tavolo ${d.table_no} · ${eur(d.total)} · ${d.day}${d.reason ? ' · motivo: ' + d.reason : ''}`),
  order_reopen: d => L(`Reopened order · Tavolo ${d.table} · ${eur(d.total)}`, `Ordine riaperto · Tavolo ${d.table} · ${eur(d.total)}`),
  order_charged: d => L(`Charged · Tavolo ${d.table} · ${eur(d.total)}`, `Addebitato · Tavolo ${d.table} · ${eur(d.total)}`),
  order_uncharged: d => L(`Charge undone · Tavolo ${d.table} · ${eur(d.total)}`, `Addebito annullato · Tavolo ${d.table} · ${eur(d.total)}`),
  table_clear: d => L(`Deleted an open table without saving (${Object.entries(d.items || {}).map(([k, q]) => q + '× ' + k).join(', ') || 'empty'})`, `Tavolo aperto eliminato senza salvare (${Object.entries(d.items || {}).map(([k, q]) => q + '× ' + k).join(', ') || 'vuoto'})`),
  menu_edit: d => `Menu: ${d.after.name_it}${d.before.price !== d.after.price ? ` · ${L('price', 'prezzo')} ${eur(d.before.price)} → ${eur(d.after.price)}` : ''}${d.before.hidden !== d.after.hidden ? (d.after.hidden ? L(' · hidden', ' · nascosto') : L(' · shown again', ' · di nuovo visibile')) : ''}${d.before.name_it !== d.after.name_it ? ` · ${L('was', 'era')} “${d.before.name_it}”` : ''}`,
  menu_add: d => `Menu: ${L('new dish', 'nuovo piatto')} ${d.name_it} · ${eur(d.price)}`,
  waiter_add: d => `${L('New waiter', 'Nuovo cameriere')} ${d.name}`,
  waiter_edit: d => `${L('Waiter', 'Cameriere')} ${d.name}${d.pin_changed ? L(' · PIN changed', ' · PIN cambiato') : ''}${d.active === false ? L(' · not active', ' · non attivo') : ''}`,
  stock_new_day: () => L('Stock: new day count', 'Scorte: nuovo conteggio del giorno'),
  chairs_move: d => L(`Chairs moved: ${d.n} from ${d.from} to ${d.to}`, `Sedie spostate: ${d.n} da ${d.from} a ${d.to}`),
  chairs_set: () => L('Chair count corrected', 'Conteggio sedie corretto'),
  rooftop_table: d => L(`Rooftop table: app table ${d.app_table ?? '—'} · ${d.active === false ? 'CLOSED' : 'ACTIVE'}`, `Tavolo rooftop: tavolo app ${d.app_table ?? '—'} · ${d.active === false ? 'CHIUSO' : 'ATTIVO'}`),
  sheet_on: () => L('Reception sheet: turned on (link saved)', 'Foglio reception: attivato (link salvato)'),
  sheet_off: () => L('Reception sheet: turned off', 'Foglio reception: disattivato'),
  cover_fee: d => L(`Table service per person: ${eur(d.before ?? 0)} → ${eur(d.after)}`, `Servizio al tavolo a persona: ${eur(d.before ?? 0)} → ${eur(d.after)}`),
  history_import: d => L(`Imported history: ${d.imported} new, ${d.already_there} already there`, `Storico importato: ${d.imported} nuovi, ${d.already_there} già presenti`),
};
// ================= 3D Live Rooftop (loaded only when the owner opens it) =================
async function openRooftopPage() {
  const body = $('#ownBody'); body.innerHTML = `<p class="hint">${L('Loading the 3D rooftop…', 'Caricamento del rooftop 3D…')}</p>`;
  try {
    const m = await import('./rooftop/page.js');
    try { sessionStorage.removeItem('ordina:3dRetry'); } catch { /* ignore */ }
    m.openRooftop({ onBack: () => { tab = 'dash'; $$('.otabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === 'dash')); show(); } });
  } catch (e) {
    // Usually: this device still runs the previous version of the app, whose 3D file no longer exists after an update.
    // Fix it by itself once: get the new version, reload, and open the 3D tab again.
    let tried = false; try { tried = !!sessionStorage.getItem('ordina:3dRetry'); } catch { /* ignore */ }
    if (!tried && navigator.onLine) {
      try { sessionStorage.setItem('ordina:3dRetry', '1'); sessionStorage.setItem('ordina:open3d', '1'); } catch { /* ignore */ }
      body.innerHTML = `<p class="hint">${L('Updating the app to the newest version…', 'Aggiornamento dell\'app all\'ultima versione…')}</p>`;
      await updateAppNow(); location.reload(); return;
    }
    body.innerHTML = `<div class="panel"><p class="err">${L('The 3D rooftop could not load', 'Il rooftop 3D non si è caricato')} (${esc(e.message)}).</p>
      <p class="hint">${L('Check the internet, then tap Reload. On an installed app you can also close it completely and open it again.', 'Controlla internet, poi tocca Ricarica. Con l\'app installata puoi anche chiuderla del tutto e riaprirla.')}</p>
      <button class="btn primary" id="r3d">${L('Reload', 'Ricarica')}</button></div>`;
    $('#r3d', body).onclick = async () => { try { sessionStorage.removeItem('ordina:3dRetry'); sessionStorage.setItem('ordina:open3d', '1'); } catch { /* ignore */ } await updateAppNow(); location.reload(); };
  }
}

// Ask the service worker for the newest version and wait (max 8 s) until it takes over
async function updateAppNow() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) return;
    const changed = new Promise(res => { navigator.serviceWorker.addEventListener('controllerchange', res, { once: true }); setTimeout(res, 8000); });
    await reg.update();
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    if (reg.installing || reg.waiting) await changed;
  } catch { /* offline or not supported: the reload still helps */ }
}

// ================= Reception sheet (Google Sheets) =================
async function receptionSheet(body) {
  body.innerHTML = `<p class="hint">${L('Loading…', 'Caricamento…')}</p>`;
  let st; try { st = await sheetStatus(); } catch (e) {
    // the Google Sheet is optional: when its SQL file was never installed, explain calmly (no red error)
    if (/function|schema|does not exist|could not find/i.test(e.message)) {
      body.innerHTML = `<div class="panel"><h3>${L('Google Sheet for reception (optional)', 'Google Sheet per la reception (facoltativo)')}</h3>
        <p class="hint">${L('Not set up — and you don\'t need it: the <b>Reception screen</b> already shows every order to reception live, with a pop-up and a sound (button <b>🔔 Reception screen</b> above).',
          'Non configurato — e non serve: lo <b>Schermo reception</b> mostra già ogni ordine alla reception in diretta, con pop-up e suono (pulsante <b>🔔 Schermo reception</b> qui sopra).')}</p>
        <p class="hint">${L('Only if you also want a Google Sheet copy: follow RECEPTION-SHEET.md (step 1 installs supabase/migrations/20261104000000_reception_sheet.sql).', 'Solo se vuoi anche una copia su Google Sheet: segui RECEPTION-SHEET.md (il passo 1 installa supabase/migrations/20261104000000_reception_sheet.sql).')}</p></div>`;
    } else body.innerHTML = `<p class="err">${esc(e.message)}</p>`;
    return;
  }
  const last = (st.last || []).map(r => {
    const good = r.status_code >= 200 && r.status_code < 400;
    return `<li>${new Date(r.created).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })} · ${good ? `<b style="color:var(--ok)">✓ ${L('arrived', 'arrivato')}</b>` : `<b style="color:var(--danger)">✗ ${esc(r.status_code || '')} ${esc(r.error_msg || L('not arrived', 'non arrivato'))}</b>`}</li>`;
  }).join('');
  body.innerHTML = `<div class="panel"><h3>${L('Send every order to the reception\'s Google Sheet', 'Manda ogni ordine al Google Sheet della reception')}</h3>
    <p class="hint">${L('When a waiter taps <b>Send to reception</b>, a new row appears in your Google Sheet within a few seconds (one tab per day). Reopened or deleted orders are crossed out. Reception can download it as Excel: File → Download → Microsoft Excel. How to create the sheet and the link: <b>RECEPTION-SHEET.md</b>.',
      'Quando un cameriere tocca <b>Invia alla reception</b>, in pochi secondi appare una nuova riga nel tuo Google Sheet (una scheda per giorno). Gli ordini riaperti o eliminati vengono barrati. La reception può scaricarlo in Excel: File → Scarica → Microsoft Excel. Come creare il foglio e il link: <b>RECEPTION-SHEET.md</b>.')}</p>
    <p><b>${L('Now', 'Adesso')}:</b> ${st.on ? `<span style="color:var(--ok);font-weight:800">ON</span> · link ${esc(st.url_end)}` : '<span style="color:var(--muted);font-weight:800">OFF</span>'}</p>
    <label class="field">${L('Google Apps Script web app link (ends with /exec)', 'Link web app di Google Apps Script (finisce con /exec)')}<input id="shUrl" type="url" inputmode="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec"></label>
    <div class="tools"><button class="btn primary" id="shSave">${L('Save link', 'Salva link')}</button>${st.on ? `<button class="btn" id="shTest">${L('Send a test row', 'Invia una riga di prova')}</button><button class="btn warn" id="shOff">${L('Turn off', 'Disattiva')}</button>` : ''}</div>
    ${last ? `<h3 style="margin-top:16px">${L('Last sends', 'Ultimi invii')}</h3><ul class="hint">${last}</ul><button class="btn" id="shRefresh">${L('Refresh', 'Aggiorna')}</button>` : ''}</div>`;
  $('#shSave', body).onclick = async () => {
    try { await setSheetUrl($('#shUrl', body).value); toast(L('Saved', 'Salvato')); receptionSheet(body); } catch (e) { toast(e.message, null, null, 6000); }
  };
  const tst = $('#shTest', body); if (tst) tst.onclick = async () => {
    try { await sheetTest(); toast(L('Test sent. Look at your sheet in a few seconds', 'Prova inviata. Guarda il foglio tra pochi secondi')); setTimeout(() => receptionSheet(body), 4000); } catch (e) { toast(e.message); }
  };
  const off = $('#shOff', body); if (off) off.onclick = async () => { try { await setSheetUrl(''); toast(L('Turned off', 'Disattivato')); receptionSheet(body); } catch (e) { toast(e.message); } };
  const rf = $('#shRefresh', body); if (rf) rf.onclick = () => receptionSheet(body);
}

async function auditLog(body) {
  body.innerHTML = `<p class="hint">${L('Loading…', 'Caricamento…')}</p>`;
  let rows; try { rows = await fetchAudit(); } catch (e) { body.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  body.innerHTML = `<p class="hint">${L('Who did what and when (latest 300). Deleted orders are kept here in full.', 'Chi ha fatto cosa e quando (ultimi 300). Gli ordini eliminati sono conservati qui per intero.')}</p><div class="panel loglist">${rows.map(r => {
    let txt; try { txt = (ACT[r.action] || (() => r.action))(r.details || {}); } catch { txt = r.action; }
    const at = new Date(r.at);
    return `<div class="lg"><b>${esc(txt)}</b><br><small>${at.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })} ${hhmm(at.getTime())} · ${esc(r.user_email || '')}${r.waiter ? ' · ' + esc(r.waiter) : ''}</small>
      ${r.action === 'order_delete' ? `<details><summary class="muted">${L('Show the deleted order', 'Mostra l\'ordine eliminato')}</summary><pre>${esc(JSON.stringify(r.details, null, 1))}</pre></details>` : ''}</div>`;
  }).join('') || `<p class="hint">${L('Nothing yet.', 'Ancora niente.')}</p>`}</div>`;
}
