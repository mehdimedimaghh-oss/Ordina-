import { $, $$, esc, eur, hhmm, roomLabel, dayKey } from './data.js';
import { t } from './i18n.js';

// ---------- toast (with optional action like Undo) ----------
let tt;
export function toast(msg, action, fn, time) {
  let el = $('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { el.hidden = true; fn(); };
  el.hidden = false; clearTimeout(tt);
  tt = setTimeout(() => { el.hidden = true; }, time || (action ? 4500 : 1800));
}

// ---------- bottom sheets ----------
export function sheet(id, title) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div'); el.className = 'scrim'; el.id = id; el.hidden = true;
    el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="${id}-t"><div class="grab"></div>
      <div class="sh-head"><h3 id="${id}-t"></h3><button class="x" data-close aria-label="${t('close')}">×</button></div><div class="sh-body"></div></div>`;
    el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-close]')) closeSheet(el); });
    document.body.appendChild(el);
  }
  if (title != null) el.querySelector('h3').textContent = title;
  return el;
}
export const sheetBody = el => el.querySelector('.sh-body');
export function openSheet(el) { el.hidden = false; document.body.style.overflow = 'hidden'; }
export function closeSheet(el) { el.hidden = true; if (!$$('.scrim').some(s => !s.hidden)) document.body.style.overflow = ''; }
addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const r = $('.recv'); if (r) { r.remove(); return; }
  $$('.scrim').forEach(s => { if (!s.hidden) closeSheet(s); });
});

// "Tap again" safety for dangerous buttons
export function armed(btn, label, onGo) {
  let t = null; const orig = btn.textContent;
  btn.onclick = () => {
    if (!t) { btn.classList.add('armed'); btn.textContent = label; t = setTimeout(() => { t = null; btn.classList.remove('armed'); btn.textContent = orig; }, 3000); return; }
    clearTimeout(t); t = null; onGo();
  };
}

export async function copyText(txt, fallbackBox) {
  try { await navigator.clipboard.writeText(txt); return true; } catch {
    if (fallbackBox) { fallbackBox.innerHTML = '<textarea class="copybox" readonly></textarea>'; const ta = fallbackBox.firstChild; ta.value = txt; ta.focus(); ta.select(); toast(t('selectCopy')); }
    return false;
  }
}

// An order in one common shape: {table, client, roomNo, building, waiter, items:[{it,qty,p,note,sec}], roomService, roomFee, note, total, closedAt}
export function ticketText(o) {
  let out = `TAVOLO ${o.table}\n`;
  const w = [o.client, roomLabel(o) ? 'Camera ' + roomLabel(o) : ''].filter(Boolean).join(' · ');
  if (w) out += w + '\n';
  if (o.waiter) out += `Cameriere: ${o.waiter}\n`;
  let sec = null;
  for (const l of o.items) {
    if (l.sec !== sec) { sec = l.sec; out += `\n${String(sec || '').toUpperCase()}\n`; }
    out += `${l.qty}x ${l.it}${l.note ? ` — ${l.note}` : ''}\n`;
  }
  if (o.roomService) out += `\nServizio in camera ${eur(o.roomFee ?? 10)}\n`;
  if (o.note) out += `\nNOTE: ${o.note}\n`;
  return out + `\nTOTALE ${eur(o.total)}`;
}

// Big full-screen view to show the receptionist
export function receptionView(o) {
  $('.recv')?.remove();
  const el = document.createElement('div'); el.className = 'recv'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Reception view');
  el.innerHTML = `<div class="in">
    <div class="top"><div><div class="lbl">${t('receptionTable')}</div><h2>${esc(o.table)}</h2></div><button class="x" aria-label="${t('close')}">×</button></div>
    ${o.client ? `<div class="who">${esc(o.client)}</div>` : ''}
    ${roomLabel(o) ? `<div class="room">Camera ${esc(roomLabel(o))}</div>` : ''}
    <ul>${o.items.map(l => `<li><b>${l.qty}×</b><span>${esc(l.it)}${l.note ? `<i>${esc(l.note)}</i>` : ''}</span><span class="num">${eur(l.qty * l.p)}</span></li>`).join('')}
    ${o.roomService ? `<li><b>+</b><span>Servizio in camera · Room service</span><span class="num">${eur(o.roomFee ?? 10)}</span></li>` : ''}</ul>
    ${o.note ? `<div class="note">Note: ${esc(o.note)}</div>` : ''}
    <div class="grand"><span>Totale</span><b class="num">${eur(o.total)}</b></div>
    <div class="pay">Da pagare alla reception · To pay at reception</div>
    <div class="meta">${o.waiter ? t('waiterLbl') + ': ' + esc(o.waiter) + ' · ' : ''}${o.closedAt ? dayKey(o.closedAt).split('-').reverse().join('/') + ' ' + hhmm(o.closedAt) : t('notSentShort')}</div>
  </div>`;
  el.querySelector('.x').onclick = () => el.remove();
  document.body.appendChild(el);
}

export function buzz() { try { navigator.vibrate && navigator.vibrate(12); } catch { /* ignore */ } }
