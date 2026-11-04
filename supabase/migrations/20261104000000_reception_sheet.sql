-- =====================================================================
--  Comande Pranzo · send every order to the reception's Google Sheet
--  Paste this whole file in Supabase → SQL Editor → Run (one time).
--  Then the owner pastes the Google Sheet link in the app:
--  Owner → Reception sheet. (See RECEPTION-SHEET.md)
-- =====================================================================

create extension if not exists pg_net with schema extensions;

-- Secret settings: nobody can read them from the app (no policy), only these functions.
create table if not exists public.private_settings (
  key   text primary key,
  value text not null
);
alter table public.private_settings enable row level security;
revoke all on public.private_settings from anon, authenticated;

-- Build the row for the sheet and send it (sent / reopened / deleted / test).
-- pg_net sends it after the save is finished, in the background: the waiter never waits for Google.
create or replace function public.sheet_notify(p_order_id bigint, p_event text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_url text; o public.orders; v_items text; v_rome timestamp;
begin
  select value into v_url from public.private_settings where key = 'sheet_url';
  if v_url is null or v_url = '' then return; end if;
  select * into o from public.orders where id = p_order_id;
  if not found then return; end if;
  select coalesce(string_agg(l.qty || 'x ' || l.name || case when l.note <> '' then ' (' || l.note || ')' else '' end, ', ' order by l.pos), '')
    into v_items from public.order_lines l where l.order_id = o.id;
  v_rome := o.closed_at at time zone 'Europe/Rome';
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'event', p_event, 'id', o.id, 'day', to_char(v_rome, 'DD/MM/YYYY'), 'time', to_char(v_rome, 'HH24:MI'),
      'table', o.table_no, 'client', o.client, 'building', o.building, 'room', o.room_no,
      'items', v_items, 'roomService', o.room_service, 'note', o.note, 'total', o.total, 'waiter', o.waiter_name),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 10000);
exception when others then
  -- the sheet must never block an order
  raise warning 'sheet_notify failed: %', sqlerrm;
end $$;
revoke all on function public.sheet_notify(bigint, text) from public, anon, authenticated;

-- Hook it into "Send to reception", "Reopen" and owner "Delete"
create or replace function public.orders_sheet_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status = 'reopened' and old.status <> 'reopened' then
    perform public.sheet_notify(new.id, 'reopened');
  end if;
  return new;
end $$;
drop trigger if exists orders_sheet_reopen on public.orders;
create trigger orders_sheet_reopen after update of status on public.orders
  for each row execute function public.orders_sheet_trigger();

-- "Send to reception": same as before + send the row to the sheet (only the first time, not on offline retries)
create or replace function public.submit_order(p_order jsonb, p_token uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.waiters; v_id bigint; v_name text; v_closed timestamptz;
begin
  perform public.require_staff();
  if coalesce(p_order->>'uid', '') = '' then raise exception 'Order without uid'; end if;
  if jsonb_array_length(coalesce(p_order->'items', '[]')) = 0 then raise exception 'The order is empty'; end if;
  select id into v_id from public.orders where uid = p_order->>'uid';
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'duplicate', true); end if;

  w := public.waiter_of(p_token);
  v_name := coalesce(w.name, nullif(trim(p_order->>'waiter'), ''), case when public.is_owner() then 'Owner' else '' end);
  v_id := public.insert_order(p_order - 'day', w.id, v_name, 'app');
  v_closed := to_timestamp((p_order->>'closedAt')::double precision / 1000.0);
  delete from public.open_tables where table_no = (p_order->>'table')::int
    and (opened_at is null or opened_at <= v_closed + interval '2 seconds');
  perform public.sheet_notify(v_id, 'sent');
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
drop trigger if exists order_lines_sheet on public.order_lines;
drop function if exists public.order_lines_sheet_trigger();

create or replace function public.orders_sheet_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.sheet_notify(old.id, 'deleted');
  return old;
end $$;
drop trigger if exists orders_sheet_delete on public.orders;
create trigger orders_sheet_delete before delete on public.orders
  for each row execute function public.orders_sheet_delete();

-- Owner: save the Google Sheet link (empty = stop sending)
create or replace function public.owner_set_sheet_url(p_url text) returns text
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_owner();
  p_url := trim(coalesce(p_url, ''));
  if p_url = '' then
    delete from public.private_settings where key = 'sheet_url';
    perform public.audit('sheet_off', 'settings', 'sheet_url', null);
    return 'off';
  end if;
  if p_url !~ '^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$' then
    raise exception 'This is not a Google Apps Script web app link. It must start with https://script.google.com/macros/s/ and end with /exec';
  end if;
  insert into public.private_settings(key, value) values ('sheet_url', p_url)
  on conflict (key) do update set value = excluded.value;
  perform public.audit('sheet_on', 'settings', 'sheet_url', null);
  return 'on';
end $$;

-- Owner: is it on? what happened to the last sends?
create or replace function public.owner_sheet_status() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_url text; v_last jsonb;
begin
  perform public.require_owner();
  select value into v_url from public.private_settings where key = 'sheet_url';
  begin
    select coalesce(jsonb_agg(x order by x.created desc), '[]') into v_last from (
      select r.status_code, r.error_msg, r.created from net._http_response r order by r.created desc limit 5) x;
  exception when others then v_last := '[]';
  end;
  return jsonb_build_object('on', v_url is not null,
    'url_end', case when v_url is null then null else '…' || right(v_url, 12) end, 'last', v_last);
end $$;

-- Owner: send a test row
create or replace function public.owner_sheet_test() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_url text;
begin
  perform public.require_owner();
  select value into v_url from public.private_settings where key = 'sheet_url';
  if v_url is null then raise exception 'First save the Google Sheet link.'; end if;
  perform net.http_post(url := v_url,
    body := jsonb_build_object('event', 'test', 'id', 0, 'day', to_char(now() at time zone 'Europe/Rome', 'DD/MM/YYYY'),
      'time', to_char(now() at time zone 'Europe/Rome', 'HH24:MI'), 'table', 0, 'client', 'TEST', 'building', '', 'room', '',
      'items', 'Test from Comande — you can delete this row', 'roomService', false, 'note', '', 'total', 0, 'waiter', ''),
    headers := '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds := 10000);
end $$;

revoke execute on function public.owner_set_sheet_url(text), public.owner_sheet_status(), public.owner_sheet_test() from public, anon;
grant execute on function public.owner_set_sheet_url(text), public.owner_sheet_status(), public.owner_sheet_test() to authenticated;
