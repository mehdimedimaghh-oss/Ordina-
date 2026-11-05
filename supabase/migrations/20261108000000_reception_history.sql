-- =====================================================================
--  Comande Pranzo · reception history
--  The reception can LOOK at the orders of the last 60 days (to check a day or a room).
--  Read only: "Charged ✓" stays for today's orders, nothing can be changed or deleted.
--  Waiters still see only today; the owner still sees everything.
--  Safe to run on a database that is in use: it only changes who can read, no order is touched.
--  Run in Supabase → SQL Editor (after 20261106000000_reception_login_covers.sql).
-- =====================================================================

create or replace function public.reception_history_days() returns int
language sql immutable as $$ select 60 $$;
grant execute on function public.reception_history_days() to authenticated;

drop policy if exists "orders: owner all, staff + reception today" on public.orders;
drop policy if exists "orders: owner all, staff today, reception 60 days" on public.orders;
create policy "orders: owner all, staff today, reception 60 days" on public.orders for select to authenticated
  using (public.is_owner()
         or (public.is_staff() and day = public.rome_today())
         or (public.is_reception() and day >= public.rome_today() - public.reception_history_days() and day <= public.rome_today()));

drop policy if exists "lines follow orders" on public.order_lines;
create policy "lines follow orders" on public.order_lines for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (public.is_owner()
                      or (public.is_staff() and o.day = public.rome_today())
                      or (public.is_reception() and o.day >= public.rome_today() - public.reception_history_days() and o.day <= public.rome_today()))));
