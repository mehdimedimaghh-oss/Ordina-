-- =====================================================================
--  Comande Pranzo · 1) own login for the reception  2) number of guests (coperti)
--  Paste this whole file in Supabase → SQL Editor → Run (one time).
--  Then create the reception login (Authentication → Users → Add user) and run:
--     select set_user_role('reception@hotelconcordia.it', 'reception');
-- =====================================================================

-- 1) a third role: reception (sees today's orders, can tick "Charged", cannot take orders)
alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users add constraint app_users_role_check check (role in ('owner', 'staff', 'reception'));

create or replace function public.is_reception() returns boolean
language sql stable as $$ select coalesce(public.my_role() = 'reception', false) $$;
grant execute on function public.is_reception() to authenticated;

drop policy if exists "orders: owner all, staff today" on public.orders;
create policy "orders: owner all, staff + reception today" on public.orders for select to authenticated
  using (public.is_owner() or ((public.is_staff() or public.is_reception()) and day = public.rome_today()));
drop policy if exists "lines follow orders" on public.order_lines;
create policy "lines follow orders" on public.order_lines for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (public.is_owner() or ((public.is_staff() or public.is_reception()) and o.day = public.rome_today()))));

create or replace function public.mark_charged(p_id bigint, p_charged boolean, p_by text default 'Reception')
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  if not (public.is_staff() or public.is_reception()) then raise exception 'Not allowed. Please log in again.' using errcode = '42501'; end if;
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'Order not found'; end if;
  if not public.is_owner() and o.day <> public.rome_today() then raise exception 'Only orders of today'; end if;
  if p_charged and o.status <> 'closed' then raise exception 'This order was reopened: wait for the new one'; end if;
  update public.orders set
    charged_at = case when p_charged then coalesce(charged_at, now()) else null end,
    charged_by = case when p_charged then coalesce(nullif(trim(p_by), ''), 'Reception') else null end
  where id = p_id returning * into o;
  perform public.audit(case when p_charged then 'order_charged' else 'order_uncharged' end, 'order', o.id::text,
    jsonb_build_object('table', o.table_no, 'total', o.total, 'day', o.day), coalesce(nullif(trim(p_by), ''), 'Reception'));
  return jsonb_build_object('ok', true, 'charged_at', o.charged_at);
end $$;

-- 2) number of guests (coperti) on open tables and in the history
alter table public.orders add column if not exists covers int not null default 0;

create or replace function public.table_op(p_table int, p_op jsonb, p_token uuid default null)
returns public.open_tables language plpgsql security definer set search_path = public as $$
declare
  r public.open_tables; d jsonb; w public.waiters;
  v_id text; q_old int; q_new int; k text; v jsonb; was_open boolean; is_open boolean;
begin
  perform public.require_staff();
  if p_table is null or p_table < 1 or p_table > 30 then raise exception 'Table must be 1 to 30'; end if;
  w := public.waiter_of(p_token);

  insert into public.open_tables(table_no) values (p_table) on conflict do nothing;
  select * into r from public.open_tables where table_no = p_table for update;
  d := coalesce(r.data, '{}'::jsonb);
  d := jsonb_build_object(
        'items', coalesce(d->'items', '{}'), 'notes', coalesce(d->'notes', '{}'), 'served', coalesce(d->'served', '{}'),
        'client', coalesce(d->>'client', ''), 'roomNo', coalesce(d->>'roomNo', ''), 'building', coalesce(d->>'building', ''),
        'room', coalesce((d->>'room')::boolean, false), 'note', coalesce(d->>'note', ''),
        'covers', coalesce((d->>'covers')::int, 0));
  was_open := d->'items' <> '{}'::jsonb;
  v_id := p_op->>'id';

  case p_op->>'t'
  when 'item' then
    q_old := coalesce((d->'items'->>v_id)::int, 0);
    q_new := greatest(0, q_old + coalesce((p_op->>'d')::int, 0));
    if q_new = 0 then
      d := jsonb_set(d, '{items}', (d->'items') - v_id);
      d := jsonb_set(d, '{notes}', (d->'notes') - v_id);
      d := jsonb_set(d, '{served}', (d->'served') - v_id);
    else
      d := jsonb_set(d, array['items', v_id], to_jsonb(q_new));
      if coalesce((d->'served'->>v_id)::int, 0) > q_new then
        d := jsonb_set(d, array['served', v_id], to_jsonb(q_new));
      end if;
    end if;
    perform public.stock_move(v_id, q_old - q_new);
  when 'served' then
    q_old := coalesce((d->'items'->>v_id)::int, 0);
    if q_old > 0 then
      d := jsonb_set(d, array['served', v_id], to_jsonb(least(q_old, greatest(0, coalesce((p_op->>'n')::int, 0)))));
    end if;
  when 'inote' then
    if coalesce(trim(p_op->>'note'), '') = '' then
      d := jsonb_set(d, '{notes}', (d->'notes') - v_id);
    elsif (d->'items') ? v_id then
      d := jsonb_set(d, array['notes', v_id], to_jsonb(left(p_op->>'note', 300)));
    end if;
  when 'set' then
    for k, v in select * from jsonb_each(coalesce(p_op->'fields', '{}')) loop
      if k in ('client', 'roomNo', 'note') then d := jsonb_set(d, array[k], to_jsonb(left(coalesce(v #>> '{}', ''), 500)));
      elsif k = 'building' and coalesce(v #>> '{}', '') in ('', 'HCO', 'DEP') then d := jsonb_set(d, '{building}', to_jsonb(coalesce(v #>> '{}', '')));
      elsif k = 'room' then d := jsonb_set(d, '{room}', to_jsonb(coalesce((v #>> '{}')::boolean, false)));
      elsif k = 'covers' then d := jsonb_set(d, '{covers}', to_jsonb(least(99, greatest(0, coalesce((v #>> '{}')::int, 0)))));
      end if;
    end loop;
  when 'clear' then
    for k, v in select * from jsonb_each(d->'items') loop
      perform public.stock_move(k, (v #>> '{}')::int);   -- give the food back to stock
    end loop;
    perform public.audit('table_clear', 'table', p_table::text, d, w.name);
    delete from public.open_tables where table_no = p_table;
    r.data := '{}'::jsonb; r.version := r.version + 1; r.opened_at := null;
    return r;
  else
    raise exception 'Unknown change %', p_op->>'t';
  end case;

  is_open := d->'items' <> '{}'::jsonb;
  if not is_open and d->>'client' = '' and d->>'roomNo' = '' and d->>'note' = '' and d->>'building' = '' and not (d->>'room')::boolean and (d->>'covers')::int = 0 then
    delete from public.open_tables where table_no = p_table;
    r.data := '{}'::jsonb; r.version := r.version + 1; r.opened_at := null;
    return r;
  end if;

  update public.open_tables set
    data = d,
    opened_at = case when is_open and not was_open then now() when not is_open then null else opened_at end,
    waiter_id = case when (not was_open and is_open) or waiter_id is null then coalesce(w.id, waiter_id) else waiter_id end,
    waiter_name = case when (not was_open and is_open) or waiter_name is null then coalesce(w.name, waiter_name) else waiter_name end,
    updated_at = now(),
    version = version + 1
  where table_no = p_table returning * into r;
  return r;
end $$;

create or replace function public.insert_order(o jsonb, p_waiter_id uuid, p_waiter_name text, p_source text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_closed timestamptz; v_day date; v_total numeric := 0; v_fee numeric; l jsonb; i int := 0;
begin
  v_closed := to_timestamp(coalesce((o->>'closedAt')::double precision, extract(epoch from now()) * 1000) / 1000.0);
  if v_closed > now() + interval '5 minutes' then v_closed := now(); end if;
  v_day := coalesce((o->>'day')::date, (v_closed at time zone 'Europe/Rome')::date);
  v_fee := case when coalesce((o->>'roomService')::boolean, false)
                then coalesce((o->>'roomFee')::numeric, (select (value #>> '{}')::numeric from public.settings where key = 'room_fee'), 10) else 0 end;
  for l in select * from jsonb_array_elements(coalesce(o->'items', '[]')) loop
    v_total := v_total + (l->>'qty')::int * (l->>'p')::numeric;
  end loop;
  v_total := v_total + v_fee;

  insert into public.orders(uid, day, closed_at, table_no, client, room_no, building, waiter_id, waiter_name,
                            room_service, room_fee, note, total, source, covers)
  values (o->>'uid', v_day, v_closed, (o->>'table')::int, coalesce(trim(o->>'client'), ''), coalesce(trim(o->>'roomNo'), ''),
          case when o->>'building' in ('HCO', 'DEP') then o->>'building' else '' end,
          p_waiter_id, coalesce(p_waiter_name, ''), coalesce((o->>'roomService')::boolean, false), v_fee,
          coalesce(trim(o->>'note'), ''), v_total, p_source, least(99, greatest(0, coalesce((o->>'covers')::int, 0))))
  on conflict (uid) do nothing
  returning id into v_id;
  if v_id is null then return null; end if;   -- already saved before (retry after offline)

  for l in select * from jsonb_array_elements(coalesce(o->'items', '[]')) loop
    i := i + 1;
    insert into public.order_lines(order_id, pos, item_id, name, section, qty, price, note)
    values (v_id, i, coalesce(l->>'id', ''), coalesce(l->>'it', ''), coalesce(l->>'sec', ''), (l->>'qty')::int, (l->>'p')::numeric, coalesce(trim(l->>'note'), ''));
  end loop;
  return v_id;
end $$;
revoke all on function public.insert_order(jsonb, uuid, text, text) from public, anon, authenticated;

create or replace function public.reopen_order(p_id bigint, p_token uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders; w public.waiters; d jsonb; l public.order_lines;
begin
  perform public.require_staff();   -- (waiters and owner; not reception)
  select * into o from public.orders where id = p_id for update;
  if not found or o.status <> 'closed' then raise exception 'Order not found'; end if;
  if not public.is_owner() and o.day <> public.rome_today() then raise exception 'Only orders of today can be reopened'; end if;
  if exists (select 1 from public.open_tables where table_no = o.table_no and data->'items' <> '{}'::jsonb) then
    raise exception 'Table % already has an open order', o.table_no;
  end if;
  w := public.waiter_of(p_token);
  d := jsonb_build_object('items', '{}'::jsonb, 'notes', '{}'::jsonb, 'served', '{}'::jsonb, 'client', o.client, 'roomNo', o.room_no,
                          'building', o.building, 'room', o.room_service, 'note', o.note, 'covers', o.covers);
  for l in select * from public.order_lines where order_id = o.id order by pos loop
    d := jsonb_set(d, array['items', l.item_id], to_jsonb(coalesce((d->'items'->>l.item_id)::int, 0) + l.qty));
    if l.note <> '' then d := jsonb_set(d, array['notes', l.item_id], to_jsonb(l.note)); end if;
  end loop;
  insert into public.open_tables(table_no, data, waiter_id, waiter_name, opened_at, version)
  values (o.table_no, d, o.waiter_id, o.waiter_name, now(), 1)
  on conflict (table_no) do update set data = excluded.data, waiter_id = excluded.waiter_id, waiter_name = excluded.waiter_name,
    opened_at = now(), updated_at = now(), version = public.open_tables.version + 1;
  update public.orders set status = 'reopened' where id = o.id;
  perform public.audit('order_reopen', 'order', o.id::text, jsonb_build_object('uid', o.uid, 'table', o.table_no, 'total', o.total), w.name);
  return jsonb_build_object('ok', true, 'table', o.table_no);
end $$;
