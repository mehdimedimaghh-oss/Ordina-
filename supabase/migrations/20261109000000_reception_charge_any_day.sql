-- =====================================================================
--  Comande Pranzo · reception can charge on ANY day (room bill paid at check-out)
--  - Reception sees the orders of the last 60 days + EVERY order not charged yet (any age),
--    so an unpaid room bill never disappears.
--  - Reception can tick / undo "Charged ✓" on those orders (not only today's).
--  - "Charge all": one tap charges all the orders of a room (mark_charged_many).
--  Waiters: unchanged (only today). Owner: unchanged (everything).
--  Includes 20261108000000_reception_history.sql: you can run only this file. Safe to run twice.
--  It does not change or delete any order: only who can read / tick "Charged".
-- =====================================================================

create or replace function public.reception_history_days() returns int
language sql immutable as $$ select 60 $$;
grant execute on function public.reception_history_days() to authenticated;

-- the rule "what can the reception see", in one place
create or replace function public.reception_can_see(p_day date, p_status text, p_charged timestamptz) returns boolean
language sql stable as $$
  select (p_day >= public.rome_today() - public.reception_history_days() and p_day <= public.rome_today())
      or (p_status = 'closed' and p_charged is null)
$$;
grant execute on function public.reception_can_see(date, text, timestamptz) to authenticated;

drop policy if exists "orders: owner all, staff + reception today" on public.orders;
drop policy if exists "orders: owner all, staff today, reception 60 days" on public.orders;
drop policy if exists "orders: owner all, staff today, reception 60 days + unpaid" on public.orders;
create policy "orders: owner all, staff today, reception 60 days + unpaid" on public.orders for select to authenticated
  using (public.is_owner()
         or (public.is_staff() and day = public.rome_today())
         or (public.is_reception() and public.reception_can_see(day, status, charged_at)));

drop policy if exists "lines follow orders" on public.order_lines;
create policy "lines follow orders" on public.order_lines for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (public.is_owner()
                      or (public.is_staff() and o.day = public.rome_today())
                      or (public.is_reception() and public.reception_can_see(o.day, o.status, o.charged_at)))));

create or replace function public.mark_charged(p_id bigint, p_charged boolean, p_by text default 'Reception')
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  if not (public.is_staff() or public.is_reception()) then raise exception 'Not allowed. Please log in again.' using errcode = '42501'; end if;
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'Order not found'; end if;
  if not public.is_owner() then
    if public.is_reception() then
      if not public.reception_can_see(o.day, o.status, o.charged_at) then raise exception 'Order not found'; end if;
    elsif o.day <> public.rome_today() then raise exception 'Only orders of today';
    end if;
  end if;
  if p_charged and o.status <> 'closed' then raise exception 'This order was reopened: wait for the new one'; end if;
  update public.orders set
    charged_at = case when p_charged then coalesce(charged_at, now()) else null end,
    charged_by = case when p_charged then coalesce(nullif(trim(p_by), ''), 'Reception') else null end
  where id = p_id returning * into o;
  perform public.audit(case when p_charged then 'order_charged' else 'order_uncharged' end, 'order', o.id::text,
    jsonb_build_object('table', o.table_no, 'total', o.total, 'day', o.day), coalesce(nullif(trim(p_by), ''), 'Reception'));
  return jsonb_build_object('ok', true, 'charged_at', o.charged_at);
end $$;
grant execute on function public.mark_charged(bigint, boolean, text) to authenticated;

-- "Charge all" for a room: all or nothing
create or replace function public.mark_charged_many(p_ids bigint[], p_by text default 'Reception')
returns jsonb language plpgsql security definer set search_path = public as $$
declare i bigint; n int := 0;
begin
  foreach i in array coalesce(p_ids, '{}') loop
    perform public.mark_charged(i, true, p_by); n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'charged', n);
end $$;
revoke all on function public.mark_charged_many(bigint[], text) from public, anon;
grant execute on function public.mark_charged_many(bigint[], text) to authenticated;
