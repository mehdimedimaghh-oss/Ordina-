// Owner only: purchase cost per serving (VAT excluded), VAT rates, margins.
// The data lives in owner-only tables (item_costs, item_finance, finance_settings): waiters and reception cannot read it.
// Selling prices are only SHOWN here (read only): this page never changes the menu.
import { SECTIONS, SECTION, eur, esc, $, $$, today, addDays } from './data.js';
import { S, fetchFinance, saveCost, voidCost, setVat, fetchProfit } from './store.js';
import { toast, sheet, sheetBody, openSheet, closeSheet } from './ui.js';
import { getLang } from './i18n.js';

const L = (en, it) => (getLang() === 'it' ? it : en);
let F = null;                                   // { costs, finance, settings }
let filter = 'all', view = 'dishes', query = '';

// ---------- small helpers ----------
export const numIn = v => { const s = String(v ?? '').trim().replace(',', '.'); return s === '' ? null : (/^\d+(\.\d{1,4})?$/.test(s) ? Number(s) : NaN); };
const fmtD = d => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const pct = n => (n == null ? '—' : String(Math.round(n * 10) / 10).replace('.', ',') + '%');
export const eurC = n => { const v = Number(n); const s = Math.abs(v * 100 - Math.round(v * 100)) > 1e-6 ? v.toFixed(4).replace(/0+$/, '') : v.toFixed(2); return '€ ' + s.replace('.', ','); };
const inVal = n => (n == null ? '' : String(n).replace('.', ','));
const fcCls = p => (p == null ? '' : p < 30 ? 'ok' : p <= 40 ? 'warn' : 'out');
const notInstalled = e => /item_costs|owner_profit|finance_settings|owner_save_cost/.test(e?.message || '') && /does not exist|schema cache|not find|Could not find/i.test(e?.message || '');
const setupMsg = () => `<div class="panel"><h3>${L('Purchase costs are not installed yet', 'I costi di acquisto non sono ancora installati')}</h3>
  <p class="hint">${L('Run step 19 of SETUP.md in Supabase (SQL Editor → the file 20261127000000_purchase_costs.sql). Nothing else in the app changes.', 'Esegui il passo 19 di SETUP.md in Supabase (SQL Editor → il file 20261127000000_purchase_costs.sql). Il resto dell\'app non cambia.')}</p></div>`;
const secName = id => (id === 'servizio' ? L('Table & room service (coperto, room fee)', 'Coperto e servizio in camera') : id === 'cocktail' ? 'Cocktails' : SECTION[id] ? (getLang() === 'it' ? SECTION[id].it : SECTION[id].en) : id);

// sales VAT of a dish: its own rate → its section → default → unknown (null). Nothing is assumed.
export function salesVat(item, fin = F) {
  const f = fin.finance[item.id]; if (f?.sales_vat != null) return Number(f.sales_vat);
  const s = fin.settings.sales_vat_sections?.[item.section]; if (s != null) return Number(s);
  const d = fin.settings.sales_vat_default; return d == null ? null : Number(d);
}
const purchaseVat = item => { const v = F.finance[item.id]?.purchase_vat ?? F.settings.purchase_vat_default; return v == null ? null : Number(v); };
const activeCosts = id => F.costs.filter(c => c.item_id === id && !c.voided_at);      // newest date first
const costNow = id => activeCosts(id).find(c => c.valid_from <= today()) || null;
const dishes = () => S.menu.filter(m => m.id !== 'pinsa-base');
function perServing(m) {
  const c = costNow(m.id), v = salesVat(m);
  const net = v == null ? null : Number(m.price) / (1 + v / 100);
  return { c, v, net, margin: c && net != null ? net - Number(c.cost) : null, fc: c && net ? Number(c.cost) / net * 100 : null };
}

export function vatBanner(status) {
  return status?.confirmed
    ? `<div class="fin-band ok">✓ ${L('VAT rates confirmed', 'Aliquote IVA confermate')}: ${esc(status.note || '')}${status.at ? ' · ' + fmtD(status.at) : ''}</div>`
    : `<div class="fin-band prov"><b>⚠ ${L('PROVISIONAL', 'PROVVISORIO')}</b> · ${L('VAT rates not yet confirmed by the commercialista. These are estimates, not verified accounting profit.', 'Aliquote IVA non ancora confermate dal commercialista. Sono stime, non utili contabili verificati.')}</div>`;
}

// =====================================================================
//  COSTS TAB
// =====================================================================
export async function costsTab(body) {
  body.innerHTML = `<p class="hint">${L('Loading…', 'Caricamento…')}</p>`;
  try { F = await fetchFinance(); } catch (e) { body.innerHTML = notInstalled(e) ? setupMsg() : `<p class="err">${esc(e.message)}</p>`; return; }
  draw(body);
}

function draw(body) {
  const all = dishes(), withCost = all.filter(m => costNow(m.id)), missing = all.filter(m => !m.hidden && !costNow(m.id));
  const noRates = F.settings.sales_vat_default == null && !Object.keys(F.settings.sales_vat_sections || {}).length;
  const suppliers = [...new Set(F.costs.map(c => c.supplier).filter(Boolean))].sort();
  body.innerHTML = `${vatBanner(F.settings.vat_status)}
    <p class="hint">${L('One purchase cost per serving, <b>VAT excluded</b>, with the date it is valid from. Selling prices are only shown here: change them in “Menu & prices”. Every change is written in the audit log.',
      'Un costo di acquisto per porzione, <b>IVA esclusa</b>, con la data da cui vale. I prezzi di vendita qui sono solo mostrati: si cambiano in “Menu e prezzi”. Ogni modifica è scritta nel registro.')}</p>
    <div class="kpis fin-k"><div class="kpi"><small>${L('Dishes with a cost', 'Piatti con costo')}</small><b class="num">${withCost.length} / ${all.length}</b></div>
      <div class="kpi${missing.length ? ' warnk' : ''}"><small>${L('Missing cost (on the menu)', 'Costo mancante (nel menu)')}</small><b class="num">${missing.length}</b></div>
      <div class="kpi"><small>${L('Suppliers', 'Fornitori')}</small><b class="num">${suppliers.length}</b></div></div>
    ${vatPanel(noRates)}
    <div class="fin-tools">
      <div class="seg fin-seg">${[['dishes', L('Dishes', 'Piatti')], ['suppliers', L('Supplier price history', 'Storico prezzi fornitori')]].map(([k, l]) => `<button data-view="${k}" class="${view === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${view === 'dishes' ? `<div class="seg fin-seg3">${[['all', L('All', 'Tutti')], ['missing', L('Missing cost', 'Costo mancante')], ['with', L('With cost', 'Con costo')]].map(([k, l]) => `<button data-filter="${k}" class="${filter === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <input type="search" id="finQ" class="fin-q" placeholder="${L('Search a dish', 'Cerca un piatto')}" value="${esc(query)}">` : ''}
    </div>
    <div id="finList">${view === 'dishes' ? dishList() : supplierList()}</div>
    <datalist id="supList">${suppliers.map(s => `<option value="${esc(s)}">`).join('')}</datalist>`;
  $$('[data-view]', body).forEach(b => { b.onclick = () => { view = b.dataset.view; draw(body); }; });
  $$('[data-filter]', body).forEach(b => { b.onclick = () => { filter = b.dataset.filter; draw(body); }; });
  const qi = $('#finQ', body); if (qi) qi.oninput = () => { query = qi.value; $('#finList', body).innerHTML = dishList(); bindRows(body); };
  bindVat(body); bindRows(body);
}

function dishList() {
  const qq = query.trim().toLowerCase();
  let h = `<p class="hint fin-legend">${L('Food cost % = cost ÷ selling price without VAT.', 'Food cost % = costo ÷ prezzo di vendita senza IVA.')} <span class="fc ok">&lt; 30%</span> <span class="fc warn">30–40%</span> <span class="fc out">&gt; 40%</span></p>`;
  let any = false;
  for (const s of SECTIONS) {
    const rows = dishes().filter(m => m.section === s.id && (!qq || (m.name_it + ' ' + m.name_en).toLowerCase().includes(qq)))
      .filter(m => filter === 'all' || (filter === 'missing' ? !costNow(m.id) && !m.hidden : !!costNow(m.id)))
      .sort((a, b) => (a.hidden - b.hidden) || a.sort - b.sort);
    if (!rows.length) continue; any = true;
    h += `<div class="panel fin-sec"><h3>${esc(s.it)} · ${esc(s.en)}</h3>
      <div class="crow chead"><span>${L('Dish', 'Piatto')}</span><span>${L('Price (VAT incl.)', 'Prezzo (IVA incl.)')}</span><span>${L('Cost / serving', 'Costo / porzione')}</span><span>${L('Margin / serving', 'Margine / porzione')}</span><span>Food cost</span></div>
      ${rows.map(m => { const p = perServing(m); return `<button class="crow${m.hidden ? ' hid' : ''}" data-cost="${esc(m.id)}">
        <span class="cn">${esc(m.name_it)}${m.hidden ? ` <small class="tag">${L('hidden', 'nascosto')}</small>` : ''}${p.c?.supplier ? `<small>${esc(p.c.supplier)} · ${L('from', 'dal')} ${fmtD(p.c.valid_from)}</small>` : p.c ? `<small>${L('from', 'dal')} ${fmtD(p.c.valid_from)}</small>` : ''}</span>
        <span class="num">${eur(m.price)}</span>
        <span class="num">${p.c ? eurC(p.c.cost) : `<b class="miss">${L('missing', 'manca')}</b>`}</span>
        <span class="num">${p.margin != null ? eur(p.margin) : p.c && p.v == null ? `<small class="miss">${L('VAT rate?', 'Aliquota IVA?')}</small>` : '—'}</span>
        <span>${p.fc != null ? `<span class="fc ${fcCls(p.fc)}">${pct(p.fc)}</span>` : '—'}</span></button>`; }).join('')}</div>`;
  }
  return any ? h : `<p class="hint">${L('No dish matches.', 'Nessun piatto corrisponde.')}</p>`;
}

function supplierList() {
  if (!F.costs.length) return `<p class="hint">${L('No purchase cost saved yet.', 'Nessun costo di acquisto salvato.')}</p>`;
  const by = {};
  for (const c of F.costs) (by[c.supplier || ''] = by[c.supplier || ''] || []).push(c);
  const name = id => S.menu.find(m => m.id === id)?.name_it || id;
  return Object.keys(by).sort((a, b) => (!a) - (!b) || a.localeCompare(b)).map(sup => {
    const items = {}; for (const c of by[sup]) (items[c.item_id] = items[c.item_id] || []).push(c);
    return `<div class="panel fin-sec"><h3>${sup ? esc(sup) : L('No supplier written', 'Fornitore non indicato')}</h3>${Object.keys(items).sort((a, b) => name(a).localeCompare(name(b))).map(id => {
      const hist = items[id].slice().sort((a, b) => a.valid_from.localeCompare(b.valid_from) || a.id - b.id);
      let prev = null;
      return `<button class="sup-row" data-cost="${esc(id)}"><b>${esc(name(id))}</b><span class="hist">${hist.map(c => {
        const ch = !c.voided_at && prev ? (Number(c.cost) - prev) / prev * 100 : null; if (!c.voided_at) prev = Number(c.cost);
        return `<span class="hp${c.voided_at ? ' void' : ''}" title="${c.voided_at ? esc(L('Cancelled: ', 'Annullato: ') + (c.void_reason || '')) : ''}">${eurC(c.cost)} <small>${fmtD(c.valid_from)}${c.invoice_ref ? ' · ' + esc(c.invoice_ref) : ''}</small>${ch != null && isFinite(ch) && Math.abs(ch) > 0.05 ? `<i class="${ch > 0 ? 'up' : 'down'}">${ch > 0 ? '+' : ''}${pct(ch)}</i>` : ''}</span>`;
      }).join('<span class="arr">→</span>')}</span></button>`;
    }).join('')}</div>`;
  }).join('');
}

function bindRows(body) { $$('[data-cost]', body).forEach(b => { b.onclick = () => openDish(b.dataset.cost, body); }); }

// ---------- VAT settings ----------
function vatPanel(open) {
  const st = F.settings, secs = st.sales_vat_sections || {};
  const inp = (attrs, v) => `<input type="text" inputmode="decimal" autocomplete="off" ${attrs} value="${inVal(v)}" placeholder="—">`;
  return `<details class="panel fin-vat" ${open ? 'open' : ''}><summary><b>${L('VAT rates', 'Aliquote IVA')}</b> <small>${L('(sales and purchase)', '(vendita e acquisto)')}</small></summary>
    <p class="hint">${L('No rate is filled in for you. Write the rates your commercialista gives you. A dish can also have its own rate (open the dish). Until you tick “confirmed”, every margin is marked PROVISIONAL. Changing a rate removes the “confirmed” mark.',
      'Nessuna aliquota è inserita al posto tuo. Scrivi quelle indicate dal commercialista. Un piatto può avere anche una sua aliquota (apri il piatto). Finché non spunti “confermate”, ogni margine è PROVVISORIO. Cambiare un\'aliquota toglie la conferma.')}</p>
    <div class="vat-grid"><label>${L('Sales VAT % · default', 'IVA vendita % · predefinita')}${inp('id="vDef"', st.sales_vat_default)}</label>
      <label>${L('Purchase VAT % · default (only to convert invoice prices)', 'IVA acquisto % · predefinita (solo per convertire i prezzi in fattura)')}${inp('id="vPur"', st.purchase_vat_default)}</label></div>
    <h4>${L('Sales VAT % per section (empty = default)', 'IVA vendita % per sezione (vuoto = predefinita)')}</h4>
    <div class="vat-grid">${[...SECTIONS.map(s => s.id), 'servizio'].map(id => `<label>${esc(secName(id))}${inp(`data-vsec="${id}"`, secs[id])}</label>`).join('')}</div>
    <label class="tog vat-conf"><input type="checkbox" id="vConf" ${st.vat_status?.confirmed ? 'checked' : ''}> ${L('These rates are confirmed by the commercialista', 'Queste aliquote sono confermate dal commercialista')}</label>
    <label class="field">${L('Who confirmed them and when', 'Chi le ha confermate e quando')}<input type="text" id="vNote" maxlength="300" value="${esc(st.vat_status?.note || '')}" placeholder="${L('e.g. Studio Rossi, email of 02/12/2026', 'es. Studio Rossi, email del 02/12/2026')}"></label>
    <button class="btn primary" id="vSave">${L('Save VAT rates', 'Salva aliquote IVA')}</button></details>`;
}
function bindVat(body) {
  const b = $('#vSave', body); if (!b) return;
  b.onclick = async () => {
    const d = numIn($('#vDef', body).value), pu = numIn($('#vPur', body).value), secs = {};
    const bad = x => x != null && (isNaN(x) || x > 100);
    if (bad(d) || bad(pu)) { toast(L('Write rates like 10 or 22', 'Scrivi aliquote come 10 o 22')); return; }
    for (const i of $$('[data-vsec]', body)) { const v = numIn(i.value); if (bad(v)) { toast(L('Write rates like 10 or 22', 'Scrivi aliquote come 10 o 22')); i.focus(); return; } if (v != null) secs[i.dataset.vsec] = v; }
    const conf = $('#vConf', body).checked, note = $('#vNote', body).value.trim();
    if (conf && note.length < 3) { toast(L('Write who confirmed the rates and when', 'Scrivi chi ha confermato le aliquote e quando')); $('#vNote', body).focus(); return; }
    b.disabled = true;
    try { await setVat({ sales_default: d, purchase_default: pu, sales_sections: secs, confirmed: conf, note }); F = await fetchFinance(); toast(L('VAT rates saved', 'Aliquote IVA salvate')); draw(body); }
    catch (e) { toast(e.message); b.disabled = false; }
  };
}

// ---------- one dish: add / correct a cost, its VAT, its history ----------
function openDish(id, body, correct = null) {
  const m = S.menu.find(x => x.id === id); if (!m) return;
  const s = sheet('costSheet', m.name_it), el = sheetBody(s), fin = F.finance[id] || {};
  const p = perServing(m), hist = F.costs.filter(c => c.item_id === id);
  const glassMode = correct ? correct.glasses != null : fin.glasses_per_bottle != null;
  const pv = purchaseVat(m);
  el.innerHTML = `<div class="fin-dish">
    <div class="kpis fin-k"><div class="kpi"><small>${L('Selling price (VAT incl.)', 'Prezzo di vendita (IVA incl.)')}</small><b class="num">${eur(m.price)}</b></div>
      <div class="kpi"><small>${L('Sales VAT', 'IVA vendita')}</small><b class="num">${p.v == null ? '—' : pct(p.v)}</b></div>
      <div class="kpi"><small>${L('Cost today', 'Costo oggi')}</small><b class="num">${p.c ? eurC(p.c.cost) : '—'}</b></div>
      <div class="kpi"><small>Food cost</small><b class="num">${p.fc != null ? `<span class="fc ${fcCls(p.fc)}">${pct(p.fc)}</span>` : '—'}</b></div></div>
    <form class="panel fin-form" id="cForm" novalidate>
      <h3>${correct ? L(`Correct the cost valid from ${fmtD(correct.valid_from)}`, `Correggi il costo valido dal ${fmtD(correct.valid_from)}`) : L('New purchase cost', 'Nuovo costo di acquisto')}</h3>
      ${correct ? `<p class="hint">${L('The old cost stays in the history, marked as corrected, with your reason.', 'Il vecchio costo resta nello storico, segnato come corretto, con il tuo motivo.')}</p>` : ''}
      <div class="vat-grid"><label class="field">${L('Supplier invoice date', 'Data fattura fornitore')}<input type="date" id="cInv" value="${correct ? correct.invoice_date || '' : today()}"></label>
        <label class="field">${L('Valid from (sales from this day)', 'Valido dal (vendite da questo giorno)')}<input type="date" id="cFrom" value="${correct ? correct.valid_from : today()}"></label>
        <label class="field">${L('Supplier', 'Fornitore')}<input type="text" id="cSup" list="supList" maxlength="80" value="${esc(correct?.supplier || costNow(id)?.supplier || '')}"></label>
        <label class="field">${L('Invoice number', 'Numero fattura')}<input type="text" id="cRef" maxlength="60" value="${esc(correct?.invoice_ref || '')}"></label></div>
      <div class="seg fin-seg" role="tablist"><button type="button" data-cm="serv" class="${glassMode ? '' : 'on'}">${L('Cost per serving', 'Costo a porzione')}</button><button type="button" data-cm="glass" class="${glassMode ? 'on' : ''}">${L('Bottle ÷ glasses', 'Bottiglia ÷ calici')}</button></div>
      <div id="cmServ" ${glassMode ? 'hidden' : ''}><label class="field">${L('Cost per serving · VAT EXCLUDED', 'Costo a porzione · IVA ESCLUSA')}<input type="text" inputmode="decimal" id="cCost" autocomplete="off" value="${correct && correct.glasses == null ? inVal(Number(correct.cost)) : ''}" placeholder="3,20"></label>
        <details class="fin-help"><summary>${L('I only have the price with VAT', 'Ho solo il prezzo con IVA')}</summary><div class="vat-grid">
          <label class="field">${L('Price with VAT', 'Prezzo con IVA')}<input type="text" inputmode="decimal" id="cGross" autocomplete="off"></label>
          <label class="field">${L('Purchase VAT %', 'IVA acquisto %')}<input type="text" inputmode="decimal" id="cPv" autocomplete="off" value="${inVal(pv)}" placeholder="—"></label></div>
          <button type="button" class="btn" id="cConv">${L('Calculate the price without VAT', 'Calcola il prezzo senza IVA')}</button></details></div>
      <div id="cmGlass" ${glassMode ? '' : 'hidden'}><div class="vat-grid">
        <label class="field">${L('Bottle cost · VAT EXCLUDED', 'Costo bottiglia · IVA ESCLUSA')}<input type="text" inputmode="decimal" id="cBottle" autocomplete="off" value="${correct?.bottle_cost != null ? inVal(Number(correct.bottle_cost)) : ''}"></label>
        <label class="field">${L('Glasses from this bottle', 'Calici da questa bottiglia')}<input type="text" inputmode="numeric" id="cGl" autocomplete="off" value="${correct?.glasses ?? fin.glasses_per_bottle ?? ''}" placeholder="—"></label></div>
        <p class="hint" id="cGlOut">${L('Write the bottle cost and how many glasses you pour from it.', 'Scrivi il costo della bottiglia e quanti calici ne versi.')}</p></div>
      <label class="field">${L('Note (optional)', 'Nota (facoltativa)')}<input type="text" id="cNote" maxlength="300" value="${esc(correct?.note || '')}"></label>
      ${correct ? `<label class="field">${L('Why do you correct it? (required)', 'Perché lo correggi? (obbligatorio)')}<input type="text" id="cWhy" maxlength="300"></label>` : ''}
      <div class="actions" style="grid-template-columns:${correct ? '1fr 2fr' : '1fr'}">${correct ? `<button type="button" class="btn" id="cCancelCorr">${L('Back', 'Indietro')}</button>` : ''}<button class="btn primary" id="cSave">${correct ? L('Save the correction', 'Salva la correzione') : L('Save the cost', 'Salva il costo')}</button></div>
    </form>
    <details class="panel fin-vat"><summary><b>${L('VAT for this dish', 'IVA di questo piatto')}</b> <small>${L('(only if different from its section)', '(solo se diversa dalla sua sezione)')}</small></summary>
      <div class="vat-grid"><label class="field">${L('Sales VAT %', 'IVA vendita %')}<input type="text" inputmode="decimal" id="dSv" value="${inVal(fin.sales_vat)}" placeholder="—"></label>
        <label class="field">${L('Purchase VAT %', 'IVA acquisto %')}<input type="text" inputmode="decimal" id="dPv" value="${inVal(fin.purchase_vat)}" placeholder="—"></label></div>
      <button class="btn" id="dVat">${L('Save VAT for this dish', 'Salva IVA del piatto')}</button></details>
    <div class="panel"><h3>${L('Cost history', 'Storico costi')}</h3>${hist.length ? `<div class="hist-t">${hist.map(c => `<div class="hrow${c.voided_at ? ' void' : ''}">
        <div><b class="num">${eurC(c.cost)}</b> ${L('from', 'dal')} <b>${fmtD(c.valid_from)}</b>${c.glasses ? ` <small>(${eurC(c.bottle_cost)} ÷ ${c.glasses} ${L('glasses', 'calici')})</small>` : ''}
          <small>${[c.supplier, c.invoice_date ? L('invoice ', 'fattura ') + fmtD(c.invoice_date) : '', c.invoice_ref, c.note].filter(Boolean).map(esc).join(' · ')}</small>
          <small class="muted">${L('saved', 'salvato')} ${fmtD(c.created_at)} · ${esc(c.created_by || '')}</small>
          ${c.voided_at ? `<small class="miss">${c.replaced_by ? L('Corrected', 'Corretto') : L('Cancelled', 'Annullato')} ${fmtD(c.voided_at)} · ${esc(c.voided_by || '')}: ${esc(c.void_reason || '')}</small>` : ''}</div>
        ${c.voided_at ? '' : `<div class="hbtns"><button class="btn" data-corr="${c.id}">${L('Correct', 'Correggi')}</button><button class="btn" data-void="${c.id}">${L('Cancel', 'Annulla')}</button></div>`}</div>`).join('')}</div>`
      : `<p class="hint">${L('No cost yet.', 'Ancora nessun costo.')}</p>`}</div></div>`;
  s.querySelector('.sheet')?.classList.add('wide');
  openSheet(s);

  // the "valid from" date follows the invoice date until it is changed by hand
  let fromTouched = !!correct;
  $('#cFrom', el).oninput = () => { fromTouched = true; };
  $('#cInv', el).oninput = () => { if (!fromTouched && $('#cInv', el).value) $('#cFrom', el).value = $('#cInv', el).value; };
  let mode = glassMode ? 'glass' : 'serv';
  $$('[data-cm]', el).forEach(b => { b.onclick = () => { mode = b.dataset.cm; $$('[data-cm]', el).forEach(x => x.classList.toggle('on', x === b)); $('#cmServ', el).hidden = mode !== 'serv'; $('#cmGlass', el).hidden = mode !== 'glass'; }; });
  const glOut = () => { const bc = numIn($('#cBottle', el).value), g = parseInt($('#cGl', el).value, 10);
    $('#cGlOut', el).innerHTML = bc != null && !isNaN(bc) && g >= 1 && g <= 100 ? `${L('Cost per glass', 'Costo a calice')}: <b>${eurC(Math.round(bc / g * 10000) / 10000)}</b> (${eurC(bc)} ÷ ${g})` : L('Write the bottle cost and how many glasses you pour from it.', 'Scrivi il costo della bottiglia e quanti calici ne versi.'); };
  $('#cBottle', el).oninput = glOut; $('#cGl', el).oninput = glOut; glOut();
  $('#cConv', el).onclick = () => {
    const g = numIn($('#cGross', el).value), r = numIn($('#cPv', el).value);
    if (g == null || isNaN(g) || r == null || isNaN(r) || r > 100) { toast(L('Write the price with VAT and the purchase VAT %', 'Scrivi il prezzo con IVA e l\'IVA di acquisto %')); return; }
    $('#cCost', el).value = inVal(Math.round(g / (1 + r / 100) * 10000) / 10000); toast(L('Price without VAT calculated: check it, then save', 'Prezzo senza IVA calcolato: controllalo, poi salva'));
  };
  if (correct) $('#cCancelCorr', el).onclick = () => openDish(id, body);
  $('#cForm', el).onsubmit = async e => {
    e.preventDefault();
    const from = $('#cFrom', el).value || $('#cInv', el).value;
    const p = { item_id: id, invoice_date: $('#cInv', el).value || null, valid_from: from || null, supplier: $('#cSup', el).value.trim(), invoice_ref: $('#cRef', el).value.trim(), note: $('#cNote', el).value.trim() };
    if (!from) { toast(L('Write the invoice date or the date the cost is valid from', 'Scrivi la data della fattura o la data da cui vale il costo')); return; }
    if (mode === 'glass') {
      const bc = numIn($('#cBottle', el).value), g = parseInt($('#cGl', el).value, 10);
      if (bc == null || isNaN(bc)) { toast(L('Write the bottle cost, VAT excluded', 'Scrivi il costo della bottiglia, IVA esclusa')); return; }
      if (!(g >= 1 && g <= 100) || String(g) !== $('#cGl', el).value.trim()) { toast(L('Write how many glasses this bottle gives', 'Scrivi quanti calici dà questa bottiglia')); return; }
      Object.assign(p, { bottle_cost: bc, glasses: g });
    } else {
      const c = numIn($('#cCost', el).value);
      if (c == null || isNaN(c)) { toast(L('Write a cost like 3,20 (VAT excluded)', 'Scrivi un costo come 3,20 (IVA esclusa)')); return; }
      p.cost = c;
    }
    if (correct) { const why = $('#cWhy', el).value.trim(); if (why.length < 3) { toast(L('Write why you correct this cost', 'Scrivi perché correggi questo costo')); $('#cWhy', el).focus(); return; } p.replaces = correct.id; p.reason = why; }
    if (from < today() && !confirm(L(`This cost will be used for the sales of ${m.name_it} from ${fmtD(from)} (until the next cost). Margins of those days will change. Continue?`,
      `Questo costo sarà usato per le vendite di ${m.name_it} dal ${fmtD(from)} (fino al costo successivo). I margini di quei giorni cambieranno. Continuare?`))) return;
    const btn = $('#cSave', el); btn.disabled = true;
    try {
      const r = await saveCost(p); F = await fetchFinance();
      toast(L(`Saved: ${eurC(r.cost)} from ${fmtD(r.valid_from)}${r.sold_affected ? ` · ${r.sold_affected} servings already sold use it` : ''}`, `Salvato: ${eurC(r.cost)} dal ${fmtD(r.valid_from)}${r.sold_affected ? ` · ${r.sold_affected} porzioni già vendute lo usano` : ''}`), null, null, 4000);
      draw(body); openDish(id, body);
    } catch (err) { toast(err.message, null, null, 5000); btn.disabled = false; }
  };
  $('#dVat', el).onclick = async () => {
    const sv = numIn($('#dSv', el).value), pv2 = numIn($('#dPv', el).value);
    if ([sv, pv2].some(x => x != null && (isNaN(x) || x > 100))) { toast(L('Write rates like 10 or 22', 'Scrivi aliquote come 10 o 22')); return; }
    if (F.settings.vat_status?.confirmed && !confirm(L('Changing a VAT rate removes the “confirmed by the commercialista” mark. Continue?', 'Cambiare un\'aliquota toglie la conferma del commercialista. Continuare?'))) return;
    try { await setVat({ items: { [id]: { sales_vat: sv, purchase_vat: pv2 } } }); F = await fetchFinance(); toast(L('VAT of this dish saved', 'IVA del piatto salvata')); draw(body); openDish(id, body); }
    catch (err) { toast(err.message); }
  };
  $$('[data-corr]', el).forEach(b => { b.onclick = () => openDish(id, body, F.costs.find(c => c.id === +b.dataset.corr)); });
  $$('[data-void]', el).forEach(b => { b.onclick = async () => {
    const why = prompt(L('Why do you cancel this cost? It stays in the history.', 'Perché annulli questo costo? Resta nello storico.'));
    if (why == null) return; if (why.trim().length < 3) { toast(L('Write a reason (at least 3 letters)', 'Scrivi un motivo (almeno 3 lettere)')); return; }
    try { await voidCost(+b.dataset.void, why.trim()); F = await fetchFinance(); toast(L('Cost cancelled (kept in the history)', 'Costo annullato (resta nello storico)')); draw(body); openDish(id, body); }
    catch (err) { toast(err.message); }
  }; });
}
export const closeCostSheet = () => { const s = document.getElementById('costSheet'); if (s && !s.hidden) closeSheet(s); };

// =====================================================================
//  DASHBOARD: margins of the period the owner is looking at
// =====================================================================
export async function marginPanel(el, rg, goCosts) {
  el.innerHTML = `<div class="panel"><h3>${L('Margins', 'Margini')}</h3><p class="hint">${L('Calculating…', 'Calcolo…')}</p></div>`;
  let p;
  try { p = await fetchProfit(rg[0], rg[1]); }
  catch (e) { el.innerHTML = notInstalled(e) ? '' : `<div class="panel"><h3>${L('Margins', 'Margini')}</h3><p class="err">${esc(e.message)}</p></div>`; return null; }
  if (!el.isConnected) return p;
  const t = p.totals, items = p.items.filter(i => i.known_qty > 0);
  const best = items.slice().sort((a, b) => b.margin - a.margin).slice(0, 5);
  const worst = items.filter(i => i.food_cost_pct != null).sort((a, b) => b.food_cost_pct - a.food_cost_pct).slice(0, 5);
  const missing = p.items.filter(i => i.qty_no_cost > 0 && i.section).sort((a, b) => b.gross_no_cost - a.gross_no_cost);
  const row = (i, v) => `<div class="mg-r"><span class="nm2">${esc(i.name)}</span><span class="num">${v}</span></div>`;
  const svcGross = Number(p.service.cover) + Number(p.service.room_fee);
  el.innerHTML = `<div class="panel fin-dash"><div class="tools" style="justify-content:space-between"><h3 style="margin:0">${L('Margins', 'Margini')}</h3>${goCosts ? `<button class="linkbtn" id="mgGo">${L('Purchase costs →', 'Costi di acquisto →')}</button>` : ''}</div>
    ${vatBanner(p.vat_status)}
    ${!p.items.length ? `<p class="hint">${L('No dishes sold in this period.', 'Nessun piatto venduto in questo periodo.')}</p>` : `
    <div class="kpis"><div class="kpi"><small>${L('Revenue counted (VAT excl.)', 'Ricavo calcolato (IVA escl.)')}</small><b class="num">${eur(t.known_net)}</b></div>
      <div class="kpi"><small>${L('Purchase cost', 'Costo di acquisto')}</small><b class="num">${eur(t.cost)}</b></div>
      <div class="kpi main"><small>${L('Gross margin', 'Margine lordo')}${p.provisional ? ' · ' + L('provisional', 'provvisorio') : ''}</small><b class="num">${eur(t.margin)}</b></div>
      <div class="kpi"><small>Food cost %</small><b class="num">${t.food_cost_pct != null ? `<span class="fc ${fcCls(t.food_cost_pct)}">${pct(t.food_cost_pct)}</span>` : '—'}</b></div>
      <div class="kpi" title="${L('Share of dish sales (VAT incl.) that has both a cost and a VAT rate', 'Quota delle vendite di piatti (IVA incl.) con costo e aliquota IVA')}"><small>${L('Calculated on', 'Calcolato su')}</small><b class="num">${pct(t.coverage_pct ?? 0)}</b></div></div>
    ${t.items_no_cost ? `<div class="rcp-warn fin-miss">⚠ ${L(`${t.items_no_cost} dishes sold without a purchase cost: ${eur(t.gross_no_cost)} of sales not in the margin.`, `${t.items_no_cost} piatti venduti senza costo di acquisto: ${eur(t.gross_no_cost)} di vendite fuori dal margine.`)}
      <small>${missing.slice(0, 8).map(i => `${esc(i.name)} (${i.qty_no_cost}×)`).join(' · ')}${missing.length > 8 ? ' …' : ''}</small></div>` : ''}
    ${t.items_no_vat ? `<div class="rcp-warn fin-miss">⚠ ${L(`${t.items_no_vat} dishes have no sales VAT rate: ${eur(t.gross_no_vat)} of sales not in the margin. Write the rates in Costs → VAT rates.`, `${t.items_no_vat} piatti senza aliquota IVA di vendita: ${eur(t.gross_no_vat)} di vendite fuori dal margine. Scrivi le aliquote in Costi → Aliquote IVA.`)}</div>` : ''}
    <div class="two"><div><h4>${L('Best margin (€)', 'Margine migliore (€)')}</h4>${best.map(i => row(i, `${eur(i.margin)} <small>${i.known_qty}× · ${pct(i.food_cost_pct)}</small>`)).join('') || '<p class="hint">—</p>'}</div>
      <div><h4>${L('Worst margin (highest food cost %)', 'Margine peggiore (food cost % più alto)')}</h4>${worst.map(i => row(i, `<span class="fc ${fcCls(i.food_cost_pct)}">${pct(i.food_cost_pct)}</span> <small>${eurC(i.unit_cost)} ${L('each', 'cad.')} · ${i.known_qty}×</small>`)).join('') || '<p class="hint">—</p>'}</div></div>
    <h4>${L('Per section', 'Per sezione')}</h4><div class="mg-tab"><div class="mg-h"><span>${L('Section', 'Sezione')}</span><span>${L('Sales (VAT incl.)', 'Vendite (IVA incl.)')}</span><span>${L('Cost', 'Costo')}</span><span>${L('Margin', 'Margine')}</span><span>FC %</span></div>
      ${p.sections.map(s => `<div class="mg-l"><span>${esc(secName(s.section))}${Number(s.gross_unknown) > 0 ? ` <small class="miss">(${eur(s.gross_unknown)} ${L('not counted', 'non calcolati')})</small>` : ''}</span><span class="num">${eur(s.gross)}</span><span class="num">${s.cost != null ? eur(s.cost) : '—'}</span><span class="num">${s.margin != null ? eur(s.margin) : '—'}</span><span>${s.food_cost_pct != null ? `<span class="fc ${fcCls(s.food_cost_pct)}">${pct(s.food_cost_pct)}</span>` : '—'}</span></div>`).join('')}</div>
    ${svcGross ? `<p class="hint" style="margin-top:10px">${L('Table service and room-service fee', 'Coperto e servizio in camera')}: <b>${eur(svcGross)}</b> ${L('(VAT incl., no purchase cost, not in the food cost)', '(IVA incl., senza costo di acquisto, fuori dal food cost)')}${p.service.net != null ? ` · ${L('VAT excl.', 'IVA escl.')} ${eur(p.service.net)}` : ''}</p>` : ''}`}</div>`;
  if (goCosts) { const g = $('#mgGo', el); if (g) g.onclick = goCosts; }
  return p;
}

// =====================================================================
//  EXCEL: "Margini" worksheet
// =====================================================================
export function marginSheet(p) {
  const it = getLang() === 'it';
  const rows = [[it ? 'Margini' : 'Margins', `${fmtD(p.from)} – ${fmtD(p.to)}`],
    [p.provisional ? (it ? 'PROVVISORIO: aliquote IVA non confermate dal commercialista. Stime, non utili contabili verificati.' : 'PROVISIONAL: VAT rates not confirmed by the commercialista. Estimates, not verified accounting profit.')
      : (it ? 'Aliquote IVA confermate: ' : 'VAT rates confirmed: ') + (p.vat_status?.note || '')],
    [it ? 'Costi di acquisto IVA esclusa. Ogni vendita usa il costo valido nel suo giorno. Righe senza costo o senza aliquota: non incluse nel margine.' : 'Purchase costs VAT excluded. Each sale uses the cost valid on its day. Lines without cost or VAT rate are not in the margin.'], [],
    it ? ['Piatto', 'Sezione', 'Qtà venduta', 'Vendite IVA incl. €', 'IVA vendita %', 'Qtà con costo', 'Ricavo IVA escl. €', 'Costo a porzione (media) €', 'Costo totale €', 'Margine lordo €', 'Food cost %', 'Qtà senza costo', 'Vendite senza costo €', 'Avviso']
       : ['Dish', 'Section', 'Qty sold', 'Sales VAT incl. €', 'Sales VAT %', 'Qty with cost', 'Revenue VAT excl. €', 'Cost per serving (avg) €', 'Total cost €', 'Gross margin €', 'Food cost %', 'Qty without cost', 'Sales without cost €', 'Warning']];
  const n = v => (v == null ? '' : Number(v));
  while (rows[0].length < rows[4].length) rows[0].push('');   // column widths come from the first row
  for (const i of p.items) {
    const warn = [i.qty_no_cost > 0 ? (it ? 'costo mancante' : 'cost missing') : '', i.qty_no_vat > 0 ? (it ? 'aliquota IVA mancante' : 'VAT rate missing') : ''].filter(Boolean).join(', ');
    rows.push([i.name, secName(i.section), i.qty, n(i.gross), i.vat_min == null ? '' : i.vat_min === i.vat_max ? Number(i.vat_min) : `${i.vat_min}–${i.vat_max}`, i.known_qty, n(i.known_net), n(i.unit_cost), n(i.cost), n(i.margin), n(i.food_cost_pct), i.qty_no_cost, n(i.gross_no_cost), warn]);
  }
  rows.push([], [it ? 'Per sezione' : 'Per section'], it ? ['Sezione', 'Vendite IVA incl. €', 'Costo €', 'Margine lordo €', 'Food cost %', 'Vendite fuori dal margine €'] : ['Section', 'Sales VAT incl. €', 'Cost €', 'Gross margin €', 'Food cost %', 'Sales not in the margin €']);
  for (const s of p.sections) rows.push([secName(s.section), n(s.gross), n(s.cost), n(s.margin), n(s.food_cost_pct), n(s.gross_unknown)]);
  const t = p.totals;
  rows.push([], [it ? 'Totali' : 'Totals'],
    [it ? 'Incasso totale (come Dashboard) €' : 'Total takings (as Dashboard) €', n(t.revenue_gross)],
    [it ? 'Coperto + servizio in camera (IVA incl.) €' : 'Table service + room fee (VAT incl.) €', Number(p.service.cover) + Number(p.service.room_fee)],
    [it ? 'Ricavo calcolato IVA escl. €' : 'Revenue counted VAT excl. €', n(t.known_net)], [it ? 'Costo di acquisto €' : 'Purchase cost €', n(t.cost)],
    [it ? 'Margine lordo €' : 'Gross margin €', n(t.margin)], ['Food cost %', n(t.food_cost_pct)],
    [it ? 'Calcolato su % delle vendite' : 'Calculated on % of sales', n(t.coverage_pct)],
    [it ? 'Vendite senza costo €' : 'Sales without cost €', n(t.gross_no_cost)], [it ? 'Vendite senza aliquota IVA €' : 'Sales without VAT rate €', n(t.gross_no_vat)]);
  return { name: it ? 'Margini' : 'Margins', rows };
}
// backup: everything about costs, for safekeeping (owner download)
export async function financeBackup() { try { return await fetchFinance(); } catch { return null; } }
export const lastDays = n => [addDays(today(), -n + 1), today()];
