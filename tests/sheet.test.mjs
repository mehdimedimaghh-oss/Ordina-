// Test "Send to reception → Google Sheet": the database sends one message per order, reopen and delete,
// and the Apps Script turns them into the right rows (with a fake Google Sheet).
// Usage: SUPABASE_URL=… SUPABASE_ANON_KEY=… DB_URL=… SHEET_TEST_URL=http://<docker gateway>:8788/exec node tests/sheet.test.mjs
// (run tests/db.test.mjs first: it creates the test logins)
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import vm from 'node:vm';

const { SUPABASE_URL: URL, SUPABASE_ANON_KEY: ANON, DB_URL, SHEET_TEST_URL } = process.env;
const sql = q => execFileSync('psql', [DB_URL, '-tAc', q]).toString().trim();
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; console.log('  ✓', m); } else { fails++; console.log('  ✗', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await wait(200); } return false; };

// fake Google: collect what the database sends
const got = [];
const server = http.createServer((req, res) => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { got.push(JSON.parse(b)); res.end('ok'); }); });
await new Promise(r => server.listen(8788, '0.0.0.0', r));

async function login(email, password) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password }); if (error) throw error; return c;
}
const owner = await login('owner@test.local', 'owner-pass-123');
const staff = await login('staff@test.local', 'staff-pass-123');
sql(`delete from open_tables; delete from orders where source='app'; delete from private_settings`);

console.log('Settings are private');
const bad = await owner.rpc('owner_set_sheet_url', { p_url: 'https://example.com/hack' });
ok(!!bad.error, 'a link that is not Google Apps Script is refused');
const st = await staff.rpc('owner_set_sheet_url', { p_url: 'https://script.google.com/macros/s/abc/exec' });
ok(!!st.error, 'staff cannot set the link');
const good = await owner.rpc('owner_set_sheet_url', { p_url: 'https://script.google.com/macros/s/AKfy-test_123/exec' });
ok(good.data === 'on', 'owner saves a Google link');
const peek = await staff.from('private_settings').select('*');
ok(!peek.data?.length, 'staff cannot read the link');
const so = await staff.rpc('owner_sheet_status');
ok(!!so.error, 'staff cannot see the sheet status');
// point it to the fake Google for the test
sql(`update private_settings set value='${SHEET_TEST_URL}' where key='sheet_url'`);

console.log('Send to reception → one row');
const { data: ws } = await staff.from('waiters').select('id,name').order('sort');
const token = (await staff.rpc('waiter_login', { p_waiter: ws[0].id, p_pin: '0000' })).data.token;
await staff.rpc('table_op', { p_table: 4, p_op: { t: 'item', id: 'carbonara', d: 2 }, p_token: token });
const uid = 'sheet-' + Date.now();
const order = { uid, table: '4', client: 'Test', roomNo: '214', building: 'HCO', roomService: true, note: 'allergy nuts', closedAt: Date.now(),
  items: [{ id: 'carbonara', it: 'Spaghetti alla carbonara', qty: 2, p: 13, sec: 'Primi piatti', note: 'no pepper' }, { id: 'tiramisu', it: 'Tiramisù', qty: 1, p: 8.5, sec: 'Dolci', note: '' }] };
const r1 = await staff.rpc('submit_order', { p_order: order, p_token: token });
ok(r1.data?.ok, 'order saved');
ok(await until(() => got.length >= 1), 'the database sent the row');
await wait(1500);
ok(got.length === 1, `exactly one message for a 2-dish order (got ${got.length})`);
const m = got[0] || {};
ok(m.event === 'sent' && m.table === 4 && m.room === '214' && m.building === 'HCO' && Number(m.total) === 44.5 && m.waiter === 'Mehdi', 'table, room, building, total € 44,50, waiter');
ok(m.items === '2x Spaghetti alla carbonara (no pepper), 1x Tiramisù' && m.roomService === true && m.note === 'allergy nuts', 'items with notes, room service, table note');
ok(/^\d{2}\/\d{2}\/\d{4}$/.test(m.day) && /^\d{2}:\d{2}$/.test(m.time), 'Italian date and time');
await staff.rpc('submit_order', { p_order: order, p_token: token });
await wait(1500);
ok(got.length === 1, 'offline retry of the same order → no second row');

console.log('Reopen and delete → row marked');
await staff.rpc('reopen_order', { p_id: r1.data.id, p_token: token });
ok(await until(() => got.some(x => x.event === 'reopened' && x.id === r1.data.id)), 'reopen → "reopened" message');
await staff.rpc('table_op', { p_table: 4, p_op: { t: 'clear' }, p_token: token });
await owner.rpc('delete_order', { p_id: r1.data.id, p_reason: 'test' });
ok(await until(() => got.some(x => x.event === 'deleted' && x.id === r1.data.id)), 'owner delete → "deleted" message');
await owner.rpc('owner_sheet_test');
ok(await until(() => got.some(x => x.event === 'test')), 'test button sends a test row');
const status = (await owner.rpc('owner_sheet_status')).data;
ok(status.on && status.last.length > 0 && status.last.every(x => x.status_code === 200), 'owner sees "✓ arrived" for the last sends');

console.log('Turn off');
await owner.rpc('owner_set_sheet_url', { p_url: '' });
const n = got.length;
await staff.rpc('table_op', { p_table: 5, p_op: { t: 'item', id: 'espresso', d: 1 }, p_token: token });
await staff.rpc('submit_order', { p_order: { ...order, uid: uid + 'b', table: '5' }, p_token: token });
await wait(1500);
ok(got.length === n, 'when off, nothing is sent (and orders still work)');

console.log('Apps Script with a fake Google Sheet');
const sheets = [];
function fakeSheet(name) {
  const rows = []; const fmt = {};
  const sh = {
    name, rows, fmt, getName: () => name,
    appendRow: r => rows.push(r.slice()), getLastRow: () => rows.length,
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => rows.slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc)),
      setValue: v => { rows[r - 1][c - 1] = v; return this; },
      setNumberFormat() { return this; }, setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; },
      setFontLine: v => { fmt[r] = v; return { setFontColor: () => ({ setBackground: () => ({}) }) }; },
    }),
    setFrozenRows() {}, setColumnWidth() {}, hideColumns() {},
  };
  return sh;
}
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ({
    getSheetByName: n => sheets.find(s => s.name === n) || null,
    insertSheet: (n, i) => { const s = fakeSheet(n); sheets.splice(i, 0, s); return s; },
    getSheets: () => sheets,
  }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { createTextOutput: s => s },
};
vm.createContext(ctx);
vm.runInContext(readFileSync(new globalThis.URL('../scripts/reception-sheet.gs', import.meta.url), 'utf8'), ctx);
const post = o => ctx.doPost({ postData: { contents: JSON.stringify(o) } });
for (const x of got) post(x);
post(got[0]);   // same order again
const day = sheets.find(s => s.name === m.day.replace(/\//g, '-'));
ok(!!day && sheets[0] === day, `one tab per day ("${m.day.replace(/\//g, '-')}"), newest first`);
ok(day.rows[0][0] === 'Ora / Time' && day.rows[0][5] === 'Ordine / Items', 'headers in Italian / English');
const orderRows = day.rows.filter(r => String(r[11]) === String(r1.data.id));
ok(orderRows.length === 1, 'the order is written once (duplicate ignored)');
ok(orderRows[0][10] === 'Eliminato / Deleted' && day.fmt[day.rows.indexOf(orderRows[0]) + 1] === 'line-through', 'after delete: crossed out + "Eliminato / Deleted"');
ok(orderRows[0][4] === '214' && orderRows[0][8] === 44.5, 'room 214 and total 44,5 in the row');
ok(day.rows.some(r => r[10] === 'TEST'), 'test row written');
ok(ctx.doGet() === 'Comande reception sheet is ready ✓', 'opening the link in a browser says it is ready');

sql(`delete from orders where uid like 'sheet-%'; delete from open_tables`);
server.close();
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
