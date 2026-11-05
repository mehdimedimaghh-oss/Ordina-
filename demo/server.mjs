// DEMO ONLY (for promo videos): a tiny stand-in for Supabase that runs the app's REAL SQL
// (supabase/migrations) on a local Postgres, so the demo behaves exactly like the real app.
// Used by demo/vite.config.js. Never deployed.
import pg from 'pg';

const DB = process.env.DEMO_DB || 'postgresql://postgres@localhost:55432/demo?host=/var/tmp/demopg';
// answer like Supabase: dates as 'YYYY-MM-DD', numbers as numbers
pg.types.setTypeParser(1082, v => v);
pg.types.setTypeParser(1700, v => (v == null ? null : parseFloat(v)));
pg.types.setTypeParser(20, v => (v == null ? null : Number(v)));
const pool = new pg.Pool({ connectionString: DB, max: 8 });

export const USERS = {
  'staff@demo.app': { id: '00000000-0000-0000-0000-00000000aa01', pw: 'demo', role: 'staff' },
  'reception@demo.app': { id: '00000000-0000-0000-0000-00000000aa02', pw: 'demo', role: 'reception' },
  'owner@demo.app': { id: '00000000-0000-0000-0000-00000000aa03', pw: 'demo', role: 'owner' },
};
const byId = Object.fromEntries(Object.entries(USERS).map(([email, u]) => [u.id, { ...u, email }]));

// run one statement as the logged-in user, with the real Row Level Security
async function asUser(uid, sql, params) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    if (uid) {
      const u = byId[uid];
      await c.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true), set_config('request.jwt.claim.role', 'authenticated', true)`,
        [uid, JSON.stringify({ sub: uid, email: u?.email, role: 'authenticated' })]);
      await c.query('set local role authenticated');
    } else await c.query('set local role anon');
    const r = await c.query(sql, params);
    await c.query('commit');
    return r;
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; }
  finally { c.release(); }
}

const ident = s => { if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw new Error('bad name ' + s); return '"' + s + '"'; };

// filters coming from the client query builder
function where(filters, params) {
  const parts = [];
  const val = v => { params.push(v); return '$' + params.length; };
  const one = f => {
    const c = 't.' + ident(f.col);
    if (f.op === 'eq') return `${c} = ${val(f.v)}`;
    if (f.op === 'gte') return `${c} >= ${val(f.v)}`;
    if (f.op === 'lte') return `${c} <= ${val(f.v)}`;
    if (f.op === 'lt') return `${c} < ${val(f.v)}`;
    if (f.op === 'gt') return `${c} > ${val(f.v)}`;
    if (f.op === 'is') return `${c} is ${f.v === 'null' || f.v === null ? 'null' : 'not null'}`;
    throw new Error('op ' + f.op);
  };
  for (const f of filters) {
    if (f.op === 'or') parts.push('(' + f.groups.map(g => '(' + g.map(one).join(' and ') + ')').join(' or ') + ')');
    else parts.push(one(f));
  }
  return parts.length ? ' where ' + parts.join(' and ') : '';
}

async function query(uid, q) {
  const table = 'public.' + ident(q.table);
  const params = [];
  if (q.kind === 'select') {
    const cols = (q.columns || '*').replace(/\s/g, '');
    let sel = 't.*';
    const nested = [];
    for (const part of cols.split(',')) {
      const m = part.match(/^([a-z_]+)\(\*\)$/);
      if (m) nested.push(m[1]);
      else if (part !== '*') sel = sel === 't.*' ? 't.' + ident(part) : sel + ', t.' + ident(part);
    }
    if (cols.split(',').every(p => p !== '*' && !/\(/.test(p))) sel = cols.split(',').map(p => 't.' + ident(p)).join(', ');
    for (const n of nested) sel += `, coalesce((select json_agg(l order by l.pos) from public.${ident(n)} l where l.order_id = t.id), '[]') as ${ident(n)}`;
    let sql = `select ${sel} from ${table} t` + where(q.filters || [], params);
    if (q.order?.length) sql += ' order by ' + q.order.map(o => 't.' + ident(o.col) + (o.asc === false ? ' desc' : ' asc')).join(', ');
    if (q.range) sql += ` offset ${+q.range[0]} limit ${+q.range[1] - +q.range[0] + 1}`;
    else if (q.limit) sql += ` limit ${+q.limit}`;
    const r = await asUser(uid, sql, params);
    return q.single ? (r.rows[0] || null) : r.rows;
  }
  if (q.kind === 'update') {
    const keys = Object.keys(q.values);
    const set = keys.map(k => `${ident(k)} = $${params.push(q.values[k])}`).join(', ');
    const r = await asUser(uid, `update ${table} t set ${set}` + where(q.filters || [], params) + ' returning t.*', params);
    return r.rows;
  }
  if (q.kind === 'insert') {
    const rows = Array.isArray(q.values) ? q.values : [q.values];
    const keys = Object.keys(rows[0]);
    const vals = rows.map(row => '(' + keys.map(k => '$' + params.push(row[k])).join(', ') + ')').join(', ');
    const r = await asUser(uid, `insert into ${table} as t (${keys.map(ident).join(', ')}) values ${vals} returning t.*`, params);
    return r.rows;
  }
  throw new Error('kind ' + q.kind);
}

// call a real SQL function by name (arguments by name, like PostgREST)
const argTypes = new Map();
async function rpc(uid, name, args) {
  if (!argTypes.has(name)) {
    const r = await pool.query(`select p.proargnames, array(select format_type(t, null) from unnest(p.proargtypes) t) as types, p.pronargs
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1 order by p.pronargs desc limit 1`, [ident(name).slice(1, -1)]);
    if (!r.rows[0]) throw Object.assign(new Error(`function ${name} not found`), { code: 'PGRST202' });
    argTypes.set(name, r.rows[0]);
  }
  const { proargnames, types } = argTypes.get(name);
  const params = [], list = [];
  (proargnames || []).slice(0, types.length).forEach((a, i) => {
    if (args && a in args) { params.push(types[i] === 'jsonb' ? JSON.stringify(args[a]) : args[a]); list.push(`${ident(a)} => $${params.length}::${types[i]}`); }
  });
  const r = await asUser(uid, `select to_jsonb(public.${ident(name)}(${list.join(', ')})) as v`, params);
  return r.rows[0]?.v ?? null;
}

// live updates: every page keeps a connection open (Server-Sent Events)
const clients = new Set();
const presence = new Map();   // device key -> meta
function broadcast(msg) { const s = `data: ${JSON.stringify(msg)}\n\n`; for (const c of clients) c.write(s); }
const WRITES = { open_tables: 1, stock: 1, orders: 1, menu_items: 1, settings: 1, rooftop_chairs: 1, rooftop_tables: 1 };
const touched = () => broadcast({ type: 'change', tables: Object.keys(WRITES) });

const body = req => new Promise((ok, no) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { no(e); } }); });

export function demoApi() {
  return {
    name: 'demo-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/demo-api/')) return next();
        const send = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
        try {
          if (req.url === '/demo-api/events') {
            res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
            res.write(`data: ${JSON.stringify({ type: 'presence', state: Object.fromEntries(presence) })}\n\n`);
            clients.add(res); req.on('close', () => clients.delete(res));
            return;
          }
          const b = await body(req);
          if (req.url === '/demo-api/login') {
            const u = USERS[(b.email || '').toLowerCase()];
            if (!u || u.pw !== b.password) return send(400, { error: { message: 'Invalid login credentials' } });
            return send(200, { data: { session: { access_token: 'demo-' + u.id, user: { id: u.id, email: b.email.toLowerCase() } } } });
          }
          if (req.url === '/demo-api/query') {
            const data = await query(b.uid, b.q);
            if (b.q.kind !== 'select') touched();
            return send(200, { data });
          }
          if (req.url === '/demo-api/rpc') {
            const data = await rpc(b.uid, b.name, b.args);
            if (!/^(waiter_login|reception_|owner_sheet_status|my_role)/.test(b.name)) touched();
            return send(200, { data });
          }
          if (req.url === '/demo-api/presence') {
            if (b.meta) presence.set(b.key, [b.meta]); else presence.delete(b.key);
            broadcast({ type: 'presence', state: Object.fromEntries(presence) });
            return send(200, { data: null });
          }
          send(404, { error: { message: 'not found' } });
        } catch (e) {
          send(200, { error: { message: e.message, code: e.code || 'P0001' } });
        }
      });
    },
  };
}
