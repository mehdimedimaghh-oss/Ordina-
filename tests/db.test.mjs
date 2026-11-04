// Security + logic test against a running Supabase (local or a test project).
// Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_KEY=... DB_URL=postgres://... node tests/db.test.mjs [history.json]
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { SUPABASE_URL: URL, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_KEY: SERVICE, DB_URL } = process.env;
const sql = q => execFileSync('psql', [DB_URL, '-tAc', q]).toString().trim();
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) { passes++; console.log('  ✓', msg) } else { fails++; console.log('  ✗', msg) } };

async function user(email, password, role) {
  await admin.auth.admin.createUser({ email, password, email_confirm: true }).catch(() => {});
  if (role) sql(`select set_user_role('${email}','${role}')`);
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return c;
}

const anon = createClient(URL, ANON, { auth: { persistSession: false } });
const owner = await user('owner@test.local', 'owner-pass-123', 'owner');
const staff = await user('staff@test.local', 'staff-pass-123', 'staff');
const nobody = await user('stranger@test.local', 'stranger-pass-123', null);
const recep = await user('reception@test.local', 'reception-pass-123', 'reception');

console.log('Not logged in / no role sees nothing');
for (const [name, c] of [['anon', anon], ['no role', nobody]]) {
  const o = await c.from('orders').select('*');
  ok(!o.data?.length, `${name}: no orders`);
  const m = await c.from('menu_items').select('*');
  ok(!m.data?.length, `${name}: no menu`);
  const t = await c.rpc('table_op', { p_table: 1, p_op: { t: 'item', id: 'carbonara', d: 1 } });
  ok(!!t.error, `${name}: cannot change a table`);
}

console.log('Waiter PIN');
const { data: ws } = await staff.from('waiters').select('id,name').order('sort');
ok(ws.length === 2 && ws[0].name === 'Mehdi', 'staff sees waiter names');
const ph = await staff.from('waiters').select('pin_hash');
ok(!!ph.error, 'staff cannot read PIN hashes');
const bad = await staff.rpc('waiter_login', { p_waiter: ws[0].id, p_pin: '9999' });
ok(bad.data?.ok === false, 'wrong PIN refused');
const good = await staff.rpc('waiter_login', { p_waiter: ws[0].id, p_pin: '0000' });
ok(good.data?.ok === true && good.data.token, 'right PIN gives a session');
const token = good.data.token;

console.log('Open table + stock');
await staff.rpc('stock_set', { p_item: 'carbonara', p_remaining: 3 });
let r = await staff.rpc('table_op', { p_table: 5, p_op: { t: 'item', id: 'carbonara', d: 2 }, p_token: token });
ok(r.data?.data?.items?.carbonara === 2 && r.data.waiter_name === 'Mehdi', 'add 2 carbonara on table 5, waiter Mehdi');
let s = await staff.from('stock').select('remaining').eq('item_id', 'carbonara').single();
ok(s.data.remaining === 1, 'stock went 3 → 1');
r = await staff.rpc('table_op', { p_table: 5, p_op: { t: 'served', id: 'carbonara', n: 1 }, p_token: token });
ok(r.data.data.served.carbonara === 1, 'served 1/2');
r = await staff.rpc('table_op', { p_table: 5, p_op: { t: 'set', fields: { client: 'Rossi', roomNo: '214', building: 'HCO', room: true } }, p_token: token });
ok(r.data.data.client === 'Rossi' && r.data.data.room === true, 'client, room, building saved');
r = await staff.rpc('table_op', { p_table: 5, p_op: { t: 'inote', id: 'carbonara', note: 'no pepper' }, p_token: token });
ok(r.data.data.notes.carbonara === 'no pepper', 'dish note saved');
await staff.rpc('table_op', { p_table: 6, p_op: { t: 'item', id: 'carbonara', d: 1 }, p_token: token });
await staff.rpc('table_op', { p_table: 6, p_op: { t: 'clear' }, p_token: token });
s = await staff.from('stock').select('remaining').eq('item_id', 'carbonara').single();
ok(s.data.remaining === 1, 'delete table without saving gives stock back');

console.log('Send to reception');
const uid = 'test-' + Date.now();
const order = { uid, table: '5', client: 'Rossi', roomNo: '214', building: 'HCO', roomService: true, note: '', closedAt: Date.now(),
  items: [{ id: 'carbonara', it: 'Spaghetti alla carbonara', qty: 2, p: 13, sec: 'Primi piatti', note: 'no pepper' }] };
r = await staff.rpc('submit_order', { p_order: order, p_token: token });
ok(r.data?.ok, 'order saved');
const again = await staff.rpc('submit_order', { p_order: order, p_token: token });
ok(again.data?.duplicate, 'sending twice (offline retry) does not duplicate');
const { data: t5 } = await staff.from('open_tables').select('*').eq('table_no', 5);
ok(t5.length === 0, 'table 5 is free again');
const { data: mine } = await staff.from('orders').select('*, order_lines(*)').eq('uid', uid).single();
ok(Number(mine.total) === 36 && mine.waiter_name === 'Mehdi' && mine.order_lines[0].note === 'no pepper', 'total 2×13 + 10 room service = 36, waiter + note kept');

console.log('History rules');
const hist = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : [];
const stImp = await staff.rpc('import_orders', { p_rows: hist });
ok(!!stImp.error, 'staff cannot import');
if (hist.length) {
  const imp = await owner.rpc('import_orders', { p_rows: hist });
  ok(imp.data?.imported === hist.length, `owner imports ${hist.length} old orders (${JSON.stringify(imp.data)})`);
  const imp2 = await owner.rpc('import_orders', { p_rows: hist });
  ok(imp2.data?.imported === 0, 'import again → nothing doubled');
}
const { data: staffSees } = await staff.from('orders').select('day');
ok(staffSees.every(o => o.day === sql(`select public.rome_today()`)), 'staff only sees today');
const { data: ownerSees } = await owner.from('orders').select('day');
ok(ownerSees.length === hist.length + 1, 'owner sees all history');
const del = await staff.rpc('delete_order', { p_id: mine.id });
ok(!!del.error, 'staff cannot delete an order');
const au = await staff.from('audit_log').select('*');
ok(!au.data?.length, 'staff cannot read the audit log');
const mu = await staff.from('menu_items').update({ price: 1 }).eq('id', 'carbonara').select();
ok(!mu.data?.length, 'staff cannot change prices');
const mo = await owner.from('menu_items').update({ price: 14 }).eq('id', 'carbonara').select();
ok(mo.data?.[0]?.price == 14, 'owner changes a price');
await owner.from('menu_items').update({ price: 13 }).eq('id', 'carbonara');

console.log('Guests (coperti)');
await staff.rpc('table_op', { p_table: 11, p_op: { t: 'set', fields: { covers: 4 } }, p_token: token });
await staff.rpc('table_op', { p_table: 11, p_op: { t: 'item', id: 'espresso', d: 1 }, p_token: token });
const { data: t11 } = await staff.from('open_tables').select('data').eq('table_no', 11).single();
ok(t11.data.covers === 4, '4 guests stored on the open table');
const cuid = 'test-cov-' + Date.now();
const cv = await staff.rpc('submit_order', { p_order: { uid: cuid, table: '11', covers: 4, closedAt: Date.now(), items: [{ id: 'espresso', it: 'Caffè espresso', qty: 1, p: 3, sec: 'Caffetteria' }] }, p_token: token });
const { data: oc } = await staff.from('orders').select('id,covers').eq('id', cv.data.id).single();
ok(oc.covers === 4, 'guests saved in the history');
await staff.rpc('reopen_order', { p_id: oc.id, p_token: token });
const { data: t11b } = await staff.from('open_tables').select('data').eq('table_no', 11).single();
ok(t11b.data.covers === 4, 'reopen brings the guests back');
await staff.rpc('table_op', { p_table: 11, p_op: { t: 'clear' }, p_token: token });

console.log('Reception login');
const rToday = await recep.from('orders').select('day');
ok(rToday.data.length > 0 && rToday.data.every(o => o.day === sql(`select public.rome_today()`)), 'reception sees only today\'s orders');
ok(!(await recep.from('menu_items').select('*')).data?.length && !(await recep.from('open_tables').select('*')).data?.length, 'reception cannot read menu or open tables');
ok(!!(await recep.rpc('table_op', { p_table: 3, p_op: { t: 'item', id: 'espresso', d: 1 } })).error, 'reception cannot take orders');
ok(!!(await recep.rpc('delete_order', { p_id: mine.id })).error && !(await recep.from('audit_log').select('*')).data?.length, 'reception cannot delete or read the audit log');
const ch = await recep.rpc('mark_charged', { p_id: mine.id, p_charged: true, p_by: 'Reception' });
ok(ch.data?.ok, 'reception marks an order as charged');
const { data: chk } = await owner.from('audit_log').select('user_email').eq('action', 'order_charged').eq('entity_id', String(mine.id));
ok(chk.length === 1 && chk[0].user_email === 'reception@test.local', 'audit log: charged by reception@test.local');
await recep.rpc('mark_charged', { p_id: mine.id, p_charged: false });

console.log('Reopen + owner delete');
r = await staff.rpc('reopen_order', { p_id: mine.id, p_token: token });
ok(r.data?.table === 5, 'staff reopens today\'s order to table 5');
const { data: t5b } = await staff.from('open_tables').select('*').eq('table_no', 5).single();
ok(t5b.data.items.carbonara === 2, 'table 5 has the dishes again');
await staff.rpc('table_op', { p_table: 5, p_op: { t: 'clear' }, p_token: token });
const d = await owner.rpc('delete_order', { p_id: mine.id, p_reason: 'test' });
ok(d.data?.ok, 'owner deletes the order');
const { data: log } = await owner.from('audit_log').select('*').eq('action', 'order_delete').eq('entity_id', String(mine.id));
ok(log.length === 1 && log[0].user_email === 'owner@test.local' && log[0].details.lines.length === 1, 'audit log keeps who/what/when + full copy');

console.log('Waiter management');
const nw = await owner.rpc('owner_save_waiter', { p_id: null, p_name: 'Giulia', p_pin: '4321', p_active: true });
ok(!!nw.data, 'owner adds waiter Giulia');
const nw2 = await staff.rpc('owner_save_waiter', { p_id: null, p_name: 'Hacker', p_pin: '1111', p_active: true });
ok(!!nw2.error, 'staff cannot add waiters');
const gl = await staff.rpc('waiter_login', { p_waiter: nw.data, p_pin: '4321' });
ok(gl.data?.ok, 'Giulia logs in with her PIN');

// cleanup test rows
sql(`delete from orders where source='app' and uid like 'test-%'; delete from waiters where name='Giulia'`);
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
