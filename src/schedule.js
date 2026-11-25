// Staff schedule (turni). Each month: one code per day for each shift, from the owner's planning sheet.
// To add a new month: copy the block, change the key ('2026-12') and the 4 lines. Codes → names below.
import { addDays, dayKey } from './data.js';
import { S } from './store.js';

export const STAFF = { MED: 'Mehdi', ZAI: 'Zai', GAB: 'Gabri', NIK: 'Nikola', CRI: 'Cristian', NUO: 'Nuova risorsa' };

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
  // December: Gabriele leaves on 21/12; from 21/12 a new person (NUO). "A+B" = two people on that shift, "---" = nobody
  '2026-12': {
    m:    'GAB GAB GAB MED GAB GAB GAB MED GAB GAB GAB GAB GAB MED MED GAB GAB GAB GAB GAB CRI MED MED MED MED MED MED MED NUO NUO MED',
    d:    'MED MED MED CRI CRI CRI MED CRI MED MED MED CRI CRI CRI CRI MED MED MED MED CRI NUO CRI+NUO NUO NUO NUO NUO CRI CRI CRI CRI NUO',
    e:    'CRI NIK NIK NIK NIK NIK CRI NIK CRI NIK NIK NIK NIK NIK NIK CRI CRI NIK NIK NIK NIK NIK CRI NIK CRI CRI NIK NIK NIK NIK NIK',
    off1: 'NIK CRI CRI GAB MED MED NIK GAB NIK CRI CRI MED MED GAB GAB NIK NIK CRI CRI MED MED --- NIK CRI NIK NIK NUO NUO MED MED CRI',
    off2: '--- --- --- --- --- --- --- --- --- --- --- --- --- --- --- --- --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---',
  },
  // January: only day 1 is known so far
  '2027-01': {
    m:    'NUO',
    d:    'CRI',
    e:    'NIK',
    off1: 'MED',
    off2: '---',
  },
};

const mins = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const romeNowMin = (now = Date.now()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now)).map(x => [x.type, x.value]));
  return +p.hour * 60 + +p.minute;
};
// The schedule is managed by the owner in the app (Owner → Turni) and saved in the database (staff_shifts).
// A month that is not in the database (or before the database part is installed) comes from ROTA above.
export const LETTER = { m: 'M', d: 'C', e: 'P' };
const dbMonth = ym => (S.rota && S.rota.months ? S.rota.months[ym] : null);
// names on a shift ('m' | 'd' | 'e') or resting ('off') that day
function peopleOn(day, shiftId) {
  if (dbMonth(day.slice(0, 7))) {
    const L = shiftId === 'off' ? 'R' : LETTER[shiftId];
    return ((S.rota.cells || {})[day] || []).filter(c => c.shift === L).sort((a, b) => a.sort - b.sort).map(c => c.person);
  }
  if (shiftId === 'off') return ['off1', 'off2'].flatMap(k => codesOn(day, k)).map(nameOf);
  return codesOn(day, shiftId).map(nameOf);
}
// one month as a grid (rows = people, like the paper sheet), from the months written in this file
export function gridFromCode(ym) {
  const m = ROTA[ym]; if (!m) return null;
  const people = [], cells = {};
  const put = (name, d, s) => { if (!people.includes(name)) people.push(name); (cells[name] ||= {})[d] = s; };
  for (const [k, s] of [['m', 'M'], ['d', 'C'], ['e', 'P'], ['off1', 'R'], ['off2', 'R']]) {
    if (!m[k]) continue;
    m[k].trim().split(/\s+/).forEach((c, i) => { if (c && c !== '---') c.split('+').forEach(code => put(nameOf(code), i + 1, s)); });
  }
  const PAPER = ['GAB', 'MED', 'CRI', 'NIK', 'NUO', 'ZAI'].map(nameOf);
  people.sort((a, b) => (PAPER.indexOf(a) + 1 || 99) - (PAPER.indexOf(b) + 1 || 99));
  return { people: people.map(name => ({ name })), cells, source: 'code', version: 0 };
}
// one month as a grid from database rows
export function gridFromDb(month, rows) {
  const people = (month && month.people ? month.people : []).map(p => ({ name: p.name, waiter_id: p.waiter_id || null }));
  const cells = {};
  for (const r of rows) {
    if (!people.some(p => p.name === r.person)) people.push({ name: r.person, waiter_id: r.waiter_id || null });
    (cells[r.person] ||= {})[+String(r.day).slice(8, 10)] = r.shift;
  }
  return { people, cells, source: 'db', version: month ? month.version : 0, updatedAt: month?.updated_at, updatedBy: month?.updated_by };
}
// the grid of a month the device already has (last, this and next month): database copy, else this file
export function gridFor(ym) {
  const m = dbMonth(ym);
  if (m) {
    const rows = [];
    for (const [day, list] of Object.entries(S.rota.cells || {})) if (day.startsWith(ym)) for (const c of list) rows.push({ day, ...c });
    rows.sort((a, b) => a.sort - b.sort);
    return gridFromDb({ people: m.people, version: m.version, updated_at: m.updatedAt, updated_by: m.updatedBy }, rows);
  }
  return gridFromCode(ym);
}
function codesOn(day, shiftId) {
  const m = ROTA[day.slice(0, 7)]; if (!m || !m[shiftId]) return [];
  const c = m[shiftId].trim().split(/\s+/)[+day.slice(8) - 1];
  return c && c !== '---' ? c.split('+') : [];
}
export const nameOf = code => STAFF[code] || code;
export const hasRota = day => !!dbMonth(day.slice(0, 7)) || !!ROTA[day.slice(0, 7)];

// Who is on shift now and who is next. Works across midnight (evening shift until 01:00).
export function turnInfo(now = Date.now()) {
  const d0 = dayKey(now), t = romeNowMin(now), list = [];
  for (const [off, day] of [[-1440, addDays(d0, -1)], [0, d0], [1440, addDays(d0, 1)], [2880, addDays(d0, 2)]]) {
    for (const s of SHIFTS) {
      for (const name of peopleOn(day, s.id)) {
        const start = off + mins(s.from); let end = off + mins(s.to); if (end <= start) end += 1440;
        list.push({ code: name, name, from: s.from, to: s.to, start, end, day });
      }
    }
  }
  const active = list.filter(x => x.start <= t && t < x.end);
  const next = list.filter(x => x.start > t).sort((a, b) => a.start - b.start)[0] || null;
  if (next) next.when = next.start >= 1440 ? 'tomorrow' : 'today';
  const offToday = peopleOn(d0, 'off');
  return { known: hasRota(d0), active, next, off: offToday };
}

// For one waiter (by name): his shift now, and who comes after him
export function myTurn(name, now = Date.now()) {
  const info = turnInfo(now), me = info.active.find(x => x.name.toLowerCase() === String(name || '').toLowerCase());
  return { ...info, me: me || null };
}
