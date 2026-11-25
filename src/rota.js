// Monthly staff schedule ("Turni"): the grid like the hotel's paper sheet, the owner's editor,
// the read-only team view for the waiters, and the print / PDF of a month.
// Data: staff_months + staff_shifts in the database (see supabase/migrations/…_staff_schedule.sql).
import { esc, $, $$, today } from './data.js';
import { S, monthAdd, fetchRotaMonth, saveRotaMonth, fetchAllWaiters } from './store.js';
import { SHIFTS, gridFromCode, gridFromDb, gridFor } from './schedule.js';
import { toast } from './ui.js';
import { getLang } from './i18n.js';

const L = (en, it) => (getLang() === 'it' ? it : en);
export const CODES = ['M', 'C', 'P', 'R'];
const TIMES = Object.fromEntries(SHIFTS.map(s => [{ m: 'M', d: 'C', e: 'P' }[s.id], `${s.from}–${s.to}`]));   // M/C/P → hours (unchanged)
const daysIn = ym => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const weekday = (ym, d) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1, d)).getUTCDay();   // 0 = Sunday
const WD = () => (getLang() === 'it' ? ['D', 'L', 'M', 'M', 'G', 'V', 'S'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S']);
export const monthName = ym => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1))
  .toLocaleDateString(getLang() === 'it' ? 'it-IT' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function legendHtml() {
  return `<div class="rota-legend">${CODES.map(c => `<span class="rl"><b class="sc s-${c}">${c}</b>${c === 'R' ? L('Rest day', 'Riposo') : `${{ M: L('Morning', 'Mattina'), C: L('Middle', 'Centrale'), P: L('Afternoon / evening', 'Pomeriggio / sera') }[c]} ${TIMES[c]}`}</span>`).join('')}</div>`;
}

// how many people on M / C / P that day; a day without one of them is shown in red
function coverage(grid, ym, d) {
  const n = { M: 0, C: 0, P: 0, R: 0 };
  for (const p of grid.people) { const s = (grid.cells[p.name] || {})[d]; if (s) n[s]++; }
  return n;
}

// The grid. opts: { edit: true } for the owner, { me: 'Name' } to highlight one row
export function gridHtml(ym, grid, opts = {}) {
  const n = daysIn(ym), td = today(), wd = WD();
  const head = Array.from({ length: n }, (_, i) => {
    const d = i + 1, w = weekday(ym, d), isToday = `${ym}-${String(d).padStart(2, '0')}` === td;
    return `<th class="dh${w === 0 || w === 6 ? ' we' : ''}${isToday ? ' today' : ''}" scope="col"><small>${wd[w]}</small>${d}</th>`;
  }).join('');
  const rows = grid.people.map((p, pi) => {
    const mine = opts.me && p.name.toLowerCase() === String(opts.me).toLowerCase();
    const cells = Array.from({ length: n }, (_, i) => {
      const d = i + 1, s = (grid.cells[p.name] || {})[d] || '', isToday = `${ym}-${String(d).padStart(2, '0')}` === td;
      const cls = `c${s ? ' s-' + s : ''}${isToday ? ' today' : ''}`;
      return opts.edit
        ? `<td class="${cls}"><button type="button" class="cb" data-p="${pi}" data-d="${d}" aria-label="${esc(p.name)} ${d}: ${s || L('empty', 'vuoto')}">${s}</button></td>`
        : `<td class="${cls}">${s}</td>`;
    }).join('');
    const tag = p.waiter_id ? '' : `<small class="np">${L('no app account', 'senza account app')}</small>`;
    return `<tr class="${mine ? 'mine' : ''}" data-name="${esc(p.name)}"><th class="rp" scope="row"><div class="rpin"><span class="nm" title="${esc(p.name)}">${esc(p.name)}${opts.edit ? tag : ''}</span>${opts.edit ? `<span class="rp-tools"><button type="button" class="rpb" data-up="${pi}" aria-label="${L('Move up', 'Sposta su')}" ${pi ? '' : 'disabled'}>↑</button><button type="button" class="rpb" data-del="${pi}" aria-label="${L('Remove', 'Togli')} ${esc(p.name)}">×</button></span>` : ''}</div></th>${cells}</tr>`;
  }).join('');
  const cov = opts.edit && grid.people.length ? `<tr class="rota-cov"><th class="rp" scope="row">${L('Coverage', 'Copertura')}</th>${Array.from({ length: n }, (_, i) => {
    const c = coverage(grid, ym, i + 1), miss = ['M', 'C', 'P'].filter(k => !c[k]);
    return `<td class="${miss.length ? 'bad' : 'ok'}" title="${miss.length ? L('Missing: ', 'Manca: ') + miss.join(', ') : 'M ' + c.M + ' · C ' + c.C + ' · P ' + c.P}">${miss.length ? miss.join('') : '✓'}</td>`;
  }).join('')}</tr>` : '';
  return `<div class="rota-wrap"><table class="rota${opts.edit ? ' edit' : ''}">
    <thead><tr><th class="rp mh" scope="col">${esc(monthName(ym))}</th>${head}</tr></thead>
    <tbody>${rows || `<tr><th class="rp">—</th><td colspan="${n}" class="empty">${L('No people yet. Add them below.', 'Nessuna persona. Aggiungile qui sotto.')}</td></tr>`}${cov}</tbody></table></div>`;
}

// ---------- print / PDF (landscape A4, like the paper sheet) ----------
export function printRota(ym, grid) {
  $('#printArea')?.remove(); document.getElementById('rotaPage')?.remove();
  const el = document.createElement('div'); el.id = 'printArea';
  el.innerHTML = `<div class="rota-print"><h1>${L('Staff schedule', 'Turni del personale')} · ${esc(monthName(ym))}</h1>
    ${legendHtml()}${gridHtml(ym, grid)}<p class="rp-foot">Hotel Concordia · ${L('printed', 'stampato')} ${new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}</p></div>`;
  const page = document.createElement('style'); page.id = 'rotaPage'; page.textContent = '@page{size:A4 landscape;margin:8mm}';
  document.head.appendChild(page); document.body.appendChild(el); document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); el.remove(); page.remove(); removeEventListener('afterprint', done); };
  addEventListener('afterprint', done);
  setTimeout(() => { try { window.print(); } catch { /* ignore */ } setTimeout(() => { if (document.getElementById('printArea') === el) done(); }, 60000); }, 50);
}

// ================= Owner: the editor =================
let ed = null;   // { ym, grid, version, source, dirty, notInstalled, waiters }
const curYm = () => today().slice(0, 7);
const clone = g => ({ ...g, people: g.people.map(p => ({ ...p })), cells: Object.fromEntries(Object.entries(g.cells).map(([k, v]) => [k, { ...v }])) });

async function loadMonth(ym) {
  try {
    const { month, rows } = await fetchRotaMonth(ym);
    if (month) return { grid: gridFromDb(month, rows), source: 'db', version: month.version };
    const g = gridFromCode(ym);
    return g ? { grid: g, source: 'code', version: 0 } : { grid: { people: [], cells: {} }, source: 'new', version: 0 };
  } catch (e) {
    const g = gridFromCode(ym) || { people: [], cells: {} };
    return { grid: g, source: 'code', version: 0, notInstalled: /staff_|does not exist|schema cache/i.test(e.message), error: e.message };
  }
}

export async function rotaEditor(body, ym = (ed && ed.ym) || curYm()) {
  if (ed && ed.dirty && ed.ym !== ym && !confirm(L('You have unsaved changes in this month. Leave without saving?', 'Ci sono modifiche non salvate in questo mese. Uscire senza salvare?'))) return;
  body.innerHTML = `<p class="hint">${L('Loading…', 'Caricamento…')}</p>`;
  const [r, waiters] = await Promise.all([loadMonth(ym), fetchAllWaiters().catch(() => S.waiters || [])]);
  ed = { ym, grid: r.grid, version: r.version, source: r.source, dirty: false, notInstalled: !!r.notInstalled, error: r.error, waiters };
  // link people to waiters by name when the link is missing
  for (const p of ed.grid.people) if (!p.waiter_id) { const w = waiters.find(x => x.name.toLowerCase() === p.name.toLowerCase()); if (w) p.waiter_id = w.id; }
  drawEditor(body);
}

function statusLine() {
  if (ed.notInstalled) return `<p class="rota-st warn">${L('The schedule part of the database is not installed yet (SETUP.md, step 18). You can look at the months written in the app, but saving needs that step.', 'La parte turni del database non è ancora installata (SETUP.md, passo 18). Puoi vedere i mesi scritti nell’app, ma per salvare serve quel passo.')}</p>`;
  if (ed.error) return `<p class="rota-st warn">${esc(ed.error)}</p>`;
  if (ed.dirty) return `<p class="rota-st warn">● ${L('Unsaved changes', 'Modifiche non salvate')}</p>`;
  if (ed.source === 'db') return `<p class="rota-st ok">✓ ${L('Saved', 'Salvato')}${ed.grid.updatedAt ? ' · ' + new Date(ed.grid.updatedAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}${ed.grid.updatedBy ? ' · ' + esc(ed.grid.updatedBy) : ''}</p>`;
  if (ed.source === 'code') return `<p class="rota-st">${L('This month comes from the app (not saved in the database yet). Tap Save to keep it here and edit it.', 'Questo mese viene dall’app (non ancora salvato nel database). Tocca Salva per tenerlo qui e modificarlo.')}</p>`;
  return `<p class="rota-st">${L('New month: add the people, then tap the cells (M, C, P, R). Or copy the previous month.', 'Mese nuovo: aggiungi le persone, poi tocca le caselle (M, C, P, R). Oppure copia il mese precedente.')}</p>`;
}

function drawEditor(body) {
  const free = ed.waiters.filter(w => w.active !== false && !ed.grid.people.some(p => p.name.toLowerCase() === w.name.toLowerCase()));
  body.innerHTML = `<div class="rota-ed">
    <div class="rota-top">
      <div class="rota-nav"><button class="hbtn" id="rPrev" aria-label="${L('Previous month', 'Mese precedente')}">‹</button>
        <input type="month" id="rMonth" value="${ed.ym}" aria-label="${L('Month', 'Mese')}"><button class="hbtn" id="rNext" aria-label="${L('Next month', 'Mese successivo')}">›</button>
        <button class="linkbtn" id="rToday">${L('This month', 'Questo mese')}</button></div>
      <div class="rota-act"><button class="btn" id="rCopy">${L('Copy previous month', 'Copia mese precedente')}</button><button class="btn" id="rPrint">🖨 ${L('Print / PDF', 'Stampa / PDF')}</button>
        <button class="btn primary" id="rSave" ${ed.dirty && !ed.notInstalled ? '' : 'disabled'}>${L('Save', 'Salva')}</button></div>
    </div>
    ${statusLine()}
    ${legendHtml()}
    <p class="hint">${L('Tap a cell to change it: empty → M → C → P → R. On a computer you can also type M, C, P, R or Delete, and move with the arrow keys. Two or more people can have the same shift on the same day.', 'Tocca una casella per cambiarla: vuota → M → C → P → R. Al computer puoi anche scrivere M, C, P, R o Canc, e spostarti con le frecce. Due o più persone possono avere lo stesso turno lo stesso giorno.')}</p>
    ${gridHtml(ed.ym, ed.grid, { edit: true })}
    <div class="rota-add">
      <label class="field">${L('Add a waiter', 'Aggiungi un cameriere')}<select id="rWaiter"><option value="">—</option>${free.map(w => `<option value="${esc(w.id)}">${esc(w.name)}</option>`).join('')}</select></label>
      <label class="field">${L('…or a person without an app account', '…oppure una persona senza account app')}<input id="rName" type="text" maxlength="60" autocomplete="off" placeholder="${L('e.g. Nuova risorsa', 'es. Nuova risorsa')}"></label>
      <button class="btn" id="rAdd">+ ${L('Add', 'Aggiungi')}</button>
    </div></div>`;
  bindEditor(body);
}

function setDirty(body) { ed.dirty = true; const b = $('#rSave', body); if (b && !ed.notInstalled) b.disabled = false; const st = $('.rota-st', body); if (st) st.outerHTML = statusLine(); }
function redrawGrid(body) {
  const keep = $('.rota-wrap', body)?.scrollLeft || 0, focus = document.activeElement?.dataset;
  $('.rota-wrap', body).outerHTML = gridHtml(ed.ym, ed.grid, { edit: true });
  $('.rota-wrap', body).scrollLeft = keep; bindGrid(body);
  if (focus && focus.p != null && focus.d) $(`.cb[data-p="${focus.p}"][data-d="${focus.d}"]`, body)?.focus({ preventScroll: true });
}
function setCell(body, pi, d, s) {
  const p = ed.grid.people[pi]; if (!p) return;
  const c = (ed.grid.cells[p.name] ||= {});
  if (s) c[d] = s; else delete c[d];
  setDirty(body); redrawGrid(body);
}

function bindGrid(body) {
  $$('.cb', body).forEach(b => {
    b.onclick = () => { const pi = +b.dataset.p, d = +b.dataset.d, cur = (ed.grid.cells[ed.grid.people[pi].name] || {})[d] || '', order = ['', ...CODES]; setCell(body, pi, d, order[(order.indexOf(cur) + 1) % order.length]); };
    b.onkeydown = e => {
      const pi = +b.dataset.p, d = +b.dataset.d, k = e.key.toUpperCase();
      if (CODES.includes(k)) { e.preventDefault(); setCell(body, pi, d, k); return; }
      if (k === 'DELETE' || k === 'BACKSPACE') { e.preventDefault(); setCell(body, pi, d, ''); return; }
      const mv = { ARROWLEFT: [0, -1], ARROWRIGHT: [0, 1], ARROWUP: [-1, 0], ARROWDOWN: [1, 0] }[k];
      if (mv) { e.preventDefault(); $(`.cb[data-p="${pi + mv[0]}"][data-d="${d + mv[1]}"]`, body)?.focus(); }
    };
  });
  $$('[data-del]', body).forEach(b => { b.onclick = () => {
    const p = ed.grid.people[+b.dataset.del], has = Object.keys(ed.grid.cells[p.name] || {}).length;
    if (has && !confirm(L(`Remove ${p.name} from this month? Their ${has} shifts of this month are removed too (other months stay).`, `Togliere ${p.name} da questo mese? Anche i suoi ${has} turni di questo mese vengono tolti (gli altri mesi restano).`))) return;
    ed.grid.people.splice(+b.dataset.del, 1); delete ed.grid.cells[p.name]; setDirty(body); drawEditor(body);
  }; });
  $$('[data-up]', body).forEach(b => { b.onclick = () => { const i = +b.dataset.up; if (!i) return; const a = ed.grid.people; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setDirty(body); redrawGrid(body); }; });
}

function bindEditor(body) {
  bindGrid(body);
  $('#rPrev', body).onclick = () => rotaEditor(body, monthAdd(ed.ym, -1));
  $('#rNext', body).onclick = () => rotaEditor(body, monthAdd(ed.ym, 1));
  $('#rToday', body).onclick = () => rotaEditor(body, curYm());
  $('#rMonth', body).onchange = e => { if (/^\d{4}-\d{2}$/.test(e.target.value)) rotaEditor(body, e.target.value); };
  $('#rAdd', body).onclick = () => {
    const wid = $('#rWaiter', body).value, typed = $('#rName', body).value.trim();
    const w = wid ? ed.waiters.find(x => x.id === wid) : null, name = w ? w.name : typed;
    if (!name) { toast(L('Choose a waiter or write a name', 'Scegli un cameriere o scrivi un nome')); return; }
    if (ed.grid.people.some(p => p.name.toLowerCase() === name.toLowerCase())) { toast(L('Already in this month', 'Già presente in questo mese')); return; }
    const linked = w || ed.waiters.find(x => x.name.toLowerCase() === name.toLowerCase());
    ed.grid.people.push({ name, waiter_id: linked ? linked.id : null }); setDirty(body); drawEditor(body);
  };
  $('#rCopy', body).onclick = async () => {
    const has = Object.values(ed.grid.cells).some(c => Object.keys(c).length);
    if (has && !confirm(L('Replace this month with a copy of the previous month? (Nothing is saved until you tap Save.)', 'Sostituire questo mese con una copia del mese precedente? (Niente viene salvato finché non tocchi Salva.)'))) return;
    const prevYm = monthAdd(ed.ym, -1), prev = await loadMonth(prevYm);
    if (!prev.grid.people.length) { toast(L('The previous month is empty', 'Il mese precedente è vuoto')); return; }
    const n = daysIn(ed.ym), g = clone(prev.grid);
    for (const k of Object.keys(g.cells)) for (const d of Object.keys(g.cells[k])) if (+d > n) delete g.cells[k][d];
    ed.grid = { ...ed.grid, people: g.people, cells: g.cells }; setDirty(body); drawEditor(body);
    toast(L(`Copied from ${monthName(prevYm)}: check the days and tap Save`, `Copiato da ${monthName(prevYm)}: controlla i giorni e tocca Salva`), null, null, 5000);
  };
  $('#rPrint', body).onclick = () => printRota(ed.ym, ed.grid);
  $('#rSave', body).onclick = async e => {
    const btn = e.currentTarget, n = daysIn(ed.ym);
    const holes = Array.from({ length: n }, (_, i) => i + 1).filter(d => { const c = coverage(ed.grid, ed.ym, d); return ed.grid.people.length && (!c.M || !c.C || !c.P); });
    if (holes.length && !confirm(L(`Some days have no M, C or P (days ${holes.slice(0, 10).join(', ')}${holes.length > 10 ? '…' : ''}). Save anyway?`, `Alcuni giorni non hanno M, C o P (giorni ${holes.slice(0, 10).join(', ')}${holes.length > 10 ? '…' : ''}). Salvare lo stesso?`))) return;
    const people = ed.grid.people.map(p => ({ name: p.name, waiter_id: p.waiter_id || null }));
    const cells = []; for (const p of ed.grid.people) for (const [d, s] of Object.entries(ed.grid.cells[p.name] || {})) cells.push({ name: p.name, day: +d, shift: s });
    btn.disabled = true;
    try {
      const r = await saveRotaMonth(ed.ym, people, cells, ed.version);
      ed.version = r.version; ed.source = 'db'; ed.dirty = false; ed.grid.updatedAt = new Date().toISOString(); ed.grid.updatedBy = S.email;
      toast(L(`Schedule of ${monthName(ed.ym)} saved`, `Turni di ${monthName(ed.ym)} salvati`)); drawEditor(body);
    } catch (er) {
      btn.disabled = false;
      if (/another device|altro dispositivo|40001/i.test(er.message)) {
        toast(L('Someone else saved this month in the meantime. Reload it to see their version (your changes here are not saved).', 'Qualcun altro ha salvato questo mese nel frattempo. Ricaricalo per vedere la sua versione (le tue modifiche qui non sono salvate).'), L('Reload', 'Ricarica'), () => { ed.dirty = false; rotaEditor(body, ed.ym); }, 10000);
      } else toast(er.message, null, null, 6000);
    }
  };
}
export const rotaDirty = () => !!(ed && ed.dirty);

// ================= Waiters: the whole team, read only =================
export function rotaViewHtml(ym, me) {
  const g = gridFor(ym);
  return `<div class="rota-view"><div class="rota-vh"><b>${esc(monthName(ym))}</b></div>${g && g.people.length ? gridHtml(ym, g, { me }) : `<p class="empty-order">${L('No schedule for this month yet.', 'Nessun turno per questo mese.')}</p>`}</div>`;
}
export const thisAndNextMonth = () => [curYm(), monthAdd(curYm(), 1)];
