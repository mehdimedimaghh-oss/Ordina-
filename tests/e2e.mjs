// End-to-end test: a tablet, a phone and the owner use the app at the same time.
// Needs: the app running (APP_URL), a test database (DB_URL), playwright installed.
// The database must have: staff@test.local / staff-pass-123 (staff), owner@test.local / owner-pass-123 (owner),
// waiters Mehdi + Nikola with PIN 0000, and the old history imported (tests/db.test.mjs does all this).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
const { chromium, devices } = createRequire(import.meta.url)('playwright');

const APP = process.env.APP_URL || 'http://localhost:4173';
const DB = process.env.DB_URL;
const SHOTS = process.env.SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sql = q => execFileSync('psql', [DB, '-tAc', q]).toString().trim();
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; console.log('  ✓', m); } else { fails++; console.log('  ✗', m); } };
const shot = (p, n) => SHOTS ? p.screenshot({ path: `${SHOTS}/${n}.png` }) : null;
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch { /* retry */ } await new Promise(r => setTimeout(r, 200)); } return false; };

const browser = await chromium.launch();
const errors = [];
async function device(opts) {
  const ctx = await browser.newContext({ ...opts, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  return { ctx, p };
}
async function staffLogin(p, waiter = 'Mehdi', pin = '0000') {
  await p.goto(APP);
  await p.fill('#lp', 'staff-pass-123'); await p.click('button[type=submit]');
  await p.waitForSelector('.wpick');
  await p.click(`.wpick:has-text("${waiter}")`);
  for (const k of pin) await p.click(`.keys [data-k="${k}"]`);
}

sql(`delete from open_tables; delete from stock; delete from orders where source='app'`);

console.log('1. Login on the shared tablet');
const tab = await device({ viewport: { width: 1180, height: 820 } });
await tab.p.goto(APP);
await tab.p.fill('#lp', 'wrong'); await tab.p.click('button[type=submit]');
ok(await until(async () => (await tab.p.textContent('#lerr')).includes('Wrong')), 'wrong restaurant password refused');
await tab.p.fill('#lp', 'staff-pass-123'); await tab.p.click('button[type=submit]');
await tab.p.waitForSelector('.wpick');
await tab.p.click('.wpick:has-text("Mehdi")');
for (const k of '1234') await tab.p.click(`.keys [data-k="${k}"]`);
ok(await until(async () => (await tab.p.textContent('.pinpad .err')).includes('Wrong PIN')), 'wrong PIN refused');
for (const k of '0000') await tab.p.click(`.keys [data-k="${k}"]`);
ok(await until(() => tab.p.isVisible('#mapView .tile')), 'right PIN → table map with 30 tables');
ok(await tab.p.locator('#mapView .tile').count() === 30, '30 tiles');
await shot(tab.p, 'tablet-map');

console.log('2. Add dishes, undo, served, notes');
await tab.p.click('.tile[data-t="7"]');
await tab.p.click('.cell[data-id="carbonara"] .card');
await tab.p.click('.cell[data-id="carbonara"] .card');
await tab.p.click('.cell[data-id="acqua"] .card');
ok(await tab.p.isVisible('.toast button:has-text("Undo")'), 'undo toast shown');
await tab.p.click('.toast button:has-text("Undo")');
ok(await until(async () => (await tab.p.locator('.cell[data-id="acqua"].has').count()) === 0), 'undo removed the water');
ok(await until(async () => (await tab.p.textContent('#orderPanel .total b')).includes('26,00')), 'total € 26,00 on the right panel');
await tab.p.click('#orderPanel [data-srv="carbonara"]');
ok(await until(async () => (await tab.p.textContent('#orderPanel [data-srv="carbonara"]')).includes('1/2')), 'served 1/2');
await tab.p.fill('#cname', 'Rossi'); await tab.p.fill('#croom', '214');
await tab.p.click('#orderPanel [data-cov="1"]'); await tab.p.click('#orderPanel [data-cov="1"]');
ok(await until(() => sql(`select data->>'covers' from open_tables where table_no=7`) === '2'), 'coperti: 2 guests stored on table 7');
await tab.p.click('#orderPanel [data-nb="carbonara"]'); await tab.p.fill('[data-inote="carbonara"]', 'no pepper');
await tab.p.click('#orderPanel h3');  // blur → saved
ok(await until(() => sql(`select data->>'client' || '|' || (data->'notes'->>'carbonara') from open_tables where table_no=7`) === 'Rossi|no pepper'), 'client + dish note stored in the database');

console.log('3. Live on a second device (phone)');
const phone = await device({ ...devices['iPhone 13'] });
await staffLogin(phone.p, 'Nikola');
await phone.p.waitForSelector('#barBtn');
ok(!(await phone.p.isVisible('#mapView .tile')), 'phone keeps the old layout (no table map)');
await phone.p.click('#tableBtn');
ok(await until(async () => (await phone.p.getAttribute('.tg[data-t="7"]', 'class')).includes('open')), 'phone sees table 7 open');
await phone.p.click('.tg[data-t="7"]');
ok(await until(async () => (await phone.p.textContent('#barTotal')).includes('26,00')), 'phone bar shows € 26,00');
await phone.p.click('.cell[data-id="tiramisu"] .card');
ok(await until(async () => (await tab.p.textContent('#orderPanel .total b')).includes('34,50')), 'tablet updates live after phone adds tiramisù (€ 34,50)');
await shot(phone.p, 'phone-menu');
await phone.p.click('#barBtn');
await phone.p.waitForSelector('#orderSheet:not([hidden]) #closeBtn');
await shot(phone.p, 'phone-order');
await phone.p.click('#orderSheet [data-close]');

console.log('4. Send to reception');
await tab.p.click('#closeBtn');
ok(await until(async () => (await tab.p.textContent('.toast')).includes('HCO or DEP')), 'room without building is refused');
await tab.p.click('#bld [data-b="HCO"]');
await tab.p.waitForTimeout(300);
await tab.p.click('#closeBtn');
ok(await until(() => tab.p.isVisible('#mapView .tile')), 'back to the map');
const clip = await tab.p.evaluate(() => navigator.clipboard.readText());
ok(clip.includes('TAVOLO 7') && clip.includes('Camera HCO 214') && clip.includes('2x Spaghetti alla carbonara — no pepper') && clip.includes('TOTALE € 34,50'), 'order text copied');
ok(await until(() => sql(`select total||'|'||waiter_name||'|'||building||room_no from orders where table_no=7 and source='app'`) === '34.50|Mehdi|HCO214'), 'order saved in the database');
ok(await until(() => sql(`select count(*) from open_tables where table_no=7`) === '0'), 'table 7 is free');
await tab.p.click('.toast button:has-text("Show")');
ok(await tab.p.isVisible('.recv h2:has-text("7")'), 'reception view (big text) opens');
await shot(tab.p, 'reception-view');
await tab.p.click('.recv .x');

console.log('5. History of today');
await tab.p.click('#histBtn');
ok(await until(async () => (await tab.p.textContent('#histSheet .sum b')).includes('34,50')), 'history total today € 34,50');
ok((await tab.p.textContent('#histSheet')).includes('no pepper'), 'history shows the dish note');
await shot(tab.p, 'history-today');
await tab.p.click('#histSheet [data-close]');

console.log('6. Stock');
await tab.p.click('#stockBtn');
for (let i = 0; i < 3; i++) await tab.p.click('#stockSheet [data-s="risotto"][data-d="1"]');
ok(await until(() => sql(`select remaining from stock where item_id='risotto'`) === '3'), 'risotto stock set to 3');
await tab.p.click('#stockSheet [data-close]');
await tab.p.click('.tile[data-t="3"]');
await tab.p.click('.cell[data-id="risotto"] .card');
ok(await until(async () => (await tab.p.getAttribute('.cell[data-id="risotto"]', 'class')).includes('lvl-warn')), 'after 1 risotto: 2 left = orange');
await tab.p.click('.cell[data-id="risotto"] .card'); await tab.p.click('.cell[data-id="risotto"] .card');
ok(await until(async () => (await tab.p.getAttribute('.cell[data-id="risotto"]', 'class')).includes('lvl-out')), 'after 3 risotto: finished = red');
ok(await until(() => sql(`select remaining from stock where item_id='risotto'`) === '0'), 'database stock 0');
ok(await until(async () => (await phone.p.getAttribute('.cell[data-id="risotto"]', 'class')).includes('lvl-out')), 'phone also shows risotto finished');

console.log('7. Offline, then sync');
await phone.ctx.setOffline(true);
await phone.p.evaluate(() => window.dispatchEvent(new Event('offline')));
await phone.p.click('#tableBtn'); await phone.p.click('.tg[data-t="12"]');
await phone.p.click('.cell[data-id="espresso"] .card'); await phone.p.click('.cell[data-id="espresso"] .card');
await phone.p.click('#barBtn'); await phone.p.waitForSelector('#orderSheet:not([hidden]) #closeBtn');
await phone.p.click('#closeBtn');
ok(await until(async () => (await phone.p.textContent('.toast')).includes('How many guests')), 'no guests → reminder first (not sent)');
await phone.p.click('#closeBtn');
ok(await until(async () => (await phone.p.textContent('#sync')).includes('waiting')), 'phone shows "Offline · waiting"');
ok(sql(`select count(*) from orders where table_no=12`) === '0', 'nothing reached the database yet');
await phone.p.reload();   // app still opens offline (service worker) and keeps the queue
ok(await until(() => phone.p.isVisible('#barBtn')), 'app reopens without internet');
ok(await until(async () => (await phone.p.textContent('#sync')).includes('waiting')), 'queue survives the reload');
await phone.ctx.setOffline(false);
await phone.p.evaluate(() => window.dispatchEvent(new Event('online')));
ok(await until(() => sql(`select total||'|'||waiter_name from orders where table_no=12`) === '6.00|Nikola', 15000), 'back online → order synced (€ 6,00 by Nikola)');
ok(await until(async () => !(await phone.p.isVisible('#sync'))), 'sync badge gone');

console.log('8. Owner dashboard');
const own = await device({ viewport: { width: 1280, height: 900 } });
await own.p.goto(APP);
await own.p.click('.seg [data-k="owner"]');
await own.p.fill('#le', 'owner@test.local'); await own.p.fill('#lp', 'owner-pass-123'); await own.p.click('button[type=submit]');
ok(await until(() => own.p.isVisible('.kpi.main')), 'owner lands on the dashboard');
ok(await until(async () => (await own.p.textContent('.kpi.main b')).includes('40,50')), "today's total € 40,50 (34,50 + 6,00)");
await own.p.click('.cal-h [data-m="-1"]').catch(() => {});
await own.p.click('.cal-h [data-m="1"]').catch(() => {});
await own.p.click('[data-day="2026-11-02"]');
ok(await until(async () => (await own.p.textContent('.kpi.main b')).includes('77,00')), 'old history 2 Nov: € 77,00 (3 + 52,50 + 21,50)');
ok((await own.p.textContent('#olist')).includes('Room DEP 101'), 'orders list shows HCO/DEP rooms');
await shot(own.p, 'owner-day');
await own.p.click('[data-mode="week"]');
ok(await until(async () => (await own.p.textContent('.kpi.main b')).includes('117,50')), 'week view Mon 2 – Sun 8 Nov: € 117,50 (77,00 + 40,50)');
await own.p.click('[data-mode="month"]');
ok(await until(async () => (await own.p.textContent('.kpi.main b')).includes('270,00')), 'month November: € 270,00 (old 229,50 + today 40,50)');
ok((await own.p.textContent('.kpis')).includes('Guests (coperti)') && (await own.p.locator('.kpi:has-text("Guests") b').textContent()) === '2', 'owner sees guests (coperti): 2');
ok((await own.p.textContent('.hbars')).includes('Mehdi'), 'total per waiter');
ok((await own.p.textContent('.two')).includes('Spaghetti alla carbonara'), 'best-selling dishes');
await shot(own.p, 'owner-month');
const [dl] = await Promise.all([own.p.waitForEvent('download'), own.p.click('#xlsx')]);
const xp = await dl.path();
const listing = execFileSync('unzip', ['-l', xp]).toString();
const sheet1 = execFileSync('unzip', ['-p', xp, 'xl/worksheets/sheet1.xml']).toString();
ok(listing.includes('xl/worksheets/sheet2.xml') && sheet1.includes('DEP') && dl.suggestedFilename().endsWith('.xlsx'), 'Excel export with orders and dishes sheets');
const [dc] = await Promise.all([own.p.waitForEvent('download'), own.p.click('#csv')]);
const csv = readFileSync(await dc.path(), 'utf8');
ok(csv.startsWith('﻿') && csv.includes(';104,5;'), 'CSV export (Italian Excel format)');

console.log('9. Owner deletes an order → audit log');
await own.p.click('[data-mode="day"]'); await own.p.click(`[data-day="${sql('select public.rome_today()')}"]`);
await own.p.waitForSelector('#olist .del');
own.p.once('dialog', d => d.accept('test delete'));
await own.p.click('#olist .ho:has-text("Tavolo 12") .del'); await own.p.click('#olist .ho:has-text("Tavolo 12") .del');
ok(await until(() => sql(`select count(*) from orders where table_no=12`) === '0'), 'order of table 12 deleted');
await own.p.click('[data-tab="log"]');
ok(await until(async () => (await own.p.textContent('.loglist')).includes('Deleted order · Tavolo 12')), 'audit log: "Deleted order · Tavolo 12" by owner');
ok((await own.p.textContent('.loglist')).includes('owner@test.local'), 'audit log shows who');
ok((await phone.p.locator('#histBtn').count()) === 1 && (await phone.p.locator('.del').count()) === 0, 'waiters have no Delete button');

console.log('10. Menu editor → live price on waiter devices');
await own.p.click('[data-tab="menu"]');
const row = own.p.locator('.mrow[data-id="espresso"]');
await row.locator('[data-f="price"]').fill('3.5');
await row.locator('[data-save]').click();
ok(await until(async () => (await phone.p.textContent('.cell[data-id="espresso"] .pr')).includes('3,50')), 'phone shows the new espresso price € 3,50');
await row.locator('[data-f="price"]').fill('3'); await row.locator('[data-save]').click();
await own.p.locator('.mrow[data-new="dolci"] [data-f="name_it"]').fill('Panna cotta');
await own.p.locator('.mrow[data-new="dolci"] [data-f="name_en"]').fill('Cream pudding');
await own.p.locator('.mrow[data-new="dolci"] [data-f="price"]').fill('7');
await own.p.locator('.mrow[data-new="dolci"] [data-add]').click();
ok(await until(() => phone.p.isVisible('.cell[data-id="panna-cotta"]')), 'new dish appears on the phone');
await own.p.locator('.mrow[data-id="panna-cotta"] [data-f="hidden"]').check();
await own.p.locator('.mrow[data-id="panna-cotta"] [data-save]').click();
ok(await until(async () => !(await phone.p.isVisible('.cell[data-id="panna-cotta"]'))), 'hidden dish disappears');

console.log('11. Waiters + import (owner)');
await own.p.click('[data-tab="waiters"]');
await own.p.waitForSelector('.mrow[data-new]');
await own.p.locator('.mrow[data-new] [data-f="name"]').fill('Giulia');
await own.p.locator('.mrow[data-new] [data-f="pin"]').fill('2468');
await own.p.locator('.mrow[data-new] [data-save]').click();
ok(await until(() => sql(`select count(*) from waiters where name='Giulia'`) === '1'), 'waiter Giulia added');
await tab.p.click('#waiterBtn');
await tab.p.click('#waiterSheet .wpick:has-text("Giulia")');
for (const k of '2468') await tab.p.click(`#waiterSheet [data-k="${k}"]`);
ok(await until(async () => (await tab.p.textContent('#waiterName')) === 'Giulia'), 'quick switch on the tablet to Giulia');
await own.p.click('[data-tab="import"]');
if (process.env.HISTORY) {
  await own.p.setInputFiles('#impFile', process.env.HISTORY);
  await own.p.click('#impGo');
  ok(await until(async () => (await own.p.textContent('#impInfo')).includes('already there')), 'import again from the browser: nothing doubled');
}

console.log('12. Dark theme + phone screenshots');
await phone.p.click('#moreBtn'); await phone.p.click('[data-th="dark"]');
ok(await phone.p.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'dark theme on');
await phone.p.click('#moreSheet [data-close]');
await shot(phone.p, 'phone-dark');

console.log('13. Language per waiter (IT / EN)');
await tab.p.click('#waiterBtn'); await tab.p.click('#waiterSheet .wpick:has-text("Mehdi")');
for (const k of '0000') await tab.p.click(`#waiterSheet [data-k="${k}"]`);
await tab.p.waitForTimeout(500);
await tab.p.click('#langBtn');
ok(await until(async () => (await tab.p.textContent('#stockBtn')).includes('Scorte')), 'Mehdi taps IT → buttons in Italian');
if (!(await tab.p.isVisible('#mapView .tile'))) await tab.p.click('#tableBtn');
await tab.p.click('.tile[data-t="9"]'); await tab.p.click('.cell[data-id="espresso"] .card');
ok(await until(async () => (await tab.p.textContent('#orderPanel')).includes('Invia alla reception')), 'order panel in Italian');
ok((await tab.p.textContent('.toast')).includes('Annulla'), 'undo toast in Italian');
await tab.p.click('#tableBtn');
await tab.p.click('#waiterBtn'); await tab.p.click('#waiterSheet .wpick:has-text("Nikola")');
for (const k of '0000') await tab.p.click(`#waiterSheet [data-k="${k}"]`);
ok(await until(async () => (await tab.p.textContent('#stockBtn')).includes('Stock')), 'Nikola logs in → his own language (English, device default)');
await tab.p.click('#waiterBtn'); await tab.p.click('#waiterSheet .wpick:has-text("Mehdi")');
for (const k of '0000') await tab.p.click(`#waiterSheet [data-k="${k}"]`);
ok(await until(async () => (await tab.p.textContent('#stockBtn')).includes('Scorte')), 'Mehdi again → Italian comes back by itself');
ok(await until(async () => (await tab.p.textContent('#mapView')).includes('Libero')), 'table map in Italian');
await shot(tab.p, 'tablet-italian');
await tab.p.click('#moreBtn'); await tab.p.click('#moreSheet [data-lang="en"]');
ok(await until(async () => (await tab.p.textContent('#stockBtn')).includes('Stock')), 'More → English works');
const login = await device({ viewport: { width: 400, height: 800 } });
await login.p.goto(APP); await login.p.click('[data-glang="it"]');
ok(await until(async () => (await login.p.textContent('.gate')).includes('Password del ristorante')), 'login screen IT button');
await shot(login.p, 'login-italian');

console.log('14. Reception screen on the reception PC');
const rec = await (async () => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 }, permissions: ['notifications'] });
  await ctx.addInitScript(() => {
    window.__notes = [];
    const N = function (title, o) { window.__notes.push(title + ' | ' + (o && o.body)); return { close() {} }; };
    N.permission = 'granted'; N.requestPermission = async () => 'granted'; window.Notification = N;
  });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push('reception: ' + e.message)); return { ctx, p };
})();
await rec.p.goto(APP);
await rec.p.click('[data-glang="en"]');
await rec.p.click('.seg [data-k="reception"]');
await rec.p.fill('#le', 'reception@test.local'); await rec.p.fill('#lp', 'reception-pass-123'); await rec.p.click('button[type=submit]');
ok(await until(() => rec.p.isVisible('#recvStart')), 'reception logs in with its own email → straight to the reception screen');
ok((await rec.p.locator('#mapView, #menu, .pinpad').count()) === 0, 'reception has no menu, tables or PIN screen');
await rec.p.click('#recvStart');
await rec.p.waitForTimeout(1500);
const before = await rec.p.locator('.rcard').count();
ok(before > 0 && (await rec.p.locator('.recv-pop').count()) === 0, `orders already there are listed (${before}) without pop-ups`);
await shot(rec.p, 'reception-list');
// a waiter sends an order on the tablet
if (!(await tab.p.isVisible('#mapView .tile'))) await tab.p.click('#tableBtn');
await tab.p.click('.tile[data-t="15"]');
await tab.p.click('.cell[data-id="pinsa-veg"] .card'); await tab.p.click('.cell[data-id="coca"] .card');
await tab.p.fill('#cname', 'Bianchi'); await tab.p.fill('#croom', '305'); await tab.p.click('#bld [data-b="DEP"]');
for (let i = 0; i < 3; i++) await tab.p.click('#orderPanel [data-cov="1"]');
await tab.p.waitForTimeout(800);
await tab.p.click('#closeBtn');
ok(await until(() => rec.p.isVisible('.recv-pop'), 12000), 'reception: pop-up appears for the new order');
const pop = await rec.p.textContent('.recv-pop');
ok(pop.includes('3 guests'), 'pop-up shows 3 guests');
ok(pop.includes('15') && pop.includes('Bianchi') && pop.includes('DEP 305') && pop.includes('21,00') && pop.includes('Pinsa Vegetariana'), 'pop-up shows table, client, room DEP 305, dishes, total € 21,00');
const notes = await rec.p.evaluate(() => window.__notes);
ok(notes.some(n => n.includes('Tavolo 15') && n.includes('Bianchi')), 'PC notification sent: ' + (notes[notes.length - 1] || 'none'));
await shot(rec.p, 'reception-popup');
await rec.p.click('.recv-pop [data-pop="charge"]');
ok(await until(() => sql(`select charged_by from orders where table_no=15 and client='Bianchi'`) === 'Reception'), '"Charged ✓" saved in the database');
ok(await until(async () => (await rec.p.textContent('#recvList')).includes('Charged ✓')), 'card shows "Charged ✓ hh:mm"');
await tab.p.click('#histBtn');
ok(await until(async () => (await tab.p.locator('#histSheet .ho:has-text("Tavolo 15")').first().textContent()).includes('Charged ✓')), 'waiters see "Charged ✓" in History too');
await tab.p.click('#histSheet [data-close]');
// send table 9 (still open from step 13), then reopen it from History
if (!(await tab.p.isVisible('#mapView .tile'))) await tab.p.click('#tableBtn');
await tab.p.click('.tile[data-t="9"]'); await tab.p.click('#closeBtn'); await tab.p.waitForTimeout(300); await tab.p.click('#closeBtn');
ok(await until(async () => (await rec.p.locator('.recv-pop').count()) === 1, 12000), 'second order → new pop-up');
await rec.p.click('.recv-pop [data-pop="ok"]');
await tab.p.click('#histBtn');
await tab.p.locator('#histSheet .ho:has-text("Tavolo 9") [data-reopen]').first().click();
ok(await until(async () => (await rec.p.textContent('body')).includes('was reopened'), 12000), 'reopen → reception gets a warning');
ok(await until(async () => (await rec.p.textContent('#recvList')).includes('Reopened · do not charge')), 'reopened card: "do not charge"');
const [rx] = await Promise.all([rec.p.waitForEvent('download'), rec.p.click('#rcpXlsx')]);
const rxs = execFileSync('unzip', ['-p', await rx.path(), 'xl/worksheets/sheet1.xml']).toString();
ok(rxs.includes('Bianchi') && rxs.includes('Addebitato'), 'reception Excel of the day (with "Charged" column)');
await rec.p.click('#rcpLang');
ok(await until(async () => (await rec.p.textContent('.rcp')).includes('Schermo reception')), 'reception screen in Italian');
await shot(rec.p, 'reception-italian');

ok(errors.length === 0, 'no JavaScript errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
sql(`delete from waiters where name='Giulia'; delete from menu_items where id='panna-cotta'`);
await browser.close();
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
