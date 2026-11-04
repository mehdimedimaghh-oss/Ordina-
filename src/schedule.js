// Staff schedule (turni). Each month: one code per day for each shift, from the owner's planning sheet.
// To add a new month: copy the block, change the key ('2026-12') and the 4 lines. Codes → names below.
import { addDays, dayKey } from './data.js';

export const STAFF = { MED: 'Mehdi', ZAI: 'Zai', GAB: 'Gabri', NIK: 'Nikola', CRI: 'Cristian' };

// shift times (Italian time). The evening shift ends at 01:00 the next day.
export const SHIFTS = [
  { id: 'm', from: '06:30', to: '14:30' },
  { id: 'd', from: '11:00', to: '19:00' },
  { id: 'e', from: '17:00', to: '01:00' },
];

const ROTA = {
  //           1   2   3   4   5   6   7   8   9   10  11  12  13  14  15  16  17  18  19  20  21  22  23  24  25  26  27  28  29  30
  '2026-11': {
    m:    'GAB GAB MED MED MED MED GAB GAB MED GAB GAB MED MED ZAI MED GAB GAB GAB MED ZAI GAB GAB MED MED MED MED MED ZAI MED MED',
    d:    'MED MED GAB GAB NIK NIK NIK ZAI GAB MED MED ZAI GAB GAB GAB MED MED MED ZAI MED ZAI ZAI GAB GAB GAB ZAI NIK NIK ZAI NIK',
    e:    'NIK NIK CRI ZAI ZAI ZAI ZAI NIK NIK NIK CRI CRI NIK NIK ZAI NIK NIK NIK NIK NIK NIK CRI CRI NIK NIK NIK GAB GAB GAB GAB',
    off1: 'ZAI ZAI ZAI NIK GAB GAB MED MED ZAI ZAI NIK GAB ZAI MED NIK ZAI ZAI ZAI GAB GAB MED NIK NIK ZAI ZAI GAB ZAI MED NIK ZAI',
    off2: 'CRI CRI NIK CRI CRI CRI CRI CRI CRI CRI ZAI NIK CRI CRI CRI CRI CRI CRI CRI CRI CRI MED ZAI CRI CRI CRI CRI CRI CRI CRI',
  },
};

const mins = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const romeNowMin = (now = Date.now()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now)).map(x => [x.type, x.value]));
  return +p.hour * 60 + +p.minute;
};
function codeOn(day, shiftId) {
  const m = ROTA[day.slice(0, 7)]; if (!m || !m[shiftId]) return null;
  return m[shiftId].trim().split(/\s+/)[+day.slice(8) - 1] || null;
}
export const nameOf = code => STAFF[code] || code;
export const hasRota = day => !!ROTA[day.slice(0, 7)];

// Who is on shift now and who is next. Works across midnight (evening shift until 01:00).
export function turnInfo(now = Date.now()) {
  const d0 = dayKey(now), t = romeNowMin(now), list = [];
  for (const [off, day] of [[-1440, addDays(d0, -1)], [0, d0], [1440, addDays(d0, 1)], [2880, addDays(d0, 2)]]) {
    for (const s of SHIFTS) {
      const code = codeOn(day, s.id); if (!code) continue;
      const start = off + mins(s.from); let end = off + mins(s.to); if (end <= start) end += 1440;
      list.push({ code, name: nameOf(code), from: s.from, to: s.to, start, end, day });
    }
  }
  const active = list.filter(x => x.start <= t && t < x.end);
  const next = list.filter(x => x.start > t).sort((a, b) => a.start - b.start)[0] || null;
  if (next) next.when = next.start >= 1440 ? 'tomorrow' : 'today';
  const offToday = ['off1', 'off2'].map(k => codeOn(d0, k)).filter(Boolean).map(nameOf);
  return { known: hasRota(d0), active, next, off: offToday };
}

// For one waiter (by name): his shift now, and who comes after him
export function myTurn(name, now = Date.now()) {
  const info = turnInfo(now), me = info.active.find(x => x.name.toLowerCase() === String(name || '').toLowerCase());
  return { ...info, me: me || null };
}
