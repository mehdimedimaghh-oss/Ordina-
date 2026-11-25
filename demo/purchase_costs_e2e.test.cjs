// End-to-end test of Purchase Costs & Margins in the demo app (fake brand, local demo database).
// Before: demo/seed_costs.sql is run again by this test (invented costs), so it can be run many times.
// node demo/purchase_costs_e2e.test.cjs <folder for screenshots and downloads>
const { chromium, devices } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const { unzipSync, strFromU8 } = require('fflate');
const OUT = process.argv[2];
const A = 'http://localhost:5199/';
const PSQL = 'psql -h /var/tmp/demopg -p 55432 -U postgres -d demo';
const sql = q => execSync(`${PSQL} -tAc "${q}"`).toString().trim();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ✓' : '  ✗', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MENU_MD5 = "select md5(string_agg(id || '|' || price || '|' || name_it || '|' || hidden, ',' order by id)) from menu_items";
const ORD_MD5 = "select md5(string_agg(o::text, ',' order by id)) from orders o";
const LINES_MD5 = "select md5(string_agg(l::text, ',' order by id)) from order_lines l";
const SHIFTS_MD5 = "select md5(string_agg(s::text, ',' order by id)) from staff_shifts s";

(async () => {
  execSync(`${PSQL} -q -f demo/seed_costs.sql`, { stdio: 'ignore' });
  const before = { menu: sql(MENU_MD5), orders: sql(ORD_MD5), lines: sql(LINES_MD5), shifts: sql(SHIFTS_MD5), audit: +sql('select max(id) from audit_log') };
  const b = await chromium.launch(); const errs = [];
  let promptAnswer = null; const dialogs = [];
  const mk = async (opts = {}) => {
    const c = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, ...opts }); const p = await c.newPage();
    p.on('pageerror', e => errs.push(e.message));
    p.on('dialog', d => { dialogs.push(d.message()); d.type() === 'prompt' ? d.accept(promptAnswer ?? '') : d.accept(); });
    return { c, p };
  };
  const login = async (p, who) => { await p.goto(A); await p.click(`[data-k="${who}"]`); await p.fill('#le', `${who}@demo.app`); await p.fill('#lp', 'demo'); await p.click('button[type=submit]'); };
  const toastText = async p => { await sleep(900); return (await p.locator('.toast').innerText().catch(() => '')).trim(); };

  // ======================= OWNER: COSTS TAB =======================
  console.log('OWNER · COSTS TAB');
  const o = await mk(); await login(o.p, 'owner'); await o.p.waitForSelector('.otabs');
  ok(!!(await o.p.$('[data-tab="costs"]')), 'owner has the new tab "Costs & margins"');
  await o.p.click('[data-tab="costs"]'); await o.p.waitForSelector('.crow[data-cost]');
  ok(/PROVISIONAL|PROVVISORIO/.test(await o.p.innerText('.fin-band')), 'banner: PROVISIONAL until the commercialista confirms the VAT rates');
  const kp = await o.p.$$eval('.fin-k .kpi b', x => x.map(y => y.innerText));
  ok(/^72 \//.test(kp[0]) && +kp[1] > 0, `dishes with a cost ${kp[0]} · missing on the menu ${kp[1]}`);
  ok(await o.p.$eval('.crow[data-cost="lasagne"]', r => /€ 13,00/.test(r.innerText) && /€ 3,4\d/.test(r.innerText)), 'Lasagne row: selling price € 13,00 (read only) and its cost per serving');
  ok((await o.p.$$('.crow input, .crow [contenteditable]')).length === 0, 'selling prices are not editable in the Costs tab');
  await o.p.screenshot({ path: OUT + '/costs_list.png', fullPage: false });
  await o.p.click('[data-filter="missing"]'); await sleep(200);
  const miss = await o.p.$$eval('.crow[data-cost]', x => x.map(y => y.dataset.cost));
  ok(miss.includes('parmigiana') && miss.includes('zuppa') && !miss.includes('lasagne'), 'filter "Missing cost": ' + miss.join(', '));
  await o.p.click('[data-filter="all"]');
  await o.p.click('[data-view="suppliers"]'); await sleep(200);
  const sup = await o.p.innerText('#finList');
  ok(/Surgelati Roma srl/i.test(sup) && /\+\d+(,\d)?%/.test(sup) && /Cantine Demo/i.test(sup), 'supplier price history: per supplier, with the price rise of 1 November (about +8%)');
  await o.p.screenshot({ path: OUT + '/costs_suppliers.png', fullPage: false });
  await o.p.click('[data-view="dishes"]');

  console.log('OWNER · ADD, CORRECT, CANCEL A COST');
  await o.p.click('.crow[data-cost="lasagne"]'); await o.p.waitForSelector('#cForm');
  ok((await o.p.$$('#costSheet .hrow')).length === 2, 'Lasagne history: 2 costs (September and the November price rise)');
  await o.p.fill('#cInv', '2026-11-20');
  ok(await o.p.inputValue('#cFrom') === '2026-11-20', '"Valid from" follows the supplier invoice date by default');
  await o.p.fill('#cFrom', '2026-11-22');
  await o.p.fill('#cInv', '2026-11-21');
  ok(await o.p.inputValue('#cFrom') === '2026-11-22', 'a "valid from" date written by hand is kept');
  await o.p.fill('#cCost', '3,80'); await o.p.fill('#cSup', 'Surgelati Roma srl'); await o.p.fill('#cRef', 'F-SUR-1121');
  dialogs.length = 0; await o.p.click('#cSave'); const t1 = await toastText(o.p);
  ok(dialogs.some(d => /22\/11\/2026/.test(d)), 'a date in the past asks for confirmation before changing past margins');
  ok(/3,80/.test(t1) && /22\/11\/2026/.test(t1), 'saved: ' + t1);
  ok(sql("select cost||'|'||valid_from||'|'||invoice_date from item_costs where item_id='lasagne' and voided_at is null order by valid_from desc limit 1") === '3.8000|2026-11-22|2026-11-21', 'database: € 3,80 valid from 22/11, invoice 21/11');
  // correction
  await o.p.click('#costSheet [data-corr]'); await o.p.waitForSelector('#cWhy');
  await o.p.fill('#cCost', '3,70'); await o.p.click('#cSave'); const t2 = await toastText(o.p);
  ok(/why|perché/i.test(t2), 'correction without a reason is refused: ' + t2);
  await o.p.fill('#cWhy', 'wrong number on the invoice'); await o.p.click('#cSave'); await toastText(o.p);
  ok(sql("select count(*) from item_costs where item_id='lasagne' and cost=3.8 and voided_at is not null and void_reason='wrong number on the invoice' and replaced_by is not null") === '1', 'old € 3,80 kept in the history, marked corrected, with the reason');
  ok(sql("select cost from item_costs where item_id='lasagne' and voided_at is null and valid_from='2026-11-22'") === '3.7000', 'new € 3,70 is the valid cost from 22/11');
  await o.p.screenshot({ path: OUT + '/costs_dish_history.png', fullPage: false });
  // cancel
  promptAnswer = 'typed for the wrong dish';
  await o.p.click('#costSheet [data-void]'); await toastText(o.p); promptAnswer = null;
  ok(sql("select count(*) from item_costs where item_id='lasagne' and cost=3.7 and voided_at is not null and void_reason='typed for the wrong dish'") === '1', 'cancel with a reason: kept in the history, no longer used');
  ok(await o.p.$eval('#costSheet', s => s.querySelectorAll('.hrow.void').length === 2), 'history shows the 2 corrected/cancelled rows crossed out');
  await o.p.click('#costSheet [data-close]');

  console.log('OWNER · PACK ÷ SERVINGS (food packs and wine by the glass)');
  // an invoice line like Gioia's: 2 packs × 4 portions, € 13,02 − 10% each = € 23,44 after discount, VAT excluded
  await o.p.click('.crow[data-cost="ravioli"]'); await o.p.waitForSelector('#cForm');
  ok(!!(await o.p.$('[data-cm="pack"]')) && /Pack ÷ servings|Confezione ÷ porzioni/.test(await o.p.innerText('[data-cm="pack"]')), 'the form offers "Pack ÷ servings"');
  await o.p.click('[data-cm="pack"]');
  ok(await o.p.inputValue('#cUnits') === '', 'no number of servings saved yet → field EMPTY (never assumed)');
  await o.p.fill('#cPack', '23,44'); await o.p.fill('#cUnits', '8');
  ok(/2,93/.test(await o.p.innerText('#cPackOut')), 'live result: ' + (await o.p.innerText('#cPackOut')).replace(/\s+/g, ' '));
  await o.p.fill('#cUnits', '0'); await o.p.fill('#cInv', '2026-11-04'); await o.p.fill('#cSup', 'Supplier A'); await o.p.fill('#cRef', '003636/010');
  await o.p.click('#cSave'); const t0 = await toastText(o.p);
  ok(/servings or units|porzioni o unità/i.test(t0), '0 servings refused: ' + t0);
  await o.p.fill('#cUnits', '8');
  await o.p.screenshot({ path: OUT + '/costs_pack_helper.png', fullPage: false });
  await o.p.click('#cSave'); await toastText(o.p);
  ok(sql("select cost||'|'||pack_cost||'|'||pack_units||'|'||valid_from||'|'||invoice_ref from item_costs where item_id='ravioli' and valid_from='2026-11-04' and voided_at is null") === '2.9300|23.4400|8|2026-11-04|003636/010', 'saved: € 23,44 ÷ 8 = € 2,93, valid from the invoice date, pack amount and servings kept');
  ok(/23,44 ÷ 8/.test(await o.p.innerText('#costSheet .hist-t')), 'history shows how it was calculated (€ 23,44 ÷ 8)');
  await o.p.click('#costSheet [data-close]');
  await o.p.click('.crow[data-cost="ravioli"]'); await o.p.waitForSelector('#cForm');
  ok(await o.p.$eval('[data-cm="pack"]', b => b.classList.contains('on')) && await o.p.inputValue('#cUnits') === '8', 'next time the dish opens on Pack ÷ servings with its 8 servings remembered');
  await o.p.click('#costSheet [data-close]');
  // wine by the glass is the same calculator: bottle amount ÷ glasses
  const gl = {};
  for (const id of ['gewurz-c', 'merlot-c', 'spum-c']) { await o.p.click(`.crow[data-cost="${id}"]`); await o.p.waitForSelector('#cForm'); gl[id] = await o.p.inputValue('#cUnits'); await o.p.click('#costSheet [data-close]'); }
  ok(gl['gewurz-c'] === '4' && gl['merlot-c'] === '5' && gl['spum-c'] === '6', `glasses remembered per bottle: Gewürztraminer ${gl['gewurz-c']}, Merlot ${gl['merlot-c']}, Spumante ${gl['spum-c']}`);
  await o.p.click('.crow[data-cost="birra-peroni"]'); await o.p.waitForSelector('#cForm');
  await o.p.click('[data-cm="pack"]');
  ok(await o.p.inputValue('#cUnits') === '', 'a bottle with no number saved: glasses field EMPTY (never assumed)');
  await o.p.fill('#cPack', '12'); await o.p.fill('#cUnits', '6');
  ok(/2,00/.test(await o.p.innerText('#cPackOut')), 'bottle € 12 ÷ 6 glasses: ' + (await o.p.innerText('#cPackOut')).replace(/\s+/g, ' '));
  await o.p.screenshot({ path: OUT + '/costs_glass_helper.png', fullPage: false });
  await o.p.fill('#cInv', '2026-11-25'); await o.p.fill('#cFrom', '2026-11-25'); await o.p.click('#cSave'); await toastText(o.p);
  ok(sql("select cost||'|'||pack_cost||'|'||pack_units from item_costs where item_id='birra-peroni' and valid_from='2026-11-25'") === '2.0000|12.0000|6', 'saved: € 12 ÷ 6 = € 2,00 per glass, bottle amount and glasses kept');
  await o.p.click('#costSheet [data-close]');
  // "I only have the price with VAT"
  await o.p.click('.crow[data-cost="tiramisu"]'); await o.p.waitForSelector('#cForm');
  await o.p.click('.fin-help summary'); await o.p.fill('#cGross', '3,66'); await o.p.fill('#cPv', '22'); await o.p.click('#cConv');
  ok(await o.p.inputValue('#cCost') === '3', 'price with VAT € 3,66 at 22% → € 3,00 without VAT (filled in, to check before saving)');
  await o.p.click('#costSheet [data-close]');

  console.log('OWNER · VAT');
  await o.p.click('.fin-vat summary');
  await o.p.check('#vConf'); await o.p.fill('#vNote', ''); await o.p.click('#vSave'); const t3 = await toastText(o.p);
  ok(/who confirmed|chi ha confermato/i.test(t3), 'cannot mark VAT confirmed without saying who/when');
  await o.p.fill('#vNote', 'Demo: Studio Commercialista, email 02/12/2026'); await o.p.click('#vSave'); await o.p.waitForSelector('.fin-band.ok');
  ok(/confirmed|confermate/i.test(await o.p.innerText('.fin-band')), 'confirmed with a note: banner shows who confirmed');
  await o.p.click('.crow[data-cost="tiramisu"]'); await o.p.waitForSelector('#cForm');
  await o.p.click('#costSheet .fin-vat summary'); await o.p.fill('#dSv', '22'); dialogs.length = 0; await o.p.click('#dVat'); await sleep(1200);
  ok(dialogs.some(d => /confirmed|conferma/i.test(d)), 'changing a rate warns that the confirmation will be removed');
  await o.p.click('#costSheet [data-close]'); await sleep(300);
  ok(/PROVISIONAL|PROVVISORIO/.test(await o.p.innerText('.fin-band')), 'after changing a rate: PROVISIONAL again');
  ok(sql("select sales_vat from item_finance where item_id='tiramisu'") === '22.00', 'Tiramisù has its own sales VAT rate (22%, demo)');
  // put the demo rates back as provisional
  await o.p.click('.fin-vat summary').catch(() => {}); await o.p.uncheck('#vConf'); await o.p.click('#vSave'); await sleep(800);

  // ======================= OWNER: DASHBOARD =======================
  console.log('OWNER · DASHBOARD MARGINS');
  await o.p.click('[data-tab="dash"]'); await o.p.click('[data-mode="month"]'); await o.p.waitForSelector('.fin-dash .kpis', { timeout: 15000 });
  const dash = await o.p.innerText('.fin-dash');
  ok(/PROVISIONAL|PROVVISORIO/.test(dash) && /margin[ea]?[^\n]*(provisional|provvisorio)/i.test(dash), 'margins panel marked PROVISIONAL');
  ok(/Gross margin|Margine lordo/i.test(dash) && /Food cost/i.test(dash) && /Purchase cost|Costo di acquisto/i.test(dash) && /VAT excl|IVA escl/i.test(dash), 'shows revenue without VAT, purchase cost, gross margin, food cost %');
  ok(/sold without a purchase cost|senza costo di acquisto/.test(dash), 'missing purchase cost warning with the amount not counted');
  ok((await o.p.$$('.fin-dash .two .mg-r')).length >= 6, 'best and worst products by margin listed');
  ok((await o.p.$$('.fin-dash .mg-l')).length >= 8, 'margin per section listed');
  const prof = JSON.parse(execSync(`${PSQL} -tA`, { input: "begin; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000aa03',true); set local role authenticated; select public.owner_profit('2026-11-01','2026-11-30'); rollback;" }).toString().split('\n').find(l => l.startsWith('{')));
  const kpiTxt = await o.p.$$eval('.fin-dash .kpi b', x => x.map(y => y.innerText));
  const fmt = n => '€ ' + Number(n).toFixed(2).replace('.', ',');
  ok(kpiTxt[2] === fmt(prof.totals.margin) && kpiTxt[1] === fmt(prof.totals.cost), `panel = server calculation (margin ${kpiTxt[2]}, cost ${kpiTxt[1]})`);
  const dashTotal = await o.p.$eval('.kpi.main b', x => x.innerText);
  ok(dashTotal === fmt(prof.totals.revenue_gross), `dashboard total ${dashTotal} = margins revenue ${fmt(prof.totals.revenue_gross)} (same orders)`);
  await o.p.$eval('.fin-dash', e => e.scrollIntoView()); await sleep(300);
  await o.p.screenshot({ path: OUT + '/dashboard_margins.png', fullPage: false });

  console.log('OWNER · EXCEL + BACKUP');
  const [dl] = await Promise.all([o.p.waitForEvent('download'), o.p.click('#xlsx')]);
  const xf = OUT + '/' + dl.suggestedFilename(); await dl.saveAs(xf);
  const z = unzipSync(fs.readFileSync(xf)); const wb = strFromU8(z['xl/workbook.xml']);
  ok(/name="(Orders|Ordini)"/.test(wb) && /name="(Dishes|Piatti)"/.test(wb) && /name="(Margins|Margini)"/.test(wb), 'Excel has 3 sheets: Orders, Dishes and the new Margini');
  const s3 = strFromU8(z['xl/worksheets/sheet3.xml']);
  ok(/PROVISIONAL|PROVVISORIO/.test(s3) && /Ravioli/.test(s3) && s3.includes(`<v>${prof.totals.margin}</v>`), 'Margini sheet: provisional note, every dish, same gross margin as the dashboard');
  const s1 = strFromU8(z['xl/worksheets/sheet1.xml']);
  ok(!/purchase|acquisto|food cost/i.test(s1), 'Orders sheet unchanged (no cost columns added to it)');
  await o.p.click('[data-tab="import"]'); await o.p.waitForSelector('#bkBtn');
  const dls = []; o.p.on('download', d => dls.push(d));
  await o.p.click('#bkBtn'); for (let i = 0; i < 40 && dls.length < 2; i++) await sleep(250);
  const js = dls.find(d => /BACKUP/.test(d.suggestedFilename())), all = dls.find(d => /ALL_ORDERS/.test(d.suggestedFilename()));
  const jf = OUT + '/backup.json'; await js.saveAs(jf); const bk = JSON.parse(fs.readFileSync(jf, 'utf8'));
  ok(bk.finance && bk.finance.costs.length === +sql('select count(*) from item_costs') && bk.finance.costs.some(c => c.voided_at), `backup contains the full cost history (${bk.finance?.costs.length} rows, cancelled ones too) and the VAT rates`);
  ok(bk.orders.length > 0 && bk.menu.length > 0, 'backup still contains orders and menu as before');
  const af = OUT + '/all.xlsx'; await all.saveAs(af);
  ok(/name="(Margins|Margini)"/.test(strFromU8(unzipSync(fs.readFileSync(af))['xl/workbook.xml'])), 'ALL_ORDERS Excel of the backup has the Margini sheet too');

  console.log('OWNER · AUDIT LOG');
  await o.p.click('[data-tab="log"]'); await o.p.waitForSelector('.loglist');
  const lg = await o.p.innerText('.loglist');
  ok(/Purchase cost · Lasagne|Costo di acquisto · Lasagne/.test(lg) && /Cost corrected|Costo corretto/.test(lg) && /Cost cancelled|Costo annullato/.test(lg) && /VAT rates changed|Aliquote IVA modificate/.test(lg), 'audit log shows cost saved, corrected, cancelled and VAT changes in plain words');

  console.log('OWNER · SCHEDULE STILL WORKS');
  await o.p.click('[data-tab="rota"]'); await o.p.waitForSelector('.rota-ed');
  ok(sql("select string_agg(person, '+' order by sort) from staff_shifts where day='2026-12-22' and shift='C'") === 'Cristian+Nuova risorsa', 'staff schedule: 22/12 C still Cristian + Nuova risorsa');

  // phone + dark mode
  const ph = await mk({ ...devices['iPhone 13'] }); await login(ph.p, 'owner'); await ph.p.waitForSelector('.otabs');
  await ph.p.click('[data-tab="costs"]'); await ph.p.waitForSelector('.crow[data-cost]');
  ok(await ph.p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'phone: Costs tab has no sideways scrolling');
  await ph.p.screenshot({ path: OUT + '/costs_phone.png' });
  await ph.p.click('.crow[data-cost="ravioli"]'); await ph.p.waitForSelector('#cForm'); await sleep(400);
  await ph.p.screenshot({ path: OUT + '/costs_phone_dish.png' });
  await ph.p.click('#costSheet [data-close]'); await ph.p.click('[data-tab="dash"]'); await ph.p.waitForSelector('.fin-dash .kpis', { timeout: 15000 });
  ok(await ph.p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'phone: dashboard with margins has no sideways scrolling');
  await ph.p.$eval('.fin-dash', e => e.scrollIntoView()); await sleep(300); await ph.p.screenshot({ path: OUT + '/dashboard_phone.png' });
  const dk = await mk({ colorScheme: 'dark' }); await login(dk.p, 'owner'); await dk.p.waitForSelector('.otabs'); await dk.p.click('[data-tab="costs"]'); await dk.p.waitForSelector('.crow[data-cost]');
  await dk.p.screenshot({ path: OUT + '/costs_dark.png' });

  // ======================= WAITERS AND RECEPTION =======================
  const api = (p, body, path) => p.evaluate(async ([b, path]) => { const s = JSON.parse(sessionStorage.getItem('demo-session')); const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid: s.user.id, ...b }) }); return r.json(); }, [body, path]);
  const readT = (p, t) => api(p, { q: { table: t, kind: 'select', columns: '*', filters: [], order: [] } }, '/demo-api/query');
  const rpc = (p, name, args) => api(p, { name, args }, '/demo-api/rpc');
  for (const who of ['staff', 'reception']) {
    console.log(who === 'staff' ? 'WAITER DEVICE' : 'RECEPTION');
    const d = await mk(who === 'staff' ? devices['iPhone 13'] : {}); const calls = [];
    d.p.on('request', q => { const x = q.postData() || ''; if (/item_costs|item_finance|finance_settings|owner_profit|owner_save_cost/.test(x)) calls.push(x.slice(0, 60)); });
    if (who === 'staff') { await d.p.goto(A); await d.p.fill('#lp', 'demo'); await d.p.click('button[type=submit]'); await d.p.click('.wpick:has-text("Luca")'); for (const k of '1234') await d.p.click(`.keys [data-k="${k}"]`); await sleep(1500); await d.p.click('#moreBtn'); await sleep(400); }
    else { await login(d.p, 'reception'); await sleep(2500); }
    ok(calls.length === 0, `${who}: the app never asks for costs (${calls.length} requests)`);
    ok(!/Food cost|Costi e margini|Costs & margins|Margine lordo|Gross margin/.test(await d.p.evaluate(() => document.body.innerText)), `${who}: nothing about costs or margins on screen`);
    const rows = await Promise.all(['item_costs', 'item_finance', 'finance_settings'].map(t => readT(d.p, t)));
    ok(rows.every(r => Array.isArray(r.data) && r.data.length === 0), `${who}: reading the cost tables directly gives 0 rows`);
    const r1 = await rpc(d.p, 'owner_profit', { p_from: '2026-11-01', p_to: '2026-11-30' }), r2 = await rpc(d.p, 'owner_save_cost', { p: { item_id: 'lasagne', cost: 0, valid_from: '2026-11-01' } });
    ok(/owner/i.test(r1.error?.message || '') && /owner/i.test(r2.error?.message || ''), `${who}: margins and saving costs refused ("${r1.error?.message}")`);
    if (who === 'staff') await d.p.screenshot({ path: OUT + '/waiter_unchanged.png' });
  }

  console.log('NOTHING ELSE CHANGED');
  ok(sql(MENU_MD5) === before.menu, 'menu selling prices, names, hidden: identical');
  ok(sql(ORD_MD5) === before.orders && sql(LINES_MD5) === before.lines, 'orders and order lines: identical');
  ok(sql(SHIFTS_MD5) === before.shifts, 'staff schedule: identical');
  ok(sql(`select count(*) from audit_log where id > ${before.audit} and action not in ('cost_save','cost_correct','cost_void','vat_save')`) === '0', 'only cost/VAT actions were logged during the test');

  console.log(`\n${pass} passed, ${fail} failed · page errors: ${errs.length ? errs.join(' | ') : 'none'}`);
  await b.close();
  execSync(`${PSQL} -q -f demo/seed_costs.sql`, { stdio: 'ignore' });   // demo data back as before
})();
