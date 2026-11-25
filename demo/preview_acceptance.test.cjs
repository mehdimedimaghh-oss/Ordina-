// Acceptance test before the production merge of Purchase Costs (TEST DATABASE ONLY, invented data).
// Starts from the same state as production after step 19: 0 costs, no VAT rate, not confirmed.
// node demo/preview_acceptance.test.cjs <folder for screenshots>
const { chromium, devices } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const { unzipSync, strFromU8 } = require('fflate');
const OUT = process.argv[2];
const A = 'http://localhost:5199/';
const PSQL = 'psql -h /var/tmp/demopg -p 55432 -U postgres -d demo';
const sql = q => execSync(`${PSQL} -tAc "${q}"`).toString().trim();
const asOwner = q => JSON.parse(execSync(`${PSQL} -tA`, { input: `begin; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000aa03',true); set local role authenticated; ${q}; rollback;` }).toString().split('\n').find(l => l.startsWith('{')));
let pass = 0, fail = 0; const failed = [];
const ok = (c, m) => { c ? pass++ : (fail++, failed.push(m)); console.log(c ? '  ✓' : '  ✗', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const eur = n => '€ ' + Number(n).toFixed(2).replace('.', ',');

(async () => {
  // same state as production right after step 19
  fs.writeFileSync(OUT + '/reset.sql', `truncate public.item_costs, public.item_finance restart identity;
update public.finance_settings set value = case key when 'sales_vat_sections' then '{}'::jsonb when 'vat_status' then '{"confirmed": false, "note": ""}'::jsonb else 'null'::jsonb end;`);
  execSync(`${PSQL} -q -f ${OUT}/reset.sql`);
  const fp = { menu: sql("select md5(string_agg(id||'|'||price||'|'||name_it||'|'||hidden, ',' order by id)) from menu_items"), shifts: sql("select md5(string_agg(s::text, ',' order by id)) from staff_shifts s") };
  const b = await chromium.launch(); const errs = [];
  const mk = async (opts = {}) => { const c = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, ...opts }); const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept()); return { c, p }; };
  const login = async (p, who) => { await p.goto(A); await p.click(`[data-k="${who}"]`); await p.fill('#le', `${who}@demo.app`); await p.fill('#lp', 'demo'); await p.click('button[type=submit]'); };
  const toast = async p => { await sleep(900); return (await p.locator('.toast').innerText().catch(() => '')).trim(); };

  console.log('START STATE (= production after step 19)');
  ok(sql('select count(*) from item_costs') === '0' && sql('select count(*) from finance_settings') === '4' && sql("select value->>'confirmed' from finance_settings where key='vat_status'") === 'false', 'costs 0 · settings 4 · VAT confirmed false');

  console.log('1. COSTS & MARGINS LOADS');
  const o = await mk(); await login(o.p, 'owner'); await o.p.waitForSelector('.otabs');
  await o.p.click('[data-tab="costs"]'); await o.p.waitForSelector('.crow[data-cost]');
  const k = await o.p.$$eval('.fin-k .kpi b', x => x.map(y => y.innerText));
  ok(/PROVISIONAL|PROVVISORIO/.test(await o.p.innerText('.fin-band')), 'orange PROVISIONAL banner shown');
  ok(/^0 \//.test(k[0]) && +k[1] === +sql('select count(*) from menu_items where not hidden and id <> \'pinsa-base\''), `dishes with a cost ${k[0]} · missing ${k[1]} (every dish on the menu)`);
  ok(await o.p.$eval('.fin-vat', d => d.open) && (await o.p.$$eval('.fin-vat input[type=text]', x => x.filter(i => i.value).length)) === 0, 'VAT panel open, every rate EMPTY (nothing assumed)');
  await o.p.screenshot({ path: OUT + '/1_costs_page.png' });

  console.log('2. RAVIOLI €23,44 ÷ 8');
  await o.p.click('.crow[data-cost="ravioli"]'); await o.p.waitForSelector('#cForm');
  await o.p.fill('#cInv', '2026-11-04'); await o.p.fill('#cSup', 'Gioia SpA'); await o.p.fill('#cRef', '003636/010');
  await o.p.click('[data-cm="pack"]'); await o.p.fill('#cPack', '23,44'); await o.p.fill('#cUnits', '8');
  const live = (await o.p.innerText('#cPackOut')).replace(/\s+/g, ' ');
  ok(/€ 2,93/.test(live), 'calculator shows: ' + live);
  ok(await o.p.inputValue('#cFrom') === '2026-11-04', 'valid from = invoice date 04/11/2026');
  await o.p.screenshot({ path: OUT + '/2_ravioli_form.png' });
  await o.p.click('#cSave'); const t = await toast(o.p);
  ok(/2,93/.test(t) && /04\/11\/2026/.test(t), 'saved: ' + t);

  console.log('3. REFRESH: THE COST STAYS');
  await o.p.reload(); await o.p.waitForSelector('.otabs');
  await o.p.click('[data-tab="costs"]'); await o.p.waitForSelector('.crow[data-cost="ravioli"]');
  const row = (await o.p.innerText('.crow[data-cost="ravioli"]')).replace(/\s+/g, ' ');
  ok(/€ 2,93/.test(row) && /Gioia SpA/.test(row) && /04\/11\/2026/.test(row), 'after reload the Ravioli row shows: ' + row);
  await o.p.click('.crow[data-cost="ravioli"]'); await o.p.waitForSelector('#cForm');
  const hist = (await o.p.innerText('#costSheet .hist-t')).replace(/\s+/g, ' ');
  ok(/€ 2,93 from 04\/11\/2026|€ 2,93 dal 04\/11\/2026/.test(hist) && /23,44 ÷ 8/.test(hist) && /003636\/010/.test(hist), 'history: ' + hist.slice(0, 110));
  ok(sql("select cost||'|'||pack_cost||'|'||pack_units||'|'||valid_from||'|'||invoice_date||'|'||supplier||'|'||invoice_ref||'|'||coalesce(purchase_vat::text,'-') from item_costs where item_id='ravioli'") === '2.9300|23.4400|8|2026-11-04|2026-11-04|Gioia SpA|003636/010|-', 'database row: € 2,93 = 23,44 ÷ 8, from 04/11, Gioia SpA, invoice 003636/010');
  await sleep(700); await o.p.$eval('#costSheet .hist-t', e => e.scrollIntoView({ block: 'center' })); await sleep(300);
  await o.p.screenshot({ path: OUT + '/3_after_refresh.png' });
  await o.p.click('#costSheet [data-close]');

  console.log('4. MARGINS: MISSING COSTS ARE NEVER ZERO');
  const from = '2026-11-01', to = '2026-11-30';
  // a) no sales VAT rate yet (like production now): nothing is invented
  const p0 = asOwner(`select public.owner_profit('${from}','${to}')`);
  ok(p0.provisional === true && p0.totals.known_net === 0 && p0.totals.cost === 0 && p0.totals.margin === 0 && p0.totals.coverage_pct === 0, 'without a sales VAT rate: no margin calculated at all (0% calculated), provisional');
  ok(p0.totals.gross_no_vat === p0.totals.dishes_gross, `all ${eur(p0.totals.dishes_gross)} of dish sales reported as "VAT rate missing"`);
  await o.p.click('[data-tab="dash"]'); await o.p.click('[data-mode="month"]'); await o.p.waitForSelector('.fin-dash .kpis', { timeout: 15000 });
  const d0 = await o.p.innerText('.fin-dash');
  ok(/no sales VAT rate|senza aliquota IVA/i.test(d0) && /without a purchase cost|senza costo di acquisto/i.test(d0), 'dashboard warns: dishes without purchase cost + dishes without sales VAT rate');
  await o.p.$eval('.fin-dash', e => e.scrollIntoView()); await sleep(200); await o.p.screenshot({ path: OUT + '/4a_margins_no_vat.png' });
  // b) a TEST sales VAT rate for first courses only (test database; NOT a real rate)
  execSync(PSQL + ' -tA', { input: "begin; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000aa03',true); set local role authenticated; select public.owner_set_vat('{\"sales_sections\":{\"primi\":10}}'); commit;" });
  const p1 = asOwner(`select public.owner_profit('${from}','${to}')`);
  const rv = p1.items.find(i => i.item_id === 'ravioli');
  const exp = JSON.parse(sql(`select json_build_object('qty', sum(l.qty), 'gross', sum(l.qty*l.price), 'net', round(sum(l.qty*l.price/1.10),2), 'cost', round(sum(l.qty)*2.93,2)) from order_lines l join orders o on o.id=l.order_id where o.status='closed' and o.day between '${from}' and '${to}' and split_part(l.item_id,'~',1)='ravioli' and o.day >= '2026-11-04'`));
  ok(rv.qty_no_cost === rv.qty - exp.qty, `Ravioli sold before 04/11 (${rv.qty_no_cost}) have NO cost: reported missing, not €0`);
  ok(Math.abs(rv.cost - exp.cost) < 0.01 && rv.known_qty === exp.qty, `Ravioli from 04/11: ${exp.qty} × € 2,93 = ${eur(exp.cost)} (app: ${eur(rv.cost)})`);
  ok(Math.abs(rv.margin - (exp.net - exp.cost)) < 0.02 && Math.abs(rv.food_cost_pct - exp.cost / exp.net * 100) < 0.1, `Ravioli margin ${eur(rv.margin)} = revenue VAT excl. ${eur(exp.net)} − cost ${eur(exp.cost)} · food cost ${String(rv.food_cost_pct).replace('.', ',')}%`);
  ok(Math.abs(p1.totals.cost - rv.cost) < 0.005 && Math.abs(p1.totals.margin - rv.margin) < 0.005, `total margin = Ravioli only (${eur(p1.totals.margin)}); the other dishes are NOT counted with cost €0`);
  ok(p1.totals.margin < p1.totals.dishes_gross / 10, `(if missing costs were €0 the margin would be about ${eur(p1.totals.dishes_gross / 1.1)}: it is not)`);
  ok(p1.items.filter(i => i.item_id !== 'ravioli' && i.qty > 0).every(i => i.cost == null && i.margin == null && i.qty_no_cost === i.qty), 'every other dish: cost empty, margin empty, all servings listed as "cost missing"');
  ok(Math.abs(p1.totals.revenue_gross - +sql(`select sum(total) from orders where status='closed' and day between '${from}' and '${to}'`)) < 0.005, `takings ${eur(p1.totals.revenue_gross)} = dashboard total (nothing lost or added)`);
  await o.p.reload(); await o.p.waitForSelector('.otabs'); await o.p.click('[data-tab="dash"]'); await o.p.click('[data-mode="month"]'); await o.p.waitForSelector('.fin-dash .kpis', { timeout: 15000 });
  const kp = await o.p.$$eval('.fin-dash .kpi b', x => x.map(y => y.innerText));
  ok(kp[1] === eur(p1.totals.cost) && kp[2] === eur(p1.totals.margin), `dashboard shows cost ${kp[1]}, margin ${kp[2]}, calculated on ${kp[4]} (same as server)`);
  await o.p.$eval('.fin-dash', e => e.scrollIntoView()); await sleep(200); await o.p.screenshot({ path: OUT + '/4b_margins_test_vat.png' });
  const [dl] = await Promise.all([o.p.waitForEvent('download'), o.p.click('#xlsx')]); const xf = OUT + '/margini_test.xlsx'; await dl.saveAs(xf);
  const s3 = strFromU8(unzipSync(fs.readFileSync(xf))['xl/worksheets/sheet3.xml']);
  const cells = name => { const r = s3.split('<row').find(x => x.includes(name)) || ''; return [...r.matchAll(/<c r="([A-Z]+)\d+"[^>]*>(?:<v>([^<]*)<\/v>|<is><t[^>]*>([^<]*)<\/t>)/g)].reduce((a, m) => (a[m[1]] = m[2] ?? m[3], a), {}); };
  const carb = cells('Spaghetti alla carbonara');
  ok(!carb.I && !carb.J && carb.I !== '0' && /cost missing|costo mancante/.test(carb.N || ''), 'Excel Margini: Carbonara has empty cost and margin, marked "cost missing"');
  ok(/PROVISIONAL|PROVVISORIO/.test(s3), 'Excel Margini starts with the PROVISIONAL note');

  console.log('5. WAITER AND RECEPTION: NO ACCESS');
  const api = (p, body, path) => p.evaluate(async ([bd, pa]) => { const s = JSON.parse(sessionStorage.getItem('demo-session')); const r = await fetch(pa, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid: s.user.id, ...bd }) }); return r.json(); }, [body, path]);
  for (const who of ['staff', 'reception']) {
    const d = await mk(who === 'staff' ? devices['iPhone 13'] : {}); const calls = [];
    d.p.on('request', q => { if (/item_costs|item_finance|finance_settings|owner_profit|owner_save_cost|owner_set_vat/.test(q.postData() || '')) calls.push(1); });
    if (who === 'staff') { await d.p.goto(A); await d.p.fill('#lp', 'demo'); await d.p.click('button[type=submit]'); await d.p.click('.wpick:has-text("Luca")'); for (const c of '1234') await d.p.click(`.keys [data-k="${c}"]`); await sleep(1500); }
    else { await login(d.p, 'reception'); await sleep(2500); }
    const name = who === 'staff' ? 'waiter' : 'reception';
    ok(!/Costs & margins|Costi e margini|Food cost|Gross margin|Margine lordo|2,93/.test(await d.p.evaluate(() => document.body.innerText)), `${name}: nothing about costs or margins on screen`);
    ok(calls.length === 0, `${name}: the app never requests cost data`);
    const reads = await Promise.all(['item_costs', 'item_finance', 'finance_settings'].map(tb => api(d.p, { q: { table: tb, kind: 'select', columns: '*', filters: [], order: [] } }, '/demo-api/query')));
    ok(reads.every(r => Array.isArray(r.data) && r.data.length === 0), `${name}: reading the 3 cost tables directly → 0 rows`);
    const rp = await Promise.all([['owner_profit', { p_from: from, p_to: to }], ['owner_save_cost', { p: { item_id: 'ravioli', cost: 0, valid_from: '2026-11-05' } }], ['owner_set_vat', { p: { sales_default: 4 } }], ['owner_void_cost', { p_id: 1, p_reason: 'test' }]].map(([n, a]) => api(d.p, { name: n, args: a }, '/demo-api/rpc')));
    ok(rp.every(r => /Only the owner/.test(r.error?.message || '')), `${name}: margins, save, VAT, cancel → all refused ("Only the owner can do this.")`);
    await d.p.screenshot({ path: OUT + `/5_${name}.png` });
  }
  ok(sql("select count(*) from item_costs where item_id='ravioli' and voided_at is null") === '1' && sql("select cost from item_costs where item_id='ravioli'") === '2.9300', 'Ravioli cost untouched after the attempts (still € 2,93)');

  console.log(`\n${pass} passed, ${fail} failed${failed.length ? ' → ' + failed.join(' | ') : ''} · page errors: ${errs.length ? errs.join(' | ') : 'none'}`);
  ok(sql("select md5(string_agg(id||'|'||price||'|'||name_it||'|'||hidden, ',' order by id)) from menu_items") === fp.menu, 'menu selling prices unchanged');
  ok(sql("select md5(string_agg(s::text, ',' order by id)) from staff_shifts s") === fp.shifts, 'staff schedule unchanged');
  console.log(`FINAL ${pass} passed, ${fail} failed`);
  await b.close();
})();
