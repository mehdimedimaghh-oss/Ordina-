# Security & backups — checklist for the owner

The money data is safe in two ways: **nobody can get in** (accounts + database rules) and **nothing can be lost** (backups).

## What the app already does
- Nothing is public: every page and every number needs a login. Search engines are blocked.
- **Row Level Security** in the database: waiters see only today's orders; reception sees only today's orders and "Charged"; only the owner sees all history, prices, waiters and the audit log.
- Only the owner can delete an order — and a full copy goes into the **Audit log** (who, what, when). History is never deleted automatically.
- Waiter PINs are encrypted; 5 wrong PINs → 1 minute lock.
- The website only contains the *publishable* key, which is safe to be public. The **secret key is never** in the website or in GitHub (checked: none in the whole GitHub history).
- HTTPS everywhere (Vercel + Supabase).

## Do these once (30 minutes)
1. **Two-step login (2FA) on the 4 accounts that control everything** — with an app like Google Authenticator:
   - **GitHub**: Settings → Password and authentication → Two-factor authentication.
   - **Supabase**: your avatar → Account preferences → Multi-factor authentication.
   - **Vercel**: Account Settings → Authentication → Two-Factor.
   - **Your email** (Gmail: myaccount.google.com → Security → 2-Step Verification). Whoever has your email can reset the others.
2. **Strong, different passwords** (a password manager helps: iCloud Keychain, Google Password Manager, 1Password, Bitwarden). Never reuse the owner password anywhere else.
3. **Make the GitHub project private**: github.com/mehdimedimaghh-oss/Ordina- → Settings → (bottom) Danger Zone → Change visibility → **Private**. Vercel keeps working.
4. **Supabase → Authentication → Sign In / Providers → Email**: keep **"Allow new users to sign up" OFF**. Also turn on **"Prevent use of leaked passwords"** if your plan shows it.
5. **Never send** passwords or the **secret** Supabase key in chat, email or WhatsApp.

## Backups (so money data is never lost)
- **Every week**: Owner → **Backup & import** → **Download full backup**. You get:
  - `comande_ALL_ORDERS_date.xlsx` — every order since day one, to read;
  - `comande_BACKUP_date.json` — to **restore**: Owner → Backup & import → Import. Orders already there are skipped, missing ones come back.
- Keep the files in **2 places** (e.g. Google Drive + a USB stick).
- The dashboard reminds you if your last backup is older than 30 days.
- **Recommended for a business:** Supabase **Pro** plan (about $25/month): automatic daily backups (kept 7 days) and the project is never paused.

## If something happens
- **Lost / stolen tablet or phone**: change the staff password (Supabase → Authentication → Users → staff user → reset/update password) and log in again on the other devices. Change the PINs of the waiters who used it.
- **A waiter leaves**: Owner → Waiters → untick **Active**.
- **Someone may know the owner password**: change it in Supabase (Authentication → Users → your user) and check the **Audit log**.
- **Data looks wrong / missing**: don't panic — import the latest `comande_BACKUP_….json` (nothing is doubled).
