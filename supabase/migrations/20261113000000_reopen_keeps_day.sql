-- =====================================================================
--  A reopened order keeps its ORIGINAL DAY.
--  Before: an order of yesterday, reopened and sent again today, was saved with today's date
--  (wrong day in the history, the reports and the reception). Now the reopened table remembers
--  the day of the order (open_tables.orig_day) and the new order is saved on that day.
--  Run once in Supabase → SQL Editor → Run. Safe to run again.
-- =====================================================================

alter table public.open_tables add column if not exists orig_day date;

create or replace function public.reopen_order(p_id bigint, p_token uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders; w public.waiters; d jsonb; l public.order_lines; v_day date;
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
                          'building', o.building, 'room', o.room_service, 'note', o.note, 'covers', o.covers,
                          'coverOff', (o.covers > 0 and o.cover_fee = 0));
  for l in select * from public.order_lines where order_id = o.id order by pos loop
    d := jsonb_set(d, array['items', l.item_id], to_jsonb(coalesce((d->'items'->>l.item_id)::int, 0) + l.qty));
    if l.note <> '' then d := jsonb_set(d, array['notes', l.item_id], to_jsonb(l.note)); end if;
  end loop;
  v_day := case when o.day < public.rome_today() then o.day end;   -- an order of an earlier day keeps that day
  insert into public.open_tables(table_no, data, waiter_id, waiter_name, opened_at, version, orig_day)
  values (o.table_no, d, o.waiter_id, o.waiter_name, now(), 1, v_day)
  on conflict (table_no) do update set data = excluded.data, waiter_id = excluded.waiter_id, waiter_name = excluded.waiter_name,
    opened_at = now(), updated_at = now(), version = public.open_tables.version + 1, orig_day = excluded.orig_day;
  update public.orders set status = 'reopened' where id = o.id;
  perform public.audit('order_reopen', 'order', o.id::text, jsonb_build_object('uid', o.uid, 'table', o.table_no, 'total', o.total, 'day', o.day), w.name);
  return jsonb_build_object('ok', true, 'table', o.table_no, 'day', o.day);
end $$;

create or replace function public.submit_order(p_order jsonb, p_token uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.waiters; v_id bigint; v_name text; v_closed timestamptz; v_day date; v_o jsonb;
begin
  perform public.require_staff();
  if coalesce(p_order->>'uid', '') = '' then raise exception 'Order without uid'; end if;
  if jsonb_array_length(coalesce(p_order->'items', '[]')) = 0 then raise exception 'The order is empty'; end if;
  select id into v_id from public.orders where uid = p_order->>'uid';
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'duplicate', true); end if;

  w := public.waiter_of(p_token);
  v_name := coalesce(w.name, nullif(trim(p_order->>'waiter'), ''), case when public.is_owner() then 'Owner' else '' end);
  v_closed := to_timestamp((p_order->>'closedAt')::double precision / 1000.0);
  -- a reopened order of an earlier day is saved on that day; any other order on the day it is sent
  select orig_day into v_day from public.open_tables where table_no = (p_order->>'table')::int;
  v_o := p_order - 'day';
  if v_day is not null and v_day < public.rome_today() then v_o := v_o || jsonb_build_object('day', v_day); end if;
  v_id := public.insert_order(v_o, w.id, v_name, 'app');
  delete from public.open_tables where table_no = (p_order->>'table')::int
    and (opened_at is null or opened_at <= v_closed + interval '2 seconds');
  -- Google Sheet copy: only if that optional part (RECEPTION-SHEET.md) is installed
  if to_regprocedure('public.sheet_notify(bigint,text)') is not null then
    execute 'select public.sheet_notify($1, $2)' using v_id, 'sent';
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'day', coalesce(v_day, public.rome_today()));
end $$;
