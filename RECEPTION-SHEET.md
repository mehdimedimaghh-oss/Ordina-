# Send every order to the reception's sheet (Google Sheets)

> **Optional.** The easier way is the **Reception screen** inside the app (pop-up + sound on the reception PC, see GUIDE.md). Use this Google Sheet only if you *also* want a live sheet.

When a waiter taps **Send to reception**, a new row appears **by itself**, within a few seconds, in a Google Sheet that the receptionist keeps open on the computer.

- **One tab per day** (for example `04-11-2026`). Today's tab is always the first one.
- **Each row:** time, table, client, building (HCO/DEP), room, dishes with notes, room service, note, total, waiter, status.
- **Reopened or deleted** orders are **crossed out**, so reception doesn't charge them twice.
- **Excel:** reception can download it any time with **File → Download → Microsoft Excel (.xlsx)**.
- **Without internet:** orders taken offline arrive in the sheet when the internet comes back.

⏱ About 10 minutes, **one time only**. Use a **computer** for steps 2–4: the Google script editor is hard to use on a phone.

---

## Step 1 — Update the database (Supabase)

1. In GitHub, open the file **`supabase/migrations/20261104000000_reception_sheet.sql`** → copy all of it.
2. In **Supabase → SQL Editor → New query**, paste it → **Run**.
3. You should see **"Success. No rows returned"**.

## Step 2 — Create the sheet

1. Go to **sheets.google.com**. Use the hotel's Google account if you have one.
2. Click **Blank** (empty sheet). Name it, for example, **Comande Reception**.

## Step 3 — Paste the small program

1. In the sheet's menu: **Extensions → Apps Script**. A new tab opens.
2. Delete everything you see there (`function myFunction() {…}`).
3. In GitHub, open **`scripts/reception-sheet.gs`** → copy all of it → paste it in Apps Script.
4. Click the **💾 Save** icon.

## Step 4 — Make the link

1. Click the blue **Deploy** button (top right) → **New deployment**.
2. Click the **⚙️ gear** next to "Select type" → **Web app**.
3. Fill in:
   - **Description:** `Comande`
   - **Execute as:** **Me**
   - **Who has access:** **Anyone**. This only lets the app *send* rows. Nobody can *read* your sheet through this link.
4. Click **Deploy**.
5. Google asks for permission: **Authorize access** → choose your account.
   - If you see **"Google hasn't verified this app"**: click **Advanced** → **Go to Comande (unsafe)** → **Allow**. It's your own program, so this is normal.
6. Copy the **Web app URL**. It starts with `https://script.google.com/macros/s/` and ends with **`/exec`**.
   - 🔒 Keep this link private. Don't post it anywhere public.

## Step 5 — Connect the app

1. Open the app → log in as **Owner** → tab **Reception sheet**.
2. Paste the link → **Save link**. Now it says **ON**.
3. Tap **Send a test row**. After a few seconds, a **TEST** row appears in your sheet. You can delete that row.

## Step 6 — Give it to reception

In the sheet: **Share** → add the receptionist's email → **Viewer** (they can only look) or **Editor** (they can also add their own notes). The receptionist keeps the sheet open on their computer: new orders appear by themselves.

---

## Good to know

- **The app is always the original.** If Google is slow or down, orders are still saved in the app as normal, and the full history stays in the Owner dashboard. The sheet is a copy for reception.
- **Stop sending:** Owner → Reception sheet → **Turn off**.
- **Last sends:** the Reception sheet page shows the last 5 sends. **✓ arrived** means Google received them.
- **If you change the program later:** in Apps Script → **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. The link stays the same.
- **Privacy (GDPR):** the sheet contains client names and room numbers. Share it only with reception. Delete old day tabs when you no longer need them, following your hotel's privacy notice.
