// Data layer: Supabase + offline copy + offline queue + live updates.
import { createClient } from '@supabase/supabase-js';
import { today, ms, uid as newUid } from './data.js';
import { t } from './i18n.js';

const URL = (import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
const KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
export const STAFF_EMAIL = (import.meta.env.VITE_STAFF_EMAIL || '').trim();
export const configured = !!(URL && KEY);
export const sb = configured ? createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ordina-auth' } }) : null;

// ---------- small local storage helpers (everything is cleared on log out) ----------
const P = 'ordina:';
export const LS = {
  get(k, d) { try { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch { /* full or blocked */ } },
  del(k) { try { localStorage.removeItem(P + k); } catch { /* ignore */ } },
};

export const S = {
  session: null, role: LS.get('role', null), email: LS.get('email', ''),
  menu: LS.get('menu', []), waiters: LS.get('waiters', []), settings: LS.get('settings', { stock_alert: 2, room_fee: 10 }),
  server: LS.get('tables', {}), stock: LS.get('stock', {}), today: LS.get('today', []),
  queue: LS.get('queue', []), waiter: LS.get('waiter', null),
  roof: LS.get('roof', { tables: [], chairs: {} }),   // physical rooftop tables + where the chairs are
  online: navigator.onLine, sync: 'idle', lastError: '',
};

const subs = new Set();
export const onChange = f => subs.add(f);
let emitT = null;
export function emit() { cache = null; clearTimeout(emitT); emitT = setTimeout(() => subs.forEach(f => f()), 0); }

// ---------- pure logic, same rules as the SQL function table_op ----------
export const emptyData = () => ({ items: {}, notes: {}, served: {}, client: '', roomNo: '', building: '', room: false, note: '', covers: 0 });
const norm = d => ({ ...emptyData(), ...(d || {}), items: { ...(d?.items || {}) }, notes: { ...(d?.notes || {}) }, served: { ...(d?.served || {}) } });
export const count = d => Object.values(d?.items || {}).reduce((a, b) => a + b, 0);
const isBlank = d => !count(d) && !d.client && !d.roomNo && !d.note && !d.building && !d.room && !d.covers;

// returns [newRow|null, stockDelta{id:+-n}]
export function applyOp(row, op, at, waiterName) {
  const r = row ? { ...row, data: norm(row.data) } : { table_no: 0, data: emptyData(), opened_at: null, waiter_name: null };
  const d = r.data, sd = {};
  const wasOpen = count(d) > 0;
  if (op.t === 'item') {
    const qo = d.items[op.id] || 0, qn = Math.max(0, qo + op.d);
    if (!qn) { delete d.items[op.id]; delete d.notes[op.id]; delete d.served[op.id]; }
    else { d.items[op.id] = qn; if ((d.served[op.id] || 0) > qn) d.served[op.id] = qn; }
    sd[op.id] = qo - qn;
  } else if (op.t === 'served') {
    const q = d.items[op.id] || 0; if (q) d.served[op.id] = Math.min(q, Math.max(0, op.n));
  } else if (op.t === 'inote') {
    if (!(op.note || '').trim()) delete d.notes[op.id]; else if (d.items[op.id]) d.notes[op.id] = op.note.slice(0, 300);
  } else if (op.t === 'set') {
    for (const [k, v] of Object.entries(op.fields)) {
      if (['client', 'roomNo', 'note'].includes(k)) d[k] = String(v ?? '');
      else if (k === 'building' && ['', 'HCO', 'DEP'].includes(v || '')) d.building = v || '';
      else if (k === 'room') d.room = !!v;
      else if (k === 'covers') d.covers = Math.min(99, Math.max(0, parseInt(v, 10) || 0));
    }
  } else if (op.t === 'clear') {
    for (const [id, q] of Object.entries(d.items)) sd[id] = q;
    return [null, sd];
  }
  if (isBlank(d)) return [null, sd];
  const open = count(d) > 0;
  if (open && !wasOpen) { r.opened_at = at; r.waiter_name = waiterName || r.waiter_name; }
  if (!open) r.opened_at = null;
  if (!r.waiter_name) r.waiter_name = waiterName || null;
  return [r, sd];
}

// Current view = what the server said + my changes that are still waiting to be sent.
let cache = null;
export function views() {
  if (cache) return cache;
  const tables = {}; for (const [k, v] of Object.entries(S.server)) tables[k] = v;
  const stock = { ...S.stock };
  const pendingOrders = [];
  for (const q of S.queue) {
    if (q.kind === 'op') {
      const [row, sd] = applyOp(tables[q.table], q.op, q.at, q.waiterName);
      if (row) { row.table_no = q.table; tables[q.table] = row; } else delete tables[q.table];
      for (const [id, n] of Object.entries(sd)) if (stock[id] != null) stock[id] += n;
    } else if (q.kind === 'submit') {
      delete tables[q.table]; pendingOrders.push(q.order);
    } else if (q.kind === 'stock_set') {
      if (q.n == null) delete stock[q.id]; else stock[q.id] = Math.max(0, q.n);
    } else if (q.kind === 'stock_new_day') {
      for (const k of Object.keys(stock)) delete stock[k];
    }
  }
  return (cache = { tables, stock, pendingOrders });
}
export const tableRow = n => views().tables[n] || null;
export const tableData = n => norm(tableRow(n)?.data);
export const stockLeft = id => { const v = views().stock[id]; return v == null ? null : v; };

// ---------- queue ----------
const saveQueue = () => LS.set('queue', S.queue);
function enqueue(item) {
  S.queue.push({ qid: newUid(), at: Date.now(), token: S.waiter?.token || null, waiterName: S.waiter?.name || null, ...item });
  saveQueue(); emit(); flush();
}
export const tableOp = (table, op) => enqueue({ kind: 'op', table: +table, op });
export const submitOrder = order => enqueue({ kind: 'submit', table: +order.table, order });
export const stockSet = (id, n) => enqueue({ kind: 'stock_set', id, n });
export const stockNewDay = () => enqueue({ kind: 'stock_new_day' });

let inflight = null, dirty = new Set(), flushing = false, saved = 0;
const laterT = {};
function later(k) { clearTimeout(laterT[k]); laterT[k] = setTimeout(() => loaders[k](), 250); }
// A Postgres refusal has a code (e.g. P0001). No code + "fetch failed" = no internet.
const isNetErr = e => !e?.code && /fetch|network|load failed|timeout|abort/i.test(e?.message || '');

async function send(q) {
  if (q.kind === 'op') return sb.rpc('table_op', { p_table: q.table, p_op: q.op, p_token: q.token });
  if (q.kind === 'submit') return sb.rpc('submit_order', { p_order: q.order, p_token: q.token });
  if (q.kind === 'stock_set') return sb.rpc('stock_set', { p_item: q.id, p_remaining: q.n });
  if (q.kind === 'stock_new_day') return sb.rpc('stock_new_day', { p_token: q.token });
  return { data: null };
}

export async function flush() {
  if (flushing || !sb || !S.session) return;
  flushing = true;
  try {
    while (S.queue.length) {
      const q = S.queue[0]; inflight = q;
      let res;
      try { res = await send(q); } catch (e) { res = { error: { message: String(e?.message || e) } }; }
      if (res.error) {
        if (isNetErr(res.error) || !navigator.onLine) { setSync('offline'); break; }
        if (res.error.code === '42501' || /JWT|not allowed|log in/i.test(res.error.message)) {
          setSync('error', res.error.message); sb.auth.refreshSession().catch(() => {}); break;   // try again at the next check
        }
        S.lastError = res.error.message; notify(t('notSaved', { msg: res.error.message }));   // a real refusal: drop it
      } else if (q.kind === 'op') {
        // keep the stock number right at once (no jump back while waiting for the next refresh)
        const [, sd] = applyOp(S.server[q.table], q.op, q.at, q.waiterName);
        for (const [id, n] of Object.entries(sd)) if (S.stock[id] != null) S.stock[id] += n;
        const row = res.data;
        if (row && row.data && Object.keys(row.data).length) S.server[q.table] = row; else delete S.server[q.table];
      } else if (q.kind === 'submit') {
        delete S.server[q.table]; dirty.add('today');
      } else if (q.kind === 'stock_set') {
        if (q.n == null) delete S.stock[q.id]; else S.stock[q.id] = Math.max(0, q.n);
        dirty.add('stock');
      } else if (q.kind === 'stock_new_day') { S.stock = {}; dirty.add('stock'); }
      if (q.kind === 'op') dirty.add('stock');
      S.queue.shift(); saveQueue(); inflight = null; saved++;
      persist(); emit();
    }
    if (!S.queue.length) setSync('ok');
  } finally {
    flushing = false; inflight = null;
    if (dirty.size) { const d = [...dirty]; dirty.clear(); d.forEach(k => loaders[k]?.()); }
  }
}

function setSync(s, msg) { S.sync = s; if (msg) S.lastError = msg; emit(); }
let notifyFn = () => {};
export const onNotify = f => { notifyFn = f; };
const notify = m => notifyFn(m);

// ---------- loading from the server ----------
function persist() {
  LS.set('tables', S.server); LS.set('stock', S.stock); LS.set('today', S.today); LS.set('roof', S.roof);
  LS.set('menu', S.menu); LS.set('waiters', S.waiters); LS.set('settings', S.settings);
}
const loaders = {
  async menu() { const { data, error } = await sb.from('menu_items').select('*').order('sort'); if (!error) { S.menu = data; persist(); emit(); } },
  async waiters() { const { data, error } = await sb.from('waiters').select('id,name,active,sort').order('sort'); if (!error) { S.waiters = data; persist(); emit(); } },
  async settings() { const { data, error } = await sb.from('settings').select('*'); if (!error) { for (const r of data) S.settings[r.key] = r.value; persist(); emit(); } },
  // an answer that started before one of my saves finished is old: ask again instead of showing it
  async tables() {
    if (inflight) { dirty.add('tables'); return; }
    const seq = saved;
    const { data, error } = await sb.from('open_tables').select('*');
    if (error) return;
    if (inflight || seq !== saved) { dirty.add('tables'); if (!inflight) later('tables'); return; }
    S.server = Object.fromEntries(data.map(r => [r.table_no, r])); persist(); emit();
  },
  async stock() {
    if (inflight) { dirty.add('stock'); return; }
    const seq = saved;
    const { data, error } = await sb.from('stock').select('*');
    if (error) return;
    if (inflight || seq !== saved) { dirty.add('stock'); if (!inflight) later('stock'); return; }
    S.stock = Object.fromEntries(data.map(r => [r.item_id, r.remaining])); persist(); emit();
  },
  async roof() {
    if (S.role === 'reception') return;
    const [t, c] = await Promise.all([sb.from('rooftop_tables').select('*').order('sort'), sb.from('rooftop_chairs').select('*')]);
    if (t.error || c.error) return;   // (the SQL for chairs may not be installed yet)
    S.roof = { tables: t.data, chairs: Object.fromEntries(c.data.map(r => [r.location, r.chairs])) }; persist(); emit();
  },
  async today() {
    const { data, error } = await sb.from('orders').select('*, order_lines(*)').eq('day', today()).order('closed_at', { ascending: false });
    if (!error) { S.today = data; S.todayLoadedAt = Date.now(); persist(); emit(); }
  },
};
export const reload = k => loaders[k]();
export async function loadAll() {
  await Promise.all(Object.values(loaders).map(f => f().catch(() => {})));
}

let channel = null, todayT = null;
// "Active" waiters: each device that has a waiter logged in (PIN) announces itself on the live channel (Realtime Presence).
// Only the first name is shared; it disappears when the waiter locks the app, logs out or closes it.
const deviceId = LS.get('device') || (() => { const id = newUid(); LS.set('device', id); return id; })();
S.presence = [];
export function trackMe() {
  if (!channel || channel.state !== 'joined') return;
  if (S.waiter && (S.role === 'staff' || S.role === 'owner')) channel.track({ waiter_id: S.waiter.id, name: S.waiter.name, since: Date.now() }).catch(() => {});
  else channel.untrack().catch(() => {});
}
function readPresence() {
  if (!channel) return;
  const seen = new Map();
  for (const metas of Object.values(channel.presenceState())) for (const m of metas) {
    if (!m.waiter_id) continue;
    const old = seen.get(m.waiter_id); if (!old || m.since < old.since) seen.set(m.waiter_id, { id: m.waiter_id, name: m.name, since: m.since });
  }
  S.presence = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)); emit();
}
let liveStopped = false, resubT = null;
// if the server ever closes the live connection, open it again by itself (and read everything fresh)
function resubscribeSoon() {
  if (liveStopped || resubT || !S.session) return;
  resubT = setTimeout(() => { resubT = null; if (!liveStopped && S.session) subscribe(); }, 3000);
}
function subscribe() {
  if (channel) { const old = channel; channel = null; sb.removeChannel(old); }
  const ch = sb.channel('live', { config: { presence: { key: deviceId } } });
  channel = ch;
  ch
    .on('presence', { event: 'sync' }, readPresence)
    // live messages can arrive late and out of order: use them only as a signal to read the latest state
    .on('postgres_changes', { event: '*', schema: 'public', table: 'open_tables' }, () => later('tables'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'stock' }, () => later('stock'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => { clearTimeout(todayT); todayT = setTimeout(loaders.today, 400); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, () => loaders.menu())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, () => loaders.settings())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooftop_chairs' }, () => later('roof'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooftop_tables' }, () => later('roof'))
    .subscribe(status => {
      if (ch !== channel) return;   // an old connection that was replaced
      if (status !== 'SUBSCRIBED') console.info('[live]', status);
      if (status === 'SUBSCRIBED') { loadAll(); flush(); trackMe(); }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setSync('offline');
      else if (status === 'CLOSED') resubscribeSoon();
    });
}

// ---------- login ----------
export async function start() {
  if (!sb) { S.ready = true; return; }
  const { data } = await sb.auth.getSession();
  S.session = data.session;
  S.ready = true;
  sb.auth.onAuthStateChange((ev, session) => {
    S.session = session;
    if (ev === 'SIGNED_OUT') { S.role = null; emit(); }
  });
  if (S.session) afterLogin();   // role is remembered, so this also works offline
  addEventListener('online', () => { S.online = true; sb.realtime.connect(); flush(); loadAll(); emit(); });
  addEventListener('offline', () => { S.online = false; setSync('offline'); });
  // safety net every minute: even if a live message is lost, everything is fresh within 60 s
  setInterval(() => {
    if (!S.session || !navigator.onLine || document.hidden) return;
    flush(); loaders.tables(); loaders.stock(); loaders.today(); loaders.roof();
    if (channel && channel.state !== 'joined' && channel.state !== 'joining') resubscribeSoon();
  }, 60000);
}

async function afterLogin() {
  S.email = S.session.user.email; LS.set('email', S.email);
  const { data, error } = await sb.from('app_users').select('role').eq('user_id', S.session.user.id).maybeSingle();
  if (!error) { S.role = data?.role || 'none'; LS.set('role', S.role); }
  if (S.role === 'owner' || S.role === 'staff' || S.role === 'reception') { subscribe(); loadAll(); flush(); }
  emit();
}

export async function login(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) {
    if (error.message === 'Invalid login credentials') throw new Error(t('errWrongLogin'));
    if (/email logins are disabled/i.test(error.message)) throw new Error(t('errEmailOff'));
    throw new Error(error.message);
  }
  S.session = data.session;
  await afterLogin();
  if (S.role === 'none') throw new Error(t('errNoRole'));
}

export async function logout() {
  if (S.queue.length && !confirm(t('confirmLogout', { n: S.queue.length }))) return false;
  liveStopped = true;
  if (channel) sb.removeChannel(channel);
  await sb.auth.signOut().catch(() => {});
  try { Object.keys(localStorage).filter(k => k.startsWith(P) && k !== P + 'theme' && !k.startsWith(P + 'lang')).forEach(k => localStorage.removeItem(k)); } catch { /* ignore */ }
  location.reload();
  return true;
}

// ---------- waiter PIN ----------
async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function waiterLogin(w, pin) {
  const known = LS.get('pins', {});
  if (navigator.onLine) {
    const { data, error } = await sb.rpc('waiter_login', { p_waiter: w.id, p_pin: pin });
    if (!error) {
      if (!data.ok) throw new Error(data.error);
      S.waiter = { id: data.id, name: data.name, token: data.token };
      const salt = newUid(); known[w.id] = { salt, h: await sha(salt + pin), token: data.token };
      LS.set('pins', known); LS.set('waiter', S.waiter); trackMe(); emit(); return S.waiter;
    }
    if (!isNetErr(error)) throw new Error(error.message);
  }
  // offline: check against the PIN this device saw the last time it was online
  const k = known[w.id];
  if (!k) throw new Error(t('errOfflinePin'));
  if (await sha(k.salt + pin) !== k.h) throw new Error(t('errWrongPin'));
  S.waiter = { id: w.id, name: w.name, token: k.token }; LS.set('waiter', S.waiter); trackMe(); emit(); return S.waiter;
}
export function waiterLogout() { S.waiter = null; LS.del('waiter'); trackMe(); emit(); }

// ---------- actions that need the internet (owner and history) ----------
async function must(p) { const { data, error } = await p; if (error) throw new Error(error.message); return data; }
export const reopenOrder = id => must(sb.rpc('reopen_order', { p_id: id, p_token: S.waiter?.token || null })).then(r => { loaders.tables(); loaders.today(); return r; });
export const deleteOrder = (id, reason) => must(sb.rpc('delete_order', { p_id: id, p_reason: reason || '' }));
export const setAlert = n => { S.settings.stock_alert = n; emit(); return must(sb.rpc('set_stock_alert', { p_n: n })); };
// Full backup: every order since the beginning, read page by page (1000 at a time) so nothing is cut off
export async function fetchAllOrders() {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const page = await must(sb.from('orders').select('*, order_lines(*)').order('id', { ascending: true }).range(from, from + 999));
    all.push(...page); if (page.length < 1000) break;
  }
  return all;
}
export const fetchOrders = (from, to) => must(sb.from('orders').select('*, order_lines(*)').gte('day', from).lte('day', to).order('closed_at', { ascending: true }).limit(10000));
export const fetchDayTotals = (from, to) => must(sb.from('orders').select('day,total,status').gte('day', from).lte('day', to).limit(20000));
export const fetchAudit = () => must(sb.from('audit_log').select('*').order('at', { ascending: false }).limit(300));
export const fetchAllWaiters = () => must(sb.from('waiters').select('id,name,active,sort').order('sort'));
export const saveWaiter = (id, name, pin, active) => must(sb.rpc('owner_save_waiter', { p_id: id, p_name: name, p_pin: pin || null, p_active: active })).then(r => { loaders.waiters(); return r; });
export const saveMenuItem = (id, patch) => must(sb.from('menu_items').update(patch).eq('id', id).select()).then(r => { loaders.menu(); return r; });
export const addMenuItem = row => must(sb.from('menu_items').insert(row).select()).then(r => { loaders.menu(); return r; });
export const importOrders = rows => must(sb.rpc('import_orders', { p_rows: rows }));
// ---------- rooftop chairs (needs internet: a chair must never be counted twice) ----------
export const roofOfApp = n => S.roof.tables.find(r => r.app_table === +n) || null;
export const chairsAt = loc => S.roof.chairs[loc] ?? 0;
export const moveChairs = (from, to, n) => must(sb.rpc('chairs_move', { p_from: from, p_to: to, p_n: n, p_token: S.waiter?.token || null }))
  .then(r => { S.roof = { ...S.roof, chairs: r }; persist(); emit(); return r; });
export const ownerSetChairs = counts => must(sb.rpc('owner_set_chairs', { p_counts: counts })).then(r => { S.roof = { ...S.roof, chairs: r }; persist(); emit(); return r; });
export const ownerSetRoofTable = (id, app, active) => must(sb.rpc('owner_set_rooftop_table', { p_id: id, p_app: app, p_active: active })).then(() => loaders.roof());
export const markCharged = (id, on, by) => must(sb.rpc('mark_charged', { p_id: id, p_charged: on, p_by: by || 'Reception' })).then(r => { loaders.today(); return r; });
export const markChargedMany = (ids, by) => must(sb.rpc('mark_charged_many', { p_ids: ids, p_by: by || 'Reception' })).then(r => { loaders.today(); return r; });
// reception: the days from..to + every order not charged yet, of any age (a room bill is paid at check-out)
export const fetchReception = (from, to) => must(sb.from('orders').select('*, order_lines(*)')
  .or(`and(day.gte.${from},day.lte.${to}),and(day.lt.${from},charged_at.is.null,status.eq.closed)`).order('closed_at', { ascending: true }).limit(10000));
export const setSheetUrl = url => must(sb.rpc('owner_set_sheet_url', { p_url: url }));
export const sheetStatus = () => must(sb.rpc('owner_sheet_status'));
export const sheetTest = () => must(sb.rpc('owner_sheet_test'));

export const openedMs = row => ms(row?.opened_at);
