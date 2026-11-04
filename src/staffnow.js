// "Staff now": who is logged in (green dot, live) + who is on shift and who is next (from the schedule)
import { esc, hhmm } from './data.js';
import { S } from './store.js';
import { t } from './i18n.js';
import { turnInfo, myTurn } from './schedule.js';

const shiftTxt = x => `${esc(x.name)} <span class="muted">${x.from}–${x.to}</span>`;
const nextTxt = n => n ? `<b>${esc(n.name)}</b> <span class="muted">${n.from}${n.when === 'tomorrow' ? ' · ' + t('tomorrowW') : ''}</span>` : `<span class="muted">${t('noRota')}</span>`;

// owner dashboard panel
export function staffNowHtml() {
  const r = turnInfo(), p = S.presence || [];
  const active = r.active.length ? r.active.map(shiftTxt).join(' · ') : `<span class="muted">${r.known ? t('noShift') : t('noRota')}</span>`;
  const online = p.length ? p.map(x => `<span class="online"><i class="dot"></i>${esc(x.name)} <small>${t('activeLbl')} · ${t('sinceT', { t: hhmm(x.since) })}</small></span>`).join('')
    : `<span class="muted">${t('nobodyIn')}</span>`;
  return `<h3>${t('staffNow')}</h3>
    <div class="sn-row"><span class="sn-l">${t('inApp')}</span><span class="sn-v">${online}</span></div>
    <div class="sn-row"><span class="sn-l">${t('activeWaiter')}</span><span class="sn-v"><b>${active}</b></span></div>
    <div class="sn-row"><span class="sn-l">${t('nextTurn')}</span><span class="sn-v">${nextTxt(r.next)}</span></div>
    ${r.off.length ? `<div class="sn-row"><span class="sn-l">${t('offToday')}</span><span class="sn-v muted">${r.off.map(esc).join(', ')}</span></div>` : ''}`;
}

// one compact line for waiters (table map, PIN screen, More)
export function turnLine() {
  const r = turnInfo();
  const act = r.active.length ? r.active.map(x => esc(x.name)).join(' + ') : (r.known ? t('noShift') : '—');
  return `<span class="turnline">🕒 ${t('activeWaiter')}: <b>${act}</b> · ${t('nextTurn')}: ${r.next ? `<b>${esc(r.next.name)}</b> ${r.next.from}${r.next.when === 'tomorrow' ? ' (' + t('tomorrowW') + ')' : ''}` : '—'}</span>`;
}

// in the waiter's own account: his shift and who comes after him
export function myTurnHtml(name) {
  const r = myTurn(name);
  return `<div class="grp">${t('shifts')}</div>
    <p class="hint">${r.me ? `${t('yourShift')}: <b>${r.me.from}–${r.me.to}</b><br>` : ''}${t('activeWaiter')}: <b>${r.active.length ? r.active.map(x => esc(x.name) + ' ' + x.from + '–' + x.to).join(' · ') : t('noShift')}</b><br>
    ${r.me ? t('afterYou') : t('nextTurn')}: ${nextTxt(r.next)}</p>`;
}
