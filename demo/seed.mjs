// DEMO ONLY: fills the local demo database with invented data (no real guests, staff or money).
// node demo/seed.mjs
import pg from 'pg';
import { USERS } from './server.mjs';

const DB = process.env.DEMO_DB || 'postgresql://postgres@localhost:55432/demo?host=/var/tmp/demopg';
const c = new pg.Client({ connectionString: DB });
await c.connect();
const q = (s, p) => c.query(s, p);

let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = a => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));

await q(`delete from public.order_lines; delete from public.orders; delete from public.open_tables; delete from public.stock;
         delete from public.audit_log; delete from public.waiter_sessions; delete from public.waiters; delete from public.app_users; delete from auth.users`);
for (const [email, u] of Object.entries(USERS)) {
  await q('insert into auth.users(id, email) values ($1, $2)', [u.id, email]);
  await q('insert into public.app_users(user_id, role) values ($1, $2)', [u.id, u.role]);
}
const NAMES = ['Luca', 'Sara', 'Marco', 'Giulia', 'Paolo'];
const W = {};
for (const [i, n] of NAMES.entries()) {
  const r = await q(`insert into public.waiters(name, pin_hash, sort) values ($1, extensions.crypt('1234', extensions.gen_salt('bf')), $2) returning id`, [n, i]);
  W[n] = r.rows[0].id;
}
await q(`update public.rooftop_tables set app_table = sort, active = true`);
await q(`insert into public.settings(key, value) values ('cover_fee', '2') on conflict (key) do update set value = '2'`);

const menu = (await q('select * from public.menu_items where not hidden order by section, sort')).rows;
const sec = s => menu.filter(m => m.section === s);
const GUESTS = ['Rossi', 'Bianchi', 'Müller', 'Smith', 'Dubois', 'García', 'Johansson', 'Novak', 'Ferri', 'Kowalski', 'Moreau', 'Brown', 'Santoro', 'Weber', 'Costa', 'Lindqvist', 'Martin', 'Ricci', 'Fischer', 'Taylor', 'Leroy', 'Esposito', 'Schmidt', 'Wilson'];
const ROOMS = [...Array(14)].map((_, i) => String(101 + i)).concat([...Array(14)].map((_, i) => String(201 + i)), [...Array(10)].map((_, i) => String(301 + i)));

function lines(evening) {
  const out = []; const add = (m, n = 1) => { const l = out.find(x => x.id === m.id); if (l) l.qty += n; else out.push({ id: m.id, it: m.name_it, sec: m.section, qty: n, p: +m.price, note: '' }); };
  const g = between(1, 4);
  if (evening) {
    for (let i = 0; i < g; i++) add(pick(rnd() < .6 ? sec('cocktail') : sec('vino')));
    if (rnd() < .5) add(pick(sec('pinsa')), between(1, 2));
    if (rnd() < .35) add(pick(sec('aperitivo')), g);
  } else {
    for (let i = 0; i < g; i++) add(pick(rnd() < .55 ? sec('primi') : sec('secondi')));
    if (rnd() < .4) add(pick(sec('pinsa')));
    add(pick(sec('bibite')), between(1, g));
    if (rnd() < .45) add(pick(sec('dolci')), between(1, 2));
    if (rnd() < .6) add(pick(sec('caffe')), between(1, g));
  }
  if (rnd() < .12 && out[0]) out[0].note = pick(['senza glutine', 'no cipolla', 'ben cotto', 'poco sale', 'senza lattosio']);
  return { items: out.filter(l => l.p > 0 || true), guests: g };
}

const romeDay = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date(ms));
const now = Date.now();
const today = romeDay(now);
let made = 0;
for (let d = 60; d >= 0; d--) {
  const base = now - d * 864e5;
  const day = romeDay(base);
  const weekend = [0, 6].includes(new Date(base).getUTCDay());
  const n = d === 0 ? 9 : between(weekend ? 16 : 9, weekend ? 26 : 18);
  // Rome midnight of that day
  const mid = new Date(day + 'T00:00:00+01:00').getTime();
  for (let i = 0; i < n; i++) {
    const evening = rnd() < .45;
    let at = mid + (evening ? between(18 * 60, 23 * 60 + 30) : between(12 * 60 + 15, 15 * 60 + 30)) * 6e4;
    if (d === 0) at = Math.min(at, now - between(10, 300) * 6e4);
    const room = rnd() < .55;
    const { items, guests } = lines(evening);
    const waiter = pick(NAMES.slice(0, 4));
    const o = { uid: `demo-${day}-${i}`, day, closedAt: at, table: String(between(1, 30)), client: room ? 'Sig. ' + pick(GUESTS) : '', roomNo: room ? pick(ROOMS) : '',
      building: room ? (rnd() < .7 ? 'HCO' : 'DEP') : '', roomService: rnd() < .05, roomFee: 10, note: '', covers: guests, coverFee: 2, items };
    const r = await q('select public.insert_order($1::jsonb, $2, $3, $4) as id', [JSON.stringify(o), W[waiter], waiter, 'app']);
    const id = r.rows[0].id;
    if (d > 1 || (d === 1 && rnd() < .5)) await q(`update public.orders set charged_at = closed_at + interval '20 hours', charged_by = 'Reception' where id = $1`, [id]);
    made++;
  }
}
// one guest still to pay for 3 days (the check-out scene): room 214
for (const d of [2, 1, 0]) {
  const day = romeDay(now - d * 864e5), mid = new Date(day + 'T00:00:00+01:00').getTime();
  for (const [k, evening] of [[0, false], [1, true]]) {
    if (d === 0 && evening) continue;
    const { items, guests } = lines(evening);
    let at = mid + (evening ? 20 * 60 + 40 : 13 * 60 + 10) * 6e4; if (d === 0) at = Math.min(at, now - 90 * 6e4);
    const o = { uid: `demo-214-${day}-${k}`, day, closedAt: at, table: String(between(1, 12)), client: 'Mr. Taylor', roomNo: '214', building: 'HCO', roomService: false, roomFee: 10, note: '', covers: guests, coverFee: 2, items };
    await q('select public.insert_order($1::jsonb, $2, $3, $4)', [JSON.stringify(o), W.Sara, 'Sara', 'app']);
  }
}
await q(`update public.orders set charged_at = null, charged_by = null where room_no = '214' and day >= $1::date - 2`, [today]);

// open tables right now (gold on the map; table 7 waiting more than 20 minutes = orange)
const open = [[3, 'Giulia', 8], [7, 'Luca', 26], [12, 'Sara', 4], [15, 'Marco', 12], [21, 'Luca', 2]];
for (const [t, w, ago] of open) {
  const { items, guests } = lines(t > 10);
  const data = { items: Object.fromEntries(items.map(l => [l.id, l.qty])), notes: {}, served: { [items[0].id]: 1 }, client: t === 12 ? 'Sig.ra Bianchi' : '', roomNo: t === 12 ? '108' : '', building: t === 12 ? 'HCO' : '', room: false, note: '', covers: guests, coverOff: false };
  await q('insert into public.open_tables(table_no, data, waiter_id, waiter_name, opened_at) values ($1, $2, $3, $4, now() - $5 * interval \'1 minute\')', [t, data, W[w], w, ago]);
}
// stock counters (green / orange / red)
const st = [[sec('pinsa')[0], 9], [sec('pinsa')[1], 2], [sec('dolci')[0], 1], [sec('primi')[0], 6]];
for (const [m, n] of st) if (m) await q('insert into public.stock(item_id, remaining) values ($1, $2)', [m.id, n]);
// a few audit entries
await q(`insert into public.audit_log(action, entity, entity_id, details, waiter, user_email, at) values
  ('order_reopen', 'order', '1', '{"table": 9}', 'Marco', 'staff@demo.app', now() - interval '3 hours'),
  ('mark_charged_many', 'order', '214', '{"n": 4}', null, 'reception@demo.app', now() - interval '1 day'),
  ('cover_fee', 'settings', 'cover_fee', '{"before": 2.5, "after": 2}', null, 'owner@demo.app', now() - interval '5 days'),
  ('menu_edit', 'menu_items', 'spritz-pesca', '{"price": 15}', null, 'owner@demo.app', now() - interval '6 days')`);
console.log('demo data:', made + 5, 'orders,', open.length, 'open tables');
await c.end();
