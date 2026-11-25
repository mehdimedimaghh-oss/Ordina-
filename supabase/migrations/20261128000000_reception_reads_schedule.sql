-- =====================================================================
--  RECEPTION CAN SEE THE STAFF SCHEDULE (read only)
--  The reception screen shows "Chi lavora oggi" and the whole team's month.
--  Only adds two READ rules. Writing the schedule stays owner-only (owner_save_month);
--  nobody can insert / change / delete these tables directly. Nothing else changes.
--  Run once in Supabase → SQL Editor → Run. Safe to run again.
-- =====================================================================
drop policy if exists "reception reads months" on public.staff_months;
drop policy if exists "reception reads shifts" on public.staff_shifts;
create policy "reception reads months" on public.staff_months for select to authenticated using (public.is_reception());
create policy "reception reads shifts" on public.staff_shifts for select to authenticated using (public.is_reception());
