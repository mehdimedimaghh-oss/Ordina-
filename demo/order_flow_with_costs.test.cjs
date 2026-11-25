// Regression: the normal service still works with purchase costs installed (demo app).
// A waiter sends an order with the real waiter screen; reception gets it; the owner's margins include it.
// node demo/order_flow_with_costs.test.cjs <folder for screenshots>
const { chromium, devices } = require('playwright');
const { execSync } = require('child_process');
const OUT = process.argv[2];
const A = 'http://localhost:5199/';
const PSQL = 'psql -h /var/tmp/demopg -p 55432 -U postgres -d demo';
const sql = q => execSync(`${PSQL} -tAc "${q}"`).toString().trim();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ✓' : '  ✗', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const owner = q => JSON.parse(execSync(`${PSQL} -tA`, { input: `begin; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000aa03',true); set local role authenticated; ${q}; rollback;` }).toString().split('\n').find(l => l.startsWith('{')));

(async () => {
  const b = await chromium.launch(); const errs = [];
  const mk = async (opts = {}) => { const c = await b.newContext({ viewport: { width: 1280, height: 900 }, ...opts }); const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept()); return { c, p }; };
  const today = sql("select (now() at time zone 'Europe/Rome')::date");
  const free = sql('select min(n) from generate_series(1,30) n where not exists (select 1 from open_tables t where t.table_no = n and t.data->\'items\' <> \'{}\'::jsonb)');
  const p0 = owner(`select public.owner_profit('${today}','${today}')`);
  const n0 = +sql(`select count(*) from orders where day='${today}' and status='closed'`);

  console.log('WAITER SENDS AN ORDER (normal service)');
  const w = await mk(devices['iPhone 13']);
  await w.p.goto(A); await w.p.fill('#lp', 'demo'); await w.p.click('button[type=submit]'); await w.p.click('.wpick:has-text("Sara")'); for (const k of '1234') await w.p.click(`.keys [data-k="${k}"]`);
  await sleep(1500);
  await w.p.click('#tableBtn'); await w.p.waitForSelector(`.tg[data-t="${free}"]`); await w.p.click(`.tg[data-t="${free}"]`);
  await sleep(500);
  for (const id of ['ravioli', 'ravioli', 'spritz-pesca', 'aperol']) { const c = w.p.locator(`.cell[data-id="${id}"] .card`); if (await c.count()) { await c.first().scrollIntoViewIfNeeded(); await c.first().click(); await sleep(150); } }
  await w.p.click('#barBtn'); await sleep(600);
  await w.p.screenshot({ path: OUT + '/flow_waiter_order.png' });
  await w.p.waitForSelector('#orderSheet:not([hidden]) #closeBtn');
  await w.p.click('#orderSheet [data-cov="1"]'); await sleep(300); await w.p.click('#orderSheet [data-cov="1"]'); await sleep(600);   // 2 guests
  await w.p.click('#orderSheet #closeBtn');
  for (let i = 0; i < 40 && +sql(`select count(*) from orders where day='${today}' and status='closed'`) === n0; i++) await sleep(250);
  const n1 = +sql(`select count(*) from orders where day='${today}' and status='closed'`);
  ok(n1 === n0 + 1, `order sent and saved as before (${n0} → ${n1} orders today)`);
  const last = sql(`select table_no||'|'||waiter_name||'|'||total from orders where day='${today}' order by id desc limit 1`);
  ok(last.startsWith(`${free}|Sara|`), 'saved on table ' + free + ' by Sara, total € ' + last.split('|')[2]);
  ok(sql(`select count(*) from order_lines l join orders o on o.id=l.order_id where o.id=(select max(id) from orders) and l.item_id='ravioli' and l.qty=2 and l.price=(select price from menu_items where id='ravioli')`) === '1', 'order line keeps the menu selling price (2× Ravioli at the menu price)');

  console.log('RECEPTION GETS IT');
  const r = await mk(); await r.p.goto(A); await r.p.click('[data-k="reception"]'); await r.p.fill('#le', 'reception@demo.app'); await r.p.fill('#lp', 'demo'); await r.p.click('button[type=submit]'); await sleep(3000);
  ok(new RegExp(`Tavolo\\s*${free}|Table\\s*${free}|\\b${free}\\b`).test(await r.p.evaluate(() => document.body.innerText)), 'reception screen shows the new order');
  ok(!/Food cost|Margine|Gross margin|Costo di acquisto/.test(await r.p.evaluate(() => document.body.innerText)), 'reception shows no cost information');

  console.log('OWNER MARGINS INCLUDE IT');
  const p1 = owner(`select public.owner_profit('${today}','${today}')`);
  const tot = +sql(`select coalesce(sum(total),0) from orders where day='${today}' and status='closed'`);
  ok(Math.abs(p1.totals.revenue_gross - tot) < 0.005, `today's revenue in the margins = dashboard total (€ ${tot.toFixed(2)})`);
  const rv = p1.items.find(i => i.item_id === 'ravioli'), rv0 = p0.items.find(i => i.item_id === 'ravioli');
  ok(rv && rv.qty === (rv0 ? rv0.qty : 0) + 2 && rv.known_qty === rv.qty, 'the 2 Ravioli are counted with today\'s cost (' + (rv && rv.unit_cost) + ' each)');
  ok(p1.totals.cost > (p0.totals.cost || 0), `purchase cost of today went up (€ ${p0.totals.cost} → € ${p1.totals.cost})`);

  console.log(`\n${pass} passed, ${fail} failed · page errors: ${errs.length ? errs.join(' | ') : 'none'}`);
  await b.close();
})();
