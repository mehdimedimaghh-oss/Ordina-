# Setup guide — put Comande online (about 30 minutes)

You need 3 free accounts: **GitHub** (you have it, the code is there), **Supabase** (the database and logins) and **Vercel** (the website).
Do the steps in order. Copy and paste carefully.

---

## Step 1 — Create the database (Supabase)

1. Go to **https://supabase.com** → **Start your project** → **Continue with GitHub**.
2. Click **New project**.
   - **Name:** `comande`
   - **Database password:** click *Generate a password* and **save it** somewhere safe (a password manager or a paper in the office).
   - **Region:** choose **Europe (Frankfurt)** — or another *Europe* region. Important for privacy law (GDPR): the data stays in the EU.
   - Plan: **Free**.
3. Click **Create new project** and wait 1–2 minutes.

## Step 2 — Create the tables (one copy-paste)

1. In GitHub, open the file **`supabase/migrations/20261103000000_init.sql`** of this project and click the **Copy raw file** button (two squares icon).
2. In Supabase, in the left menu, click **SQL Editor** → **New query**.
3. Paste everything and click **Run** (bottom right).
4. You must see **"Success. No rows returned"**. If you see an error, send it to me.

This creates the tables, the security rules, your full menu with the old prices, and the waiters **Mehdi** and **Nikola** with PIN **0000** (you will change the PINs later).

## Step 3 — Create the two logins

In Supabase, left menu: **Authentication** → **Users** → **Add user** → **Create new user**.

Do it **two times**:

| Login | Email (example) | Password | What it is for |
|---|---|---|---|
| Owner | your real email | a strong password, only for you | you see all the history, prices, waiters |
| Staff | `staff@hotelconcordia.it` (it does not need to be a real mailbox) | a "restaurant password" (at least 8 characters) | you type it **one time** on each tablet/phone |

For both: tick **Auto Confirm User**, then **Create user**.

Then close the door to strangers: **Authentication** → **Sign In / Providers** (or **Providers** → **Email**) → turn **off** "Allow new users to sign up" → **Save**.

## Step 4 — Give each login its role

Go back to **SQL Editor** → **New query**, paste this, **change the two emails** to yours, then **Run**:

```sql
select set_user_role('your-real-email@example.com', 'owner');
select set_user_role('staff@hotelconcordia.it', 'staff');
```

You must see "… is now owner" and "… is now staff".

## Step 5 — Copy the 2 keys you need

In Supabase, click **Project Settings** (gear icon, bottom left):

- **Data API** (or the green **Connect** button at the top) → copy the **Project URL** — it looks like `https://abcdefgh.supabase.co`.
- **API Keys** → copy the **Publishable key** (`sb_publishable_…`) — or, on older pages, the **anon public** key (a long text starting with `eyJ…`). Both work.

⚠️ **Never** copy the *secret* / *service_role* key into Vercel or anywhere public. The website only needs the publishable (anon) key — it is safe because the security rules protect the data.

## Step 6 — Put the website online (Vercel)

1. Go to **https://vercel.com** → **Sign Up** → **Continue with GitHub** (choose the free *Hobby* plan).
2. Click **Add New…** → **Project** → find **ordina-** → **Import**.
   - If you don't see it: click *Adjust GitHub App Permissions* and allow Vercel to see the repository.
3. **Framework Preset:** Vite (Vercel finds it by itself). Do not change the build settings.
4. Open **Environment Variables** and add these **3** lines (Name → Value):

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | the Project URL from step 5 |
   | `VITE_SUPABASE_ANON_KEY` | the publishable (anon) key from step 5 |
   | `VITE_STAFF_EMAIL` | the staff email from step 3, e.g. `staff@hotelconcordia.it` |

5. Click **Deploy**. Wait about 1 minute. 🎉
6. Vercel shows your link, like **`https://ordina-xxxx.vercel.app`**. This is **your website link**.
   - You can choose a nicer name: **Project → Settings → Domains → Edit** (e.g. `comande-concordia.vercel.app`).
   - The code is on the branch `claude/hotel-restaurant-pwa-uiqvd2`. If Vercel deploys a different branch, set it in **Project → Settings → Git → Production Branch**.

If you change an Environment Variable later, you must **Redeploy** (Deployments → ⋯ → Redeploy).

## Step 7 — First login as owner, change the PINs, import the old history

1. Open your website link on your computer → **Owner** → your email + password.
2. **Waiters** tab → for Mehdi and Nikola write a **new 4-number PIN** → **Save**. Add the other waiters.
3. **Import old history** tab → choose your file **`history-export.json`** → **Import 6 orders**.
   You will see "Done: 6 imported". Click **Dashboard** → 1 and 2 November have the old orders.
   (You can import the same file again: nothing is doubled.)

## Step 8 — Install on the tablet and phones

On each device, open the website link once:

1. Tap **Waiter device**, type the **restaurant password** (step 3) → **Log in**. This is needed only one time per device.
2. Install it like an app:
   - **Android (Chrome):** menu **⋮** → **Install app** (or *Add to Home screen*).
   - **iPad / iPhone (Safari):** **Share** button → **Add to Home Screen**.
3. Now waiters open it from the home screen and only use **name + PIN**.

---

## Step 9 — Reception screen + reception login + guests (one time)

1. **Supabase → SQL Editor → New query**: paste **`supabase/migrations/20261105000000_reception_screen.sql`** → **Run** → "Success" (skip if already done).
2. Again **New query**: paste **`supabase/migrations/20261106000000_reception_login_covers.sql`** → **Run** → "Success".
3. **Authentication → Users → Add user → Create new user**: email for example `reception@hotelconcordia.it`, a password for the reception, tick **Auto Confirm User** → **Create user**.
4. **SQL Editor → New query**, run: `select set_user_role('reception@hotelconcordia.it', 'reception');` → "… is now reception".
5. On the reception PC: follow **GUIDE.md → For the reception**.

## Good to know

- **Free plans:** Supabase Free has 500 MB of database — enough for many years of lunch orders. A free Supabase project is **paused after 7 days with no use** (for example when the restaurant is closed for the season). Nothing is lost: open supabase.com and click **Restore project**.
- **Backups:** export to Excel from the Owner dashboard (Month view → Export Excel) once a month and keep the file. That is your own copy.
- **Privacy (GDPR):** client names and room numbers are personal data. They are only visible after login, the data is in the EU, nothing is public, search engines are blocked. History is never deleted automatically: decide how long you want to keep it and write it in your hotel privacy notice. Only the owner can delete an order, and every delete is saved in the **Audit log**.
- **Lost phone/tablet:** change the staff password in Supabase (**Authentication → Users → ⋯ → Reset/Update password**), then log in again on the other devices.
- **For a developer:** see README.md.
