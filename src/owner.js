// Owner pages: dashboard (calendar, day/week/month), menu editor, waiters, import, audit log.
import { SECTIONS, eur, eurShort, esc, $, $$, today, addDays, parseDay, dayLabel, hhmm } from './data.js';
import { S, fetchOrders, fetchDayTotals, fetchAudit, fetchAllWaiters, saveWaiter, saveMenuItem, addMenuItem, importOrders, setSheetUrl, sheetStatus, sheetTest, reload, ownerSetChairs, ownerSetRoofTable } from './store.js';
import { fromServer, orderCard, bindOrderCards, setTheme } from './waiter.js';
import { toast } from './ui.js';
import { buildXlsx, download } from './xlsx.js';

let tab = 'dash', mode = 'day', sel = today(), calMonth = today().slice(0, 7);
let root = null;

export function mountOwner(app) {
  root = app;
  app.innerHTML = `<div class="own">
    <div class="topbar"><button class="hbtn" id="backTables">‹ Tables</button><h1>Owner</h1><button class="hbtn" id="ownTheme">Theme</button></div>
    <div class="obanner"><img class="ph" src="/terrace.jpg" alt="The restaurant terrace at night"><div class="ov"><img src="/logo.png" alt="" width="64" height="64"><span>Ristorante Concordia<small>Fugari Bistrot · Lunch orders</small></span></div></div>
    <nav class="otabs">${[['dash', 'Dashboard'], ['menu', 'Menu & prices'], ['waiters', 'Waiters'], ['rooftop', '<svg class="oti" aria-hidden="true"><use href="#i-stock"/></svg>3D Live Rooftop'], ['sheet', 'Reception sheet'], ['import', 'Import old history'], ['log', 'Audit log']].map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</nav>
    <div id="ownBody"></div></div>`;
  $('#backTables').onclick = () => { location.hash = ''; };
  $('#ownTheme').onclick = () => { const t = { auto: 'light', light: 'dark', dark: 'auto' }[localStorage.getItem('ordina:theme')?.replace(/"/g, '') || 'auto']; setTheme(t); toast('Theme: ' + t); };
  $$('.otabs button').forEach(b => { b.onclick = () => { tab = b.dataset.tab; $$('.otabs button').forEach(x => x.classList.toggle('on', x === b)); show(); }; });
  show();
}
export function ownerRender() { if (root && tab === 'menu' && !root.contains(document.activeElement)) show(); }
function show() {
  const body = $('#ownBody');
  if (tab === 'rooftop') { openRooftopPage(); return; }
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
  : mode === 'month' ? parseDay(a).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : `${parseDay(a).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} – ${parseDay(b).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;

async function dashboard(body) {
  const rg = range();
  body.innerHTML = `<div class="dash">
    <div class="panel" id="calP"><div class="seg" style="grid-template-columns:repeat(3,1fr);margin-bottom:12px">${['day', 'week', 'month'].map(m => `<button data-mode="${m}" class="${m === mode ? 'on' : ''}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>
      <div id="cal"></div><div class="actions" style="grid-template-columns:1fr"><button class="btn" id="goToday">Today</button></div></div>
    <div id="dRight"><p class="hint">Loading ${esc(fmtRange(rg))}…</p></div></div>`;
  $$('[data-mode]', body).forEach(b => { b.onclick = () => { mode = b.dataset.mode; dashboard(body); }; });
  $('#goToday', body).onclick = () => { sel = today(); calMonth = sel.slice(0, 7); dashboard(body); };
  calendar($('#cal', body), body, rg);
  let orders;
  try { orders = (await fetchOrders(rg[0], rg[1])).map(fromServer); }
  catch (e) { $('#dRight', body).innerHTML = `<p class="err">Cannot load: ${esc(e.message)}. Check the internet.</p>`; return; }
  if (range()[0] !== rg[0] || range()[1] !== rg[1] || tab !== 'dash') return;   // the owner clicked something else meanwhile
  stats($('#dRight', body), orders, rg, body);
}

async function calendar(el, body, rg) {
  const [Y, M] = calMonth.split('-').map(Number);
  const first = `${calMonth}-01`, days = new Date(Date.UTC(Y, M, 0)).getUTCDate(), last = `${calMonth}-${String(days).padStart(2, '0')}`;
  const lead = (parseDay(first).getUTCDay() + 6) % 7;
  const draw = totals => {
    let h = `<div class="cal-h"><button data-m="-1" aria-label="Previous month">‹</button><b>${parseDay(first).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</b><button data-m="1" aria-label="Next month">›</button></div>
      <div class="cal">${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => `<span class="wd">${d}</span>`).join('')}${'<button disabled></button>'.repeat(lead)}`;
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
  let cols = '';
  if (mode !== 'day') {
    const ds = []; for (let k = rg[0]; k <= rg[1]; k = addDays(k, 1)) ds.push(k);
    const maxD = Math.max(1, ...ds.map(k => byD[k] || 0));
    cols = `<div class="panel"><h3>Total per day</h3><div class="cols">${ds.map(k => `<div class="col${k === sel ? ' sel' : ''}" data-day="${k}" tabindex="0" role="button" aria-label="${k}: ${eur(byD[k] || 0)}"><span class="tip">${esc(dayLabel(k))} · ${eur(byD[k] || 0)}</span><i style="height:${((byD[k] || 0) / maxD * 100).toFixed(1)}%"></i></div>`).join('')}</div>
      <div class="colx">${ds.map(k => `<span>${mode === 'week' ? parseDay(k).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }) : (+k.slice(8) % 5 === 1 ? +k.slice(8) : '')}</span>`).join('')}</div></div>`;
  }
  el.innerHTML = `<h2 style="font-family:var(--display);font-weight:400;margin:0 0 10px;font-size:24px">${esc(fmtRange(rg))}</h2>
    <div class="kpis"><div class="kpi main"><small>Total</small><b class="num">${eur(sum)}</b></div><div class="kpi"><small>Tables</small><b class="num">${ok.length}</b></div>
      <div class="kpi"><small>Average table</small><b class="num">${eur(ok.length ? sum / ok.length : 0)}</b></div><div class="kpi"><small>Items · room service</small><b class="num">${items} · ${rs}</b></div>
      <div class="kpi"><small>Guests (coperti)</small><b class="num">${cv}</b></div><div class="kpi" title="Only tables where the number of guests was written"><small>Average per guest</small><b class="num">${cv ? eur(cvSum / cv) : '—'}</b></div></div>
    <div style="height:14px"></div>${cols}${cols ? '<div style="height:14px"></div>' : ''}
    <div class="two"><div class="panel"><h3>Total per waiter</h3><div class="hbars">${wl.map(([w, v]) => `<div class="hb" title="${esc(w)}: ${eur(v.t)}, ${v.n} table${v.n === 1 ? "" : "s"}"><span class="nm2">${esc(w)}</span><span class="track"><span class="fill" style="display:block;width:${(v.t / maxW * 100).toFixed(1)}%"></span></span><span class="v num">${eur(v.t)}<small>${v.n} table${v.n === 1 ? "" : "s"}</small></span></div>`).join('') || '<p class="hint">No orders.</p>'}</div></div>
      <div class="panel"><h3>Best-selling dishes</h3><div class="hbars">${il.map(([n, v]) => `<div class="hb" title="${esc(n)}: ${v.q} sold, ${eur(v.r)}"><span class="nm2">${esc(n)}</span><span class="track"><span class="fill" style="display:block;width:${(v.q / maxI * 100).toFixed(1)}%"></span></span><span class="v num">${v.q}×<small>${eur(v.r)}</small></span></div>`).join('') || '<p class="hint">No orders.</p>'}</div></div></div>
    <div style="height:14px"></div>
    <div class="panel"><div class="tools" style="justify-content:space-between"><h3 style="margin:0">Orders (${orders.length})</h3><div class="tools"><button class="btn primary" id="xlsx">Export Excel</button><button class="btn" id="csv">Export CSV</button></div></div>
      <div id="olist">${orders.length ? orders.slice().reverse().map(o => orderCard(o, { withDay: mode !== 'day' })).join('') : '<p class="empty-order">No orders on this day.</p>'}</div></div>`;
  $$('.col', el).forEach(c => { c.onclick = () => { sel = c.dataset.day; mode = 'day'; calMonth = sel.slice(0, 7); dashboard(body); }; });
  bindOrderCards($('#olist', el), orders, () => dashboard(body));
  const name = `comande_${rg[0]}${rg[0] !== rg[1] ? '_' + rg[1] : ''}`;
  $('#xlsx', el).onclick = () => { download(buildXlsx(exportSheets(orders)), name + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); toast('Excel file downloaded'); };
  $('#csv', el).onclick = () => { download(toCsv(exportSheets(orders)[0].rows), name + '.csv', 'text/csv;charset=utf-8'); toast('CSV downloaded'); };
}

function exportSheets(orders) {
  const date = o => o.day.split('-').reverse().join('/');
  const head = ['Date', 'Time', 'Table', 'Waiter', 'Client', 'Building', 'Room', 'Items', 'Room service', 'Note', 'Guests', 'Total €', 'Status'];
  const rows = [head, ...orders.map(o => [date(o), hhmm(o.closedAt), +o.table, o.waiter, o.client, o.building, o.roomNo,
    o.items.map(l => `${l.qty}x ${l.it}${l.note ? ' (' + l.note + ')' : ''}`).join(', '), o.roomService ? 'yes' : '', o.note, o.covers || 0, o.total, o.status === 'closed' ? 'sent' : 'reopened (not counted)'])];
  const lines = [['Date', 'Time', 'Table', 'Waiter', 'Client', 'Building', 'Room', 'Dish', 'Section', 'Qty', 'Price €', 'Line total €', 'Dish note', 'Status']];
  for (const o of orders) for (const l of o.items) lines.push([date(o), hhmm(o.closedAt), +o.table, o.waiter, o.client, o.building, o.roomNo, l.it, l.sec, l.qty, l.p, l.qty * l.p, l.note, o.status === 'closed' ? 'sent' : 'reopened']);
  return [{ name: 'Orders', rows }, { name: 'Dishes', rows: lines }];
}
// Italian Excel: ; between columns and , for decimals
function toCsv(rows) {
  const cell = v => typeof v === 'number' ? String(v).replace('.', ',') : `"${String(v ?? '').replace(/"/g, '""')}"`;
  return '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n');
}

// ================= Menu editor =================
// ---- Rooftop tables: app number, ACTIVE/CLOSED, chair inventory (shown in the 3D view) ----
function roofPanel() {
  const r = S.roof; if (!r.tables.length) return `<div class="panel" style="margin-bottom:14px"><h3>Rooftop tables & chairs</h3><p class="hint">Not installed yet: run supabase/migrations/20261107000000_rooftop_chairs.sql in Supabase (SETUP.md, step 10).</p></div>`;
  const used = new Set(r.tables.map(x => x.app_table).filter(Boolean));
  const total = Object.values(r.chairs).reduce((a, b) => a + b, 0), st = r.chairs.storage || 0;
  const opts = (cur) => `<option value="">— not linked</option>` + Array.from({ length: 30 }, (_, i) => i + 1).map(n => `<option value="${n}" ${n === cur ? 'selected' : ''} ${used.has(n) && n !== cur ? 'disabled' : ''}>Tavolo ${n}</option>`).join('');
  return `<div class="panel" style="margin-bottom:14px"><h3>Rooftop tables & chairs</h3>
    <p class="hint">Link each physical rooftop table (T1–T10, as in the 3D plan) to the table number the waiters tap in the app. ACTIVE / CLOSED is shown in the 3D view only. The chairs are the real chairs: waiters move them from the order screen; here you can correct the count (for example after counting them).</p>
    <div class="rtt">${r.tables.map(x => `<div class="rtr" data-rt="${x.id}"><b>${x.id}</b>
      <select data-f="app" aria-label="App table for ${x.id}">${opts(x.app_table)}</select>
      <label class="tog"><input type="checkbox" data-f="active" ${x.active ? 'checked' : ''}>Active</label>
      <label class="rtc">🪑<input type="number" min="0" max="31" data-chairs="${x.id}" value="${r.chairs[x.id] ?? 0}" aria-label="Chairs at ${x.id}"></label>
      <span class="muted">${x.bench_seats ? '+ bench ' + x.bench_seats : ''}</span></div>`).join('')}
      <div class="rtr"><b>Storage</b><span class="muted">reserve chairs</span><span></span><label class="rtc">🪑<input type="number" min="0" max="31" data-chairs="storage" value="${st}" aria-label="Chairs in storage"></label><span></span></div></div>
    <p class="hint" id="rtTot">On the rooftop <b>${total - st}</b> · storage <b>${st}</b> · total <b>${total}</b> physical chairs</p>
    <div class="tools"><button class="btn primary" id="rtSave">Save tables</button><button class="btn" id="rtChairs">Save chair count</button></div></div>`;
}
function bindRoof(body) {
  const sv = $('#rtSave', body); if (!sv) return;
  const tot = () => { const v = $$('[data-chairs]', body).map(i => ({ k: i.dataset.chairs, n: Math.max(0, parseInt(i.value, 10) || 0) })); const all = v.reduce((a, x) => a + x.n, 0), st = v.find(x => x.k === 'storage').n; $('#rtTot', body).innerHTML = `On the rooftop <b>${all - st}</b> · storage <b>${st}</b> · total <b>${all}</b> physical chairs`; return v; };
  $$('[data-chairs]', body).forEach(i => { i.oninput = tot; });
  sv.onclick = async () => {
    const want = $$('[data-rt]', body).map(row => ({ id: row.dataset.rt, app: $('[data-f="app"]', row).value ? +$('[data-f="app"]', row).value : null, active: $('[data-f="active"]', row).checked }));
    const was = id => S.roof.tables.find(q => q.id === id);
    const changed = want.filter(w => was(w.id).app_table !== w.app || was(w.id).active !== w.active);
    try {
      // 1) unlink the tables whose number changes (so two tables can swap numbers), 2) save the new values
      for (const w of changed) if (was(w.id).app_table && was(w.id).app_table !== w.app) await ownerSetRoofTable(w.id, null, w.active);
      for (const w of changed) await ownerSetRoofTable(w.id, w.app, w.active);
      toast('Rooftop tables saved'); menuEditor(body);
    } catch (e) { toast(e.message, null, null, 6000); }
  };
  $('#rtChairs', body).onclick = async () => {
    const v = tot(), sum = v.reduce((a, x) => a + x.n, 0), was = Object.values(S.roof.chairs).reduce((a, b) => a + b, 0);
    if (sum !== was && !confirm(`The total changes from ${was} to ${sum} physical chairs. Is that right (chairs bought or broken)?`)) return;
    try { await ownerSetChairs(Object.fromEntries(v.map(x => [x.k, x.n]))); toast('Chair count saved'); menuEditor(body); } catch (e) { toast(e.message); }
  };
}

function menuEditor(body) {
  if (!S.roof.tables.length) reload('roof').then(() => { if (tab === 'menu' && !body.querySelector('#rtSave')) menuEditor(body); }).catch(() => {});
  let h = roofPanel() + '<p class="hint">Change a name or a price and tap Save. “Hide” removes a dish from the menu without losing it in old orders. Changes appear on every device at once and are written in the audit log.</p>';
  for (const s of SECTIONS) {
    const items = S.menu.filter(m => m.section === s.id).sort((a, b) => a.sort - b.sort);
    h += `<div class="panel" style="margin-bottom:14px"><h3>${esc(s.it)} · ${esc(s.en)}</h3>
      ${items.map(m => `<div class="mrow${m.hidden ? ' hid' : ''}" data-id="${esc(m.id)}"><input type="text" data-f="name_it" value="${esc(m.name_it)}" aria-label="Italian name"><input type="text" data-f="name_en" value="${esc(m.name_en)}" aria-label="English subtitle">
        <input type="number" data-f="price" step="0.5" min="0" inputmode="decimal" value="${Number(m.price)}" aria-label="Price"><label class="tog"><input type="checkbox" data-f="hidden" ${m.hidden ? 'checked' : ''}>Hide</label><button class="btn" data-save disabled>Save</button></div>`).join('')}
      <div class="mrow" data-new="${s.id}"><input type="text" data-f="name_it" placeholder="New dish (Italian)"><input type="text" data-f="name_en" placeholder="English subtitle"><input type="number" data-f="price" step="0.5" min="0" inputmode="decimal" placeholder="€"><span></span><button class="btn primary" data-add>Add</button></div></div>`;
  }
  body.innerHTML = h;
  bindRoof(body);
  $$('.mrow[data-id]', body).forEach(r => {
    const btn = $('[data-save]', r);
    r.addEventListener('input', () => { btn.disabled = false; btn.classList.add('primary'); });
    btn.onclick = async () => {
      const v = f => $(`[data-f="${f}"]`, r);
      const price = Number(v('price').value);
      if (!v('name_it').value.trim() || !(price >= 0)) { toast('Name and price are needed'); return; }
      btn.disabled = true;
      try { await saveMenuItem(r.dataset.id, { name_it: v('name_it').value.trim(), name_en: v('name_en').value.trim(), price, hidden: v('hidden').checked }); toast('Saved'); btn.classList.remove('primary'); r.classList.toggle('hid', v('hidden').checked); }
      catch (e) { toast(e.message); btn.disabled = false; }
    };
  });
  $$('.mrow[data-new]', body).forEach(r => {
    $('[data-add]', r).onclick = async () => {
      const v = f => $(`[data-f="${f}"]`, r).value.trim(), price = Number(v('price'));
      if (!v('name_it') || v('price') === '' || !(price >= 0)) { toast('Write the name and the price'); return; }
      const sec = r.dataset.new, base = v('name_it').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'dish';
      const id = S.menu.some(m => m.id === base) ? base + '-' + Math.random().toString(36).slice(2, 5) : base;
      const sort = Math.max(0, ...S.menu.filter(m => m.section === sec).map(m => m.sort)) + 1;
      try { await addMenuItem({ id, section: sec, name_it: v('name_it'), name_en: v('name_en'), price, sort }); toast('Dish added'); setTimeout(() => menuEditor(body), 300); }
      catch (e) { toast(e.message); }
    };
  });
}

// ================= Waiters =================
async function waiters(body) {
  body.innerHTML = '<p class="hint">Loading…</p>';
  let list; try { list = await fetchAllWaiters(); } catch (e) { body.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  body.innerHTML = `<p class="hint">Each waiter has a name and a 4-number PIN. To change a PIN, write the new one and tap Save (leave it empty to keep the old PIN). A waiter who leaves: untick “Active” (old orders keep the name).</p>
    <div class="panel">${list.map(w => `<div class="mrow" data-id="${w.id}"><input type="text" data-f="name" value="${esc(w.name)}" aria-label="Name"><input type="password" data-f="pin" inputmode="numeric" maxlength="4" pattern="[0-9]*" placeholder="New PIN (4 numbers)" autocomplete="new-password" aria-label="New PIN">
      <span></span><label class="tog"><input type="checkbox" data-f="active" ${w.active ? 'checked' : ''}>Active</label><button class="btn" data-save>Save</button></div>`).join('')}
    <div class="mrow" data-new><input type="text" data-f="name" placeholder="New waiter name"><input type="password" data-f="pin" inputmode="numeric" maxlength="4" pattern="[0-9]*" placeholder="PIN (4 numbers)" autocomplete="new-password"><span></span><span></span><button class="btn primary" data-save>Add</button></div></div>`;
  $$('.mrow', body).forEach(r => {
    $('[data-save]', r).onclick = async () => {
      const name = $('[data-f="name"]', r).value.trim(), pin = $('[data-f="pin"]', r).value.trim(), act = $('[data-f="active"]', r);
      if (pin && !/^\d{4}$/.test(pin)) { toast('The PIN must be 4 numbers'); return; }
      try { await saveWaiter(r.dataset.id || null, name, pin || null, act ? act.checked : true); toast(r.dataset.id ? 'Saved' : 'Waiter added'); waiters(body); }
      catch (e) { toast(e.message); }
    };
  });
}

// ================= Import =================
function importer(body) {
  body.innerHTML = `<div class="panel"><h3>Import the history of the old app</h3>
    <p class="hint">Choose the file <b>history-export.json</b> (the export of the old comande.html). You can import the same file twice: orders already in the database are skipped. Orders without a waiter are saved as “Mehdi”, like the old app showed them.</p>
    <label class="field">File<input type="file" id="impFile" accept=".json,application/json"></label><div id="impInfo"></div></div>`;
  $('#impFile', body).onchange = async e => {
    const f = e.target.files[0]; if (!f) return; const info = $('#impInfo', body);
    let rows; try { rows = JSON.parse(await f.text()); if (!Array.isArray(rows)) rows = rows.orders || rows.history; if (!Array.isArray(rows)) throw new Error('no list of orders'); }
    catch (er) { info.innerHTML = `<p class="err">This file is not a history export (${esc(er.message)}).</p>`; return; }
    const days = rows.map(r => r.day).filter(Boolean).sort(), tot = rows.reduce((a, r) => a + Number(r.total || 0), 0);
    info.innerHTML = `<p><b>${rows.length}</b> orders · from ${esc(days[0] || '?')} to ${esc(days[days.length - 1] || '?')} · total <b>${eur(tot)}</b></p><button class="btn primary block" id="impGo">Import ${rows.length} orders</button>`;
    $('#impGo', body).onclick = async () => {
      $('#impGo', body).disabled = true;
      try { const r = await importOrders(rows); info.innerHTML = `<p class="hint" style="color:var(--ok);font-weight:700">Done: ${r.imported} imported, ${r.already_there} were already there${r.errors ? `, ${r.errors} with errors` : ''}.</p>`; if (days[0]) { sel = days[days.length - 1]; calMonth = sel.slice(0, 7); } }
      catch (er) { info.innerHTML = `<p class="err">${esc(er.message)}</p>`; }
    };
  };
}

// ================= Audit log =================
const ACT = {
  order_delete: d => `Deleted order · Tavolo ${d.table_no} · ${eur(d.total)} · ${d.day}${d.reason ? ' · reason: ' + d.reason : ''}`,
  order_reopen: d => `Reopened order · Tavolo ${d.table} · ${eur(d.total)}`,
  table_clear: d => `Deleted an open table without saving (${Object.entries(d.items || {}).map(([k, q]) => q + '× ' + k).join(', ') || 'empty'})`,
  menu_edit: d => `Menu: ${d.after.name_it}${d.before.price !== d.after.price ? ` · price ${eur(d.before.price)} → ${eur(d.after.price)}` : ''}${d.before.hidden !== d.after.hidden ? (d.after.hidden ? ' · hidden' : ' · shown again') : ''}${d.before.name_it !== d.after.name_it ? ` · was “${d.before.name_it}”` : ''}`,
  menu_add: d => `Menu: new dish ${d.name_it} · ${eur(d.price)}`,
  waiter_add: d => `New waiter ${d.name}`,
  waiter_edit: d => `Waiter ${d.name}${d.pin_changed ? ' · PIN changed' : ''}${d.active === false ? ' · not active' : ''}`,
  stock_new_day: () => 'Stock: new day count',
  sheet_on: () => 'Reception sheet: turned on (link saved)',
  sheet_off: () => 'Reception sheet: turned off',
  history_import: d => `Imported old history: ${d.imported} new, ${d.already_there} already there`,
};
// ================= 3D Live Rooftop (loaded only when the owner opens it) =================
async function openRooftopPage() {
  const body = $('#ownBody'); body.innerHTML = '<p class="hint">Loading the 3D rooftop…</p>';
  try {
    const m = await import('./rooftop/page.js');
    m.openRooftop({ onBack: () => { tab = 'dash'; $$('.otabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === 'dash')); show(); } });
  } catch (e) { body.innerHTML = `<p class="err">The 3D rooftop could not load (${esc(e.message)}). Check the internet and try again.</p>`; }
}

// ================= Reception sheet (Google Sheets) =================
async function receptionSheet(body) {
  body.innerHTML = '<p class="hint">Loading…</p>';
  let st; try { st = await sheetStatus(); } catch (e) { body.innerHTML = `<p class="err">${esc(e.message)}${/function|schema/i.test(e.message) ? ' — first run the file supabase/migrations/20261104000000_reception_sheet.sql in Supabase (RECEPTION-SHEET.md, step 1).' : ''}</p>`; return; }
  const last = (st.last || []).map(r => {
    const good = r.status_code >= 200 && r.status_code < 400;
    return `<li>${new Date(r.created).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })} · ${good ? '<b style="color:var(--ok)">✓ arrived</b>' : `<b style="color:var(--danger)">✗ ${esc(r.status_code || '')} ${esc(r.error_msg || 'not arrived')}</b>`}</li>`;
  }).join('');
  body.innerHTML = `<div class="panel"><h3>Send every order to the reception's Google Sheet</h3>
    <p class="hint">When a waiter taps <b>Send to reception</b>, a new row appears in your Google Sheet within a few seconds (one tab per day). Reopened or deleted orders are crossed out. Reception can download it as Excel: File → Download → Microsoft Excel. How to create the sheet and the link: <b>RECEPTION-SHEET.md</b>.</p>
    <p><b>Now:</b> ${st.on ? `<span style="color:var(--ok);font-weight:800">ON</span> · link ${esc(st.url_end)}` : '<span style="color:var(--muted);font-weight:800">OFF</span>'}</p>
    <label class="field">Google Apps Script web app link (ends with /exec)<input id="shUrl" type="url" inputmode="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec"></label>
    <div class="tools"><button class="btn primary" id="shSave">Save link</button>${st.on ? '<button class="btn" id="shTest">Send a test row</button><button class="btn warn" id="shOff">Turn off</button>' : ''}</div>
    ${last ? `<h3 style="margin-top:16px">Last sends</h3><ul class="hint">${last}</ul><button class="btn" id="shRefresh">Refresh</button>` : ''}</div>`;
  $('#shSave', body).onclick = async () => {
    try { await setSheetUrl($('#shUrl', body).value); toast('Saved'); receptionSheet(body); } catch (e) { toast(e.message, null, null, 6000); }
  };
  const tst = $('#shTest', body); if (tst) tst.onclick = async () => {
    try { await sheetTest(); toast('Test sent. Look at your sheet in a few seconds'); setTimeout(() => receptionSheet(body), 4000); } catch (e) { toast(e.message); }
  };
  const off = $('#shOff', body); if (off) off.onclick = async () => { try { await setSheetUrl(''); toast('Turned off'); receptionSheet(body); } catch (e) { toast(e.message); } };
  const rf = $('#shRefresh', body); if (rf) rf.onclick = () => receptionSheet(body);
}

async function auditLog(body) {
  body.innerHTML = '<p class="hint">Loading…</p>';
  let rows; try { rows = await fetchAudit(); } catch (e) { body.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  body.innerHTML = `<p class="hint">Who did what and when (latest 300). Deleted orders are kept here in full.</p><div class="panel loglist">${rows.map(r => {
    let txt; try { txt = (ACT[r.action] || (() => r.action))(r.details || {}); } catch { txt = r.action; }
    const at = new Date(r.at);
    return `<div class="lg"><b>${esc(txt)}</b><br><small>${at.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })} ${hhmm(at.getTime())} · ${esc(r.user_email || '')}${r.waiter ? ' · ' + esc(r.waiter) : ''}</small>
      ${r.action === 'order_delete' ? `<details><summary class="muted">Show the deleted order</summary><pre>${esc(JSON.stringify(r.details, null, 1))}</pre></details>` : ''}</div>`;
  }).join('') || '<p class="hint">Nothing yet.</p>'}</div>`;
}
