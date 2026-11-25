// Reception sees the staff schedule (read only): browser test in the demo app.
// node demo/reception_schedule_e2e.test.cjs <folder for screenshots>
const { chromium, devices } = require('playwright');
const { execSync } = require('child_process');
const OUT = process.argv[2];
const A = 'http://localhost:5199/';
const sql = q => execSync(`psql -h /var/tmp/demopg -p 55432 -U postgres -d demo -tAc "${q}"`).toString().trim();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ✓' : '  ✗', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await chromium.launch(); const errs = [];
  const mk = async (opts = {}) => { const c = await b.newContext({ viewport: { width: 1440, height: 900 }, ...opts }); const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept()); return { c, p }; };
  const login = async (p, who) => { await p.goto(A); await p.click(`[data-k="${who}"]`); await p.fill('#le', `${who}@demo.app`); await p.fill('#lp', 'demo'); await p.click('button[type=submit]'); };
  const day = sql("select (now() at time zone 'Europe/Rome')::date"), ym = day.slice(0, 7), dd = +day.slice(8);
  const dbNames = L => sql(`select coalesce(string_agg(person, ' + ' order by sort), '—') from staff_shifts where day='${day}' and shift='${L}'`);

  console.log('RECEPTION: WHO WORKS TODAY');
  const r = await mk(); await login(r.p, 'reception'); await r.p.waitForSelector('#rcpStaff .rs-grid', { timeout: 15000 });
  const rows = await r.p.$$eval('#rcpStaff .rs-row', x => x.map(y => [y.querySelector('.sc').textContent, y.querySelector('.rs-n').textContent]));
  const exp = ['M', 'C', 'P', 'R'].map(L => [L, dbNames(L)]);
  ok(JSON.stringify(rows) === JSON.stringify(exp), `today ${day}: ` + rows.map(x => x.join(' ')).join(' · '));
  ok(/(On shift now|In servizio adesso)/.test(await r.p.innerText('#rcpStaff .rs-now')), 'shows who is on shift now: ' + (await r.p.innerText('#rcpStaff .rs-now')).replace(/\s+/g, ' '));
  ok((await r.p.$$('#rcpTabs [data-rtab]')).length === 3 && !!(await r.p.$('#recvList')), 'the 3 reception tabs and the order list are still there');
  await r.p.screenshot({ path: OUT + '/reception_box.png' });

  console.log('RECEPTION: WHOLE MONTH (read only)');
  await r.p.click('#rcpRota'); await r.p.waitForSelector('#rcpRotaSheet:not([hidden]) .rota-view');
  const months = await r.p.$$eval('#rcpRotaSheet .rota-vh', x => x.map(y => y.innerText));
  ok(months.length === 2, 'this month and next month: ' + months.join(' + '));
  ok((await r.p.$$('#rcpRotaSheet .cb, #rcpRotaSheet [data-del], #rcpRotaSheet [data-up], #rcpRotaSheet #rSave, #rcpRotaSheet input')).length === 0, 'no edit buttons or fields (read only)');
  ok(await r.p.$eval('#rcpRotaSheet', x => /Nuova risorsa/.test(x.innerText) && !!x.querySelector('.rota-legend')), 'whole team incl. people without app account + legend M/C/P/R');
  await r.p.screenshot({ path: OUT + '/reception_month.png' });

  console.log('LIVE: the owner changes today, reception updates by itself');
  const o = await mk(); await login(o.p, 'owner'); await o.p.waitForSelector('.otabs');
  await o.p.click('[data-tab="rota"]'); await o.p.waitForSelector('.rota-ed');
  await o.p.fill('#rMonth', ym); await o.p.dispatchEvent('#rMonth', 'change'); await sleep(800);
  const person = sql(`select person from staff_shifts where day='${day}' order by sort limit 1`);
  const before = sql(`select shift from staff_shifts where day='${day}' and person='${person}'`);
  const pi = await o.p.evaluate(n => [...document.querySelectorAll('.rota tbody tr[data-name]')].findIndex(tr => tr.dataset.name === n), person);
  const cell = () => o.p.evaluate(([n, d]) => { const tr = [...document.querySelectorAll('.rota tbody tr[data-name]')].find(x => x.dataset.name === n); return tr.querySelectorAll('td.c')[d - 1].textContent.trim(); }, [person, dd]);
  const target = before === 'R' ? 'M' : 'R';
  for (let i = 0; i < 6 && (await cell()) !== target; i++) { await o.p.click(`.cb[data-p="${pi}"][data-d="${dd}"]`); await sleep(80); }
  await o.p.click('#rSave'); await sleep(2500);
  const rowOf = L => r.p.$eval(`#rcpStaff .rs-row:has(.s-${L}) .rs-n`, x => x.textContent);
  ok((await rowOf(target)).includes(person), `${person} ${before} → ${target}: reception box updated live`);
  ok(await r.p.$eval('#rcpRotaSheet', x => !x.hidden), 'the open month stays open while it updates');
  // offline: the database cannot be reached, reception shows its saved copy
  await r.c.route('**/demo-api/query', q => /staff_/.test(q.request().postData() || '') ? q.abort() : q.continue());
  await r.p.reload(); await r.p.waitForSelector('#rcpStaff .rs-grid', { timeout: 15000 }); await sleep(1500);
  ok((await rowOf(target)).includes(person), 'offline (schedule unreachable): saved copy shown, with the latest change');
  await r.c.unroute('**/demo-api/query');
  // put it back
  for (let i = 0; i < 6 && (await cell()) !== before; i++) { await o.p.click(`.cb[data-p="${pi}"][data-d="${dd}"]`); await sleep(80); }
  await o.p.click('#rSave'); await sleep(1500);
  ok(sql(`select shift from staff_shifts where day='${day}' and person='${person}'`) === before, `schedule put back as it was (${person} ${before})`);

  console.log('RECEPTION CANNOT CHANGE IT (direct requests)');
  const api = (body, path) => r.p.evaluate(async ([bd, pa]) => { const s = JSON.parse(sessionStorage.getItem('demo-session')); const x = await fetch(pa, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid: s.user.id, ...bd }) }); return x.json(); }, [body, path]);
  const save = await api({ name: 'owner_save_month', args: { p_month: ym + '-01', p_people: [], p_cells: [], p_version: 1 } }, '/demo-api/rpc');
  ok(/owner/i.test(save.error?.message || ''), 'saving the schedule from reception refused: ' + (save.error?.message || 'ALLOWED'));
  const upd = await api({ q: { table: 'staff_shifts', kind: 'update', values: { shift: 'R' }, filters: [] } }, '/demo-api/query');
  ok(!!upd.error, 'changing shifts directly from reception refused: ' + (upd.error?.message || 'ALLOWED'));
  ok(!/Food cost|Costi e margini|Gross margin|Margine lordo/.test(await r.p.evaluate(() => document.body.innerText)), 'reception still shows no costs');

  console.log('WAITER: unchanged');
  const w = await mk(devices['iPhone 13']);
  await w.p.goto(A); await w.p.fill('#lp', 'demo'); await w.p.click('button[type=submit]'); await w.p.click('.wpick:has-text("Luca")'); for (const k of '1234') await w.p.click(`.keys [data-k="${k}"]`);
  await sleep(1500); await w.p.click('#moreBtn'); await sleep(300); await w.p.click('#mRota'); await sleep(600);
  ok((await w.p.$$('#rotaSheet .rota-vh')).length === 2, "waiters' Turni del personale works as before");

  const ph = await mk(devices['iPhone 13']); await login(ph.p, 'reception'); await ph.p.waitForSelector('#rcpStaff .rs-grid', { timeout: 15000 });
  ok(await ph.p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'reception on a phone: no sideways scrolling');
  await ph.p.screenshot({ path: OUT + '/reception_phone.png' });

  console.log(`\n${pass} passed, ${fail} failed · page errors: ${errs.length ? errs.join(' | ') : 'none'}`);
  await b.close();
})();
