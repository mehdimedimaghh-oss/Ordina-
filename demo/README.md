# Demo mode (for promo videos only)

The same app, with **invented data** and a **neutral brand** ("Comanda Live", "Ristorante Aurora"):
no real hotel, guests, staff, rooms or money. It is never deployed.

- `vite.config.js` – runs the app with the brand replaced and a local stand-in for Supabase
- `server.mjs` – answers the app with the REAL SQL (supabase/migrations) on a local Postgres
- `supabase-mock.js` – replaces the Supabase library in the demo
- `seed.mjs` – 60 days of invented orders, 5 open tables, stock, a guest in room 214 to check out
- `public/` – neutral logo and background

Start (needs a local Postgres on port 55432 with the migrations applied):
```bash
npm i --no-save pg
node demo/seed.mjs
npx vite --config demo/vite.config.js      # http://localhost:5199
```
Logins: staff `demo` (waiters Luca, Sara, Marco, Giulia, Paolo – PIN 1234),
`reception@demo.app` / `demo`, `owner@demo.app` / `demo`.

Staff schedule tests (demo database, after `supabase/migrations/20261126000000_staff_schedule.sql`):
```bash
psql -h /var/tmp/demopg -p 55432 -U postgres -d demo -f demo/staff_schedule_security.test.sql   # security, rolled back
node demo/staff_schedule_e2e.test.cjs /tmp                                                          # owner, waiter, reception, offline
```
