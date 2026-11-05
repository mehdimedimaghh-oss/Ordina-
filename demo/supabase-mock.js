// DEMO ONLY: replaces '@supabase/supabase-js' in the demo build (see demo/vite.config.js).
// Same calls the app uses, answered by demo/server.mjs (real SQL on a local database).
const KEY = 'demo-session';
const getS = () => { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; } };
const setS = s => { try { s ? sessionStorage.setItem(KEY, JSON.stringify(s)) : sessionStorage.removeItem(KEY); } catch { /* ignore */ } };

async function post(path, payload) {
  try {
    const r = await fetch('/demo-api/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    return await r.json();
  } catch (e) { return { error: { message: 'fetch failed: ' + e.message } }; }
}

// "and(day.gte.2026-01-01,day.lte.2026-01-31),and(...)" -> [[{col,op,v}...], ...]
function parseOr(s) {
  const groups = [];
  for (const m of s.matchAll(/and\(([^)]*)\)/g)) groups.push(m[1].split(',').map(p => { const [col, op, ...v] = p.split('.'); return { col, op, v: v.join('.') }; }));
  return groups;
}

class Query {
  constructor(table) { this.q = { table, kind: 'select', filters: [], order: [] }; }
  select(columns) { if (this.q.kind === 'select') this.q.columns = columns || '*'; return this; }
  insert(values) { this.q.kind = 'insert'; this.q.values = values; return this; }
  update(values) { this.q.kind = 'update'; this.q.values = values; return this; }
  eq(col, v) { this.q.filters.push({ col, op: 'eq', v }); return this; }
  gte(col, v) { this.q.filters.push({ col, op: 'gte', v }); return this; }
  lte(col, v) { this.q.filters.push({ col, op: 'lte', v }); return this; }
  lt(col, v) { this.q.filters.push({ col, op: 'lt', v }); return this; }
  gt(col, v) { this.q.filters.push({ col, op: 'gt', v }); return this; }
  is(col, v) { this.q.filters.push({ col, op: 'is', v }); return this; }
  or(s) { this.q.filters.push({ op: 'or', groups: parseOr(s) }); return this; }
  order(col, o) { this.q.order.push({ col, asc: o?.ascending !== false }); return this; }
  range(a, b) { this.q.range = [a, b]; return this; }
  limit(n) { this.q.limit = n; return this; }
  maybeSingle() { this.q.single = true; return this; }
  then(ok, no) { return post('query', { uid: getS()?.user?.id, q: this.q }).then(r => ({ data: r.data ?? null, error: r.error || null })).then(ok, no); }
}

// one shared live connection per page
let es = null; const chans = new Set();
function live() {
  if (es) return;
  es = new EventSource('/demo-api/events');
  es.onmessage = ev => {
    const m = JSON.parse(ev.data);
    for (const ch of chans) ch._msg(m);
  };
}

class Channel {
  constructor(name, opts) { this.key = opts?.config?.presence?.key || Math.random().toString(36).slice(2); this.h = []; this.state = 'closed'; this.pstate = {}; }
  on(type, filter, fn) { this.h.push({ type, filter, fn }); return this; }
  subscribe(cb) {
    chans.add(this); live(); this.state = 'joined';
    setTimeout(() => cb && cb('SUBSCRIBED'), 50);
    return this;
  }
  _msg(m) {
    if (m.type === 'presence') { this.pstate = m.state; this.h.filter(x => x.type === 'presence').forEach(x => x.fn()); }
    if (m.type === 'change') this.h.filter(x => x.type === 'postgres_changes' && m.tables.includes(x.filter.table)).forEach(x => x.fn({}));
  }
  presenceState() { return this.pstate; }
  track(meta) { return post('presence', { key: this.key, meta }); }
  untrack() { return post('presence', { key: this.key, meta: null }); }
}

export function createClient() {
  const listeners = new Set();
  return {
    from: t => new Query(t),
    rpc: (name, args) => post('rpc', { uid: getS()?.user?.id, name, args }).then(r => ({ data: r.data ?? null, error: r.error || null })),
    channel: (name, opts) => new Channel(name, opts),
    removeChannel: ch => { chans.delete(ch); ch.untrack?.(); ch.state = 'closed'; },
    realtime: { connect() {} },
    auth: {
      getSession: async () => ({ data: { session: getS() } }),
      onAuthStateChange: fn => { listeners.add(fn); return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } }; },
      signInWithPassword: async ({ email, password }) => {
        const r = await post('login', { email, password });
        if (r.error) return { data: null, error: r.error };
        setS(r.data.session); listeners.forEach(f => f('SIGNED_IN', r.data.session));
        return { data: r.data, error: null };
      },
      signOut: async () => { setS(null); listeners.forEach(f => f('SIGNED_OUT', null)); return { error: null }; },
      refreshSession: async () => ({ data: { session: getS() } }),
    },
  };
}
