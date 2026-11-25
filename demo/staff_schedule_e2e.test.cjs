// End-to-end test of the staff schedule in the demo app (fake brand, local demo database).
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
  const owner = async () => { const d = await mk(); await d.p.goto(A); await d.p.click('[data-k="owner"]'); await d.p.fill('#le', 'owner@demo.app'); await d.p.fill('#lp', 'demo'); await d.p.click('button[type=submit]'); await d.p.waitForSelector('.otabs'); return d; };
  const openRota = async p => { await p.click('[data-tab="rota"]'); await p.waitForSelector('.rota-ed'); };
  const goMonth = async (p, ym) => { await p.fill('#rMonth', ym); await p.dispatchEvent('#rMonth', 'change'); await p.waitForFunction(v => document.querySelector('#rMonth')?.value === v && document.querySelector('.rota'), ym); await sleep(300); };
  const cellText = (p, name, d) => p.evaluate(([n, d]) => { const r = [...document.querySelectorAll('.rota tbody tr')].find(tr => tr.dataset.name === n); return r ? r.querySelectorAll('td.c')[d - 1].textContent.trim() : null; }, [name, d]);

  console.log('OWNER EDITOR');
  const o1 = await owner(); await openRota(o1.p);
  ok(await o1.p.$eval('.otabs', x => /Schedule|Turni/.test(x.innerText)), 'Turni tab is in the Owner dashboard');
  await goMonth(o1.p, '2026-12');
  ok(/Saved|Salvato/.test(await o1.p.$eval('.rota-st', x => x.innerText)), 'December comes from the database (imported)');
  ok(await cellText(o1.p, 'Cristian', 22) === 'C' && await cellText(o1.p, 'Nuova risorsa', 22) === 'C', '22 December: Cristian and Nuova risorsa both on C');
  ok(await cellText(o1.p, 'Gabri', 20) === 'M' && await cellText(o1.p, 'Gabri', 21) === '', 'Gabri works until 20/12, nothing from 21/12');
  ok((await o1.p.$$eval('.rota thead th.dh', x => x.length)) === 31, 'December has 31 day columns');
  ok(await o1.p.$eval('.rota-legend', x => /06:30–14:30/.test(x.innerText) && /11:00–19:00/.test(x.innerText) && /17:00–01:00/.test(x.innerText)), 'legend shows M/C/P/R with the unchanged hours');
  await o1.p.screenshot({ path: OUT + '/owner_dec.png', fullPage: true });

  // a new month (the first month from Feb 2027 never saved, so the test can run again) → copy the month before, add people, edit, save
  const NEW = sql("select to_char(m, 'YYYY-MM') from generate_series('2027-02-01'::date, '2040-01-01', '1 month') m where m not in (select month from staff_months) limit 1");
  const PREV = sql(`select to_char('${NEW}-01'::date - interval '1 month', 'YYYY-MM')`);
  const prevPeople = sql(`select coalesce(string_agg(p->>'name', ',' order by o), '') from staff_months, jsonb_array_elements(people) with ordinality e(p, o) where month = '${PREV}-01'`);
  console.log('  (test month', NEW, ', copied from', PREV + ')');
  await goMonth(o1.p, NEW);
  ok(/New month|Mese nuovo/.test(await o1.p.$eval('.rota-st', x => x.innerText)), NEW + ' is a new empty month');
  await goMonth(o1.p, '2027-01');
  ok(await cellText(o1.p, 'Nuova risorsa', 1) === 'M', '1 January 2027 kept (Nuova risorsa M)');
  await goMonth(o1.p, NEW);
  await o1.p.click('#rCopy'); await sleep(800);
  const names = () => o1.p.$$eval('.rota tbody tr[data-name]', x => x.map(y => y.dataset.name));
  ok((await names()).join(',') === prevPeople, 'copy previous month brings the same people: ' + prevPeople);
  if (!(await names()).includes('Luca')) { await o1.p.selectOption('#rWaiter', { label: 'Luca' }); await o1.p.click('#rAdd'); await sleep(200); }
  if (!(await names()).includes('Stagista Prova')) { await o1.p.fill('#rName', 'Stagista Prova'); await o1.p.click('#rAdd'); await sleep(200); }
  const rowOf = name => o1.p.evaluate(n => [...document.querySelectorAll('.rota tbody tr')].findIndex(tr => tr.dataset.name === n), name);
  // empty day 2 for the three people first (a copied month may already have something there)
  for (const n of ['Mehdi', 'Stagista Prova', 'Luca']) { const pi = await rowOf(n); await o1.p.focus(`.cb[data-p="${pi}"][data-d="2"]`); await o1.p.keyboard.press('Delete'); await sleep(60); }
  // tap cells: Mehdi day 2 → M (1 tap), Stagista day 2 → C (2 taps), Luca day 2 → C (2 taps) = two people on C
  const tap = async (name, d, n) => { const pi = await rowOf(name); for (let i = 0; i < n; i++) { await o1.p.click(`.cb[data-p="${pi}"][data-d="${d}"]`); await sleep(80); } };
  await tap('Mehdi', 2, 1); await tap('Stagista Prova', 2, 2); await tap('Luca', 2, 2);
  // keyboard: Nikola day 3 → type P
  const nk = await rowOf('Nikola'); await o1.p.focus(`.cb[data-p="${nk}"][data-d="3"]`); await o1.p.keyboard.press('p'); await sleep(100);
  ok(await cellText(o1.p, 'Nikola', 3) === 'P', 'keyboard typing P works');
  ok(await o1.p.$eval('.rota tr.rota-cov', x => /M|C|P/.test(x.innerText)), 'coverage row shows the days with a missing shift');
  await o1.p.screenshot({ path: OUT + '/owner_feb_edit.png', fullPage: true });
  await o1.p.click('#rSave'); await sleep(1500);
  ok(sql(`select version from staff_months where month='${NEW}-01'`) === '1', NEW + ' saved (version 1)');
  ok(sql(`select string_agg(person, '+' order by person) from staff_shifts where day='${NEW}-02' and shift='C'`) === 'Luca+Stagista Prova', 'day 2: two people on C saved');
  ok(sql(`select count(*) from staff_shifts where day='${NEW}-02' and person='Luca' and waiter_id is not null`) === '1', 'Luca linked to his waiter account, Stagista Prova without account');
  ok(+sql(`select count(*) from audit_log where action='schedule_save' and entity_id='${NEW}'`) >= 1, 'audit log has the save');

  console.log('TWO OWNERS ON THE SAME MONTH');
  const o2 = await owner(); await openRota(o2.p); await goMonth(o2.p, NEW);
  await tap('Mehdi', 5, 1); await o1.p.click('#rSave'); await sleep(1200);   // owner 1 saves (version 2)
  const pi2 = await o2.p.evaluate(() => [...document.querySelectorAll('.rota tbody tr')].findIndex(tr => tr.dataset.name === 'Mehdi'));
  await o2.p.click(`.cb[data-p="${pi2}"][data-d="6"]`); await o2.p.click('#rSave'); await sleep(1500);
  const toast2 = await o2.p.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.innerText).join(' '));
  ok(/someone else|qualcun altro/i.test(toast2), 'second owner with an old version is refused (no overwrite): "' + toast2.slice(0, 60) + '…"');
  ok(sql(`select version from staff_months where month='${NEW}-01'`) === '2', 'the first owner\'s save stays (version 2)');

  console.log('PRINT / PDF');
  await o1.p.evaluate(() => { window.print = () => { window.__p = document.getElementById('printArea')?.innerText || ''; window.__page = document.getElementById('rotaPage')?.textContent || ''; }; });
  await goMonth(o1.p, '2026-12'); await o1.p.click('#rPrint'); await sleep(300);
  const pr = await o1.p.evaluate(() => [window.__p, window.__page]);
  ok(/dicembre 2026|December 2026/i.test(pr[0]) && /Nuova risorsa/.test(pr[0]) && /landscape/.test(pr[1]), 'print: December on a landscape page');
  await o1.p.evaluate(() => { document.body.classList.add('printing'); }); await o1.p.emulateMedia({ media: 'print' });
  await o1.p.evaluate(() => window.__fakePrint = 1);
  await o1.p.emulateMedia({ media: 'screen' }); await o1.p.evaluate(() => document.body.classList.remove('printing'));
  // a real PDF of the print layout
  await o1.p.click('#rPrint'); await sleep(200);
  await o1.p.pdf({ path: OUT + '/Turni-dicembre-2026.pdf', landscape: true, format: 'A4', printBackground: true });

  console.log('WAITER (read only, whole team)');
  const w = await mk({ ...devices['iPhone 13'] });
  await w.p.goto(A); await w.p.fill('#lp', 'demo'); await w.p.click('button[type=submit]'); await w.p.click('.wpick:has-text("Luca")'); for (const k of '1234') await w.p.click(`.keys [data-k="${k}"]`);
  await sleep(1500); await w.p.click('#moreBtn'); await sleep(400);
  ok(!!(await w.p.$('#mRota')), '"Turni del personale" is in the waiters\' menu');
  await w.p.click('#mRota'); await sleep(800);
  const months = await w.p.$$eval('#rotaSheet .rota-vh', x => x.map(y => y.innerText));
  ok(months.length === 2 && /novembre|November/i.test(months[0]) && /dicembre|December/i.test(months[1]), 'shows this month and next month: ' + months.join(' + '));
  ok((await w.p.$$('#rotaSheet .cb, #rotaSheet [data-del], #rotaSheet #rSave')).length === 0, 'no edit buttons for waiters (read only)');
  ok(await w.p.$eval('#rotaSheet', x => /Nuova risorsa/.test(x.innerText)), 'shows people without an app account (Nuova risorsa)');
  await w.p.screenshot({ path: OUT + '/waiter_rota.png' });
  // the waiter cannot save through the database either
  const wSave = await w.p.evaluate(async () => { const r = await fetch('/demo-api/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid: JSON.parse(sessionStorage.getItem('demo-session')).user.id, name: 'owner_save_month', args: { p_month: '2026-12-01', p_people: [], p_cells: [], p_version: 1 } }) }); return r.json(); });
  ok(/owner/i.test(wSave.error?.message || ''), 'waiter device trying to save is refused: ' + (wSave.error?.message || 'ALLOWED'));

  console.log('LIVE UPDATE + OFFLINE COPY');
  // owner changes 30 November for Mehdi; the waiter's open sheet updates by itself
  await goMonth(o1.p, '2026-11');
  const before = await cellText(o1.p, 'Mehdi', 30);
  const mi = await o1.p.evaluate(() => [...document.querySelectorAll('.rota tbody tr')].findIndex(tr => tr.dataset.name === 'Mehdi'));
  const order = ['', 'M', 'C', 'P', 'R']; const target = before === 'R' ? 'M' : 'R';
  for (let i = 0; i < 5 && (await cellText(o1.p, 'Mehdi', 30)) !== target; i++) { await o1.p.click(`.cb[data-p="${mi}"][data-d="30"]`); await sleep(80); }
  await o1.p.click('#rSave'); await sleep(2500);
  const wCell = () => w.p.evaluate(() => { const v = document.querySelector('#rotaSheet .rota-view'); const r = [...v.querySelectorAll('tbody tr')].find(tr => tr.dataset.name === 'Mehdi'); return r.querySelectorAll('td.c')[29].textContent.trim(); });
  ok(await wCell() === target, `waiter sees the change live (30/11 Mehdi ${before} → ${target}) without reloading`);
  // offline: the database cannot be reached, the device shows its saved copy
  await w.c.route('**/demo-api/query', r => { const d = r.request().postData() || ''; return /staff_/.test(d) ? r.abort() : r.continue(); });
  await w.p.reload(); await sleep(2500);
  await w.p.click('#moreBtn'); await sleep(300); await w.p.click('#mRota'); await sleep(600);
  ok(await wCell() === target, 'offline (schedule database unreachable): the saved copy is shown, with the latest change');
  await w.c.unroute('**/demo-api/query');
  // put November back as it was
  for (let i = 0; i < 5 && (await cellText(o1.p, 'Mehdi', 30)) !== before; i++) { await o1.p.click(`.cb[data-p="${mi}"][data-d="30"]`); await sleep(80); }
  await o1.p.click('#rSave'); await sleep(1500);
  ok(sql("select shift from staff_shifts where day='2026-11-30' and person='Mehdi'") === before, 'November put back as it was (' + before + ')');

  console.log('RECEPTION (no schedule)');
  const r = await mk(); const calls = [];
  r.p.on('request', q => { const d = q.postData() || ''; if (/staff_/.test(d)) calls.push(d.slice(0, 80)); });
  await r.p.goto(A); await r.p.click('[data-k="reception"]'); await r.p.fill('#le', 'reception@demo.app'); await r.p.fill('#lp', 'demo'); await r.p.click('button[type=submit]'); await sleep(3000);
  ok(calls.length === 0, 'reception never asks for the schedule (' + calls.length + ' requests)');
  ok(!/Turni|Schedule|Nuova risorsa/.test(await r.p.evaluate(() => document.body.innerText)), 'reception screen shows nothing about the schedule');
  const rRead = await r.p.evaluate(async () => { const s = JSON.parse(sessionStorage.getItem('demo-session')); const q = await fetch('/demo-api/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid: s.user.id, q: { table: 'staff_shifts', kind: 'select', columns: '*', filters: [], order: [] } }) }); return q.json(); });
  ok(Array.isArray(rRead.data) && rRead.data.length === 0, 'reception login reading the table directly gets 0 rows');

  console.log('ACTIVE / NEXT WAITER (unchanged)');
  const sn = await o1.p.evaluate(async () => { const m = await import('/src/schedule.js'); const f = t => { const r = m.turnInfo(Date.parse(t)); return r.active.map(x => x.name).join('+') + '|' + (r.next ? r.next.name : '-') + '|' + r.off.join('+'); }; return [f('2026-12-22T12:00:00+01:00'), f('2026-12-31T23:30:00+01:00')]; });
  ok(sn[0] === 'Mehdi+Cristian+Nuova risorsa|Nikola|' && sn[1] === 'Nikola|Nuova risorsa|Cristian', 'active/next on 22/12 and 31/12 as before: ' + sn.join('  ·  '));

  console.log(`\n${pass} passed, ${fail} failed · page errors: ${errs.length ? errs.join(' | ') : 'none'}`);
  await b.close();
})();
