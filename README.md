# Comande Pranzo — lunch orders for Hotel Concordia & Fugari Bistrot

An installable web app (PWA) for waiters (shared tablet + phones) and an owner dashboard with the full order history.
It is the successor of the single-file `comande.html`: same menu, prices, features and look.

- **Put it online:** [SETUP.md](SETUP.md) (simple step-by-step, Supabase + Vercel)
- **How to use it:** [GUIDE.md](GUIDE.md) (waiters and owner)
- **Orders to the reception's Google Sheet:** [RECEPTION-SHEET.md](RECEPTION-SHEET.md)

## How it is built

| Part | What |
|---|---|
| Website | Vite + plain JavaScript (`src/`), hosted on Vercel |
| Database, logins, live updates | Supabase (Postgres + Auth + Realtime) |
| Offline | service worker (vite-plugin-pwa) + a queue of changes in the device storage, sent when online |

```
index.html            page skeleton + icons
src/main.js           start, login screen, screen choice, wake lock, service worker
src/store.js          Supabase client, offline queue, live updates, all data calls
src/waiter.js         menu, order, table map (tablet), today's history, stock, PIN switch
src/owner.js          dashboard (calendar day/week/month), menu editor, waiters, import, audit log
src/xlsx.js           small Excel (.xlsx) writer
supabase/migrations/  the whole database: tables, Row Level Security, functions, menu
scripts/import-history.mjs   import the old app's JSON history with the secret key
scripts/reception-sheet.gs   Google Apps Script: writes each order into the reception's Google Sheet
tests/                db.test.mjs (security rules), e2e.mjs (browser test), sheet.test.mjs (reception sheet)
```

### Security model
- Two kinds of Supabase logins: **staff** (one shared login per device, typed once) and **owner** (email).
- Waiters identify with **name + 4-digit PIN** (bcrypt in the database, 5 wrong PINs → 1 minute lock). A PIN gives a waiter session token that is stored with every order.
- **Row Level Security** on every table. Nothing is readable without a login with a role.
  Staff: menu, open tables, stock, **today's** orders. Owner: everything.
- All writes go through `security definer` functions (`table_op`, `submit_order`, `reopen_order`, `delete_order`, …).
  Only the owner can delete an order; the full order is copied to `audit_log` first.
- Sending the same order twice (offline retry) is safe: orders have a unique `uid`.

### Offline
Every change (add dish, served, note, send to reception, stock) goes into a queue in `localStorage` and is applied to the screen at once.
The queue is sent in order when the internet is back. Live updates from other devices are merged with the waiting changes.

## Develop

```bash
npm install
cp .env.example .env.local     # fill in your Supabase URL + anon key
npm run dev
```

Local database (needs Docker): `npx supabase start` then use the URL and anon key it prints.

### Tests
```bash
# security + logic of the database (needs a running Supabase with this migration)
SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_KEY=… DB_URL=postgresql://… node tests/db.test.mjs history-export.json
# whole app in a real browser: tablet + phone + owner (needs playwright, and the app running: npm run build && npm run preview)
APP_URL=http://localhost:4173 DB_URL=postgresql://… HISTORY=history-export.json node tests/e2e.mjs
```
Covered: login, PIN, add dish + undo, served, notes, live sync between devices, send to reception, reception view,
history per day, stock colors, offline then sync (also after a reload), owner day/week/month totals, per waiter,
best sellers, Excel + CSV export, owner delete + audit log, menu editor live, waiter management, import.

### Import the old history from the command line
```bash
SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_KEY=<secret key> npm run import-history -- history-export.json
```
(or, easier: Owner → *Import old history* in the app.)

`history-export.json` contains client names: it is in `.gitignore` on purpose. Do not commit it.
