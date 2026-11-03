-- =====================================================================
--  Comande Pranzo · database setup
--  Paste this whole file in Supabase → SQL Editor → Run (one time).
--  It creates the tables, the security rules (Row Level Security),
--  the server functions and the menu from the old comande.html.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Who is who: every login (auth user) gets a role: owner or staff
-- ---------------------------------------------------------------------
create table public.app_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null check (role in ('owner','staff')),
  created_at timestamptz not null default now()
);

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.app_users where user_id = auth.uid()
$$;
create or replace function public.is_owner() returns boolean
language sql stable as $$ select coalesce(public.my_role() = 'owner', false) $$;
create or replace function public.is_staff() returns boolean
language sql stable as $$ select coalesce(public.my_role() in ('owner','staff'), false) $$;

-- Today in Italy (orders are grouped by Italian day)
create or replace function public.rome_today() returns date
language sql stable as $$ select (now() at time zone 'Europe/Rome')::date $$;

-- Run in the SQL editor:  select set_user_role('you@example.com','owner');
create or replace function public.set_user_role(p_email text, p_role text) returns text
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(p_email);
  if v_id is null then
    raise exception 'No login with email %. First create it in Authentication → Users.', p_email;
  end if;
  if p_role is null then
    delete from public.app_users where user_id = v_id;
    return p_email || ' has no role now';
  end if;
  insert into public.app_users(user_id, role) values (v_id, p_role)
  on conflict (user_id) do update set role = excluded.role;
  return p_email || ' is now ' || p_role;
end $$;

-- ---------------------------------------------------------------------
-- 2. Audit log: who did what and when (never deleted)
-- ---------------------------------------------------------------------
create table public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  user_id    uuid default auth.uid(),
  user_email text default (auth.jwt() ->> 'email'),
  waiter     text,
  action     text not null,
  entity     text,
  entity_id  text,
  details    jsonb
);
create index audit_log_at on public.audit_log(at desc);

create or replace function public.audit(p_action text, p_entity text, p_entity_id text, p_details jsonb, p_waiter text default null)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log(action, entity, entity_id, details, waiter)
  values (p_action, p_entity, p_entity_id, p_details, p_waiter)
$$;

-- ---------------------------------------------------------------------
-- 3. Waiters (name + 4-digit PIN, the PIN is stored encrypted)
-- ---------------------------------------------------------------------
create table public.waiters (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  pin_hash        text not null,
  active          boolean not null default true,
  sort            int not null default 0,
  failed_attempts int not null default 0,
  locked_until    timestamptz,
  created_at      timestamptz not null default now()
);
create unique index waiters_name on public.waiters(lower(name));

create table public.waiter_sessions (
  token      uuid primary key default gen_random_uuid(),
  waiter_id  uuid not null references public.waiters(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);

-- ---------------------------------------------------------------------
-- 4. Menu, stock, settings
-- ---------------------------------------------------------------------
create table public.menu_items (
  id         text primary key,
  section    text not null check (section in ('primi','secondi','dolci','pinsa','aperitivo','caffe','bibite','cocktail','vino','liquori')),
  name_it    text not null,
  name_en    text not null default '',
  price      numeric(8,2) not null check (price >= 0),
  sort       int not null default 0,
  hidden     boolean not null default false,
  updated_at timestamptz not null default now()
);

-- one row = this dish is counted; no row = "not counted"
create table public.stock (
  item_id    text primary key references public.menu_items(id) on delete cascade,
  remaining  int not null,
  updated_at timestamptz not null default now()
);

create table public.settings (
  key   text primary key,
  value jsonb not null
);
insert into public.settings(key, value) values ('stock_alert', '2'), ('room_fee', '10');

-- ---------------------------------------------------------------------
-- 5. Open tables (live on every device)
--    data = {items:{id:qty}, notes:{id:text}, served:{id:n},
--            client, roomNo, building, room(bool), note}
-- ---------------------------------------------------------------------
create table public.open_tables (
  table_no    int primary key check (table_no between 1 and 30),
  data        jsonb not null default '{}'::jsonb,
  waiter_id   uuid references public.waiters(id) on delete set null,
  waiter_name text,
  opened_at   timestamptz,
  updated_at  timestamptz not null default now(),
  version     bigint not null default 0
);

-- ---------------------------------------------------------------------
-- 6. Orders sent to reception (history, kept forever)
-- ---------------------------------------------------------------------
create table public.orders (
  id           bigint generated always as identity primary key,
  uid          text not null unique,
  day          date not null,
  closed_at    timestamptz not null,
  table_no     int not null,
  client       text not null default '',
  room_no      text not null default '',
  building     text not null default '' check (building in ('','HCO','DEP')),
  waiter_id    uuid references public.waiters(id) on delete set null,
  waiter_name  text not null default '',
  room_service boolean not null default false,
  room_fee     numeric(8,2) not null default 0,
  note         text not null default '',
  total        numeric(10,2) not null,
  status       text not null default 'closed' check (status in ('closed','reopened')),
  source       text not null default 'app',
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index orders_day on public.orders(day);

create table public.order_lines (
  id       bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  pos      int not null default 0,
  item_id  text not null,
  name     text not null,
  section  text not null default '',
  qty      int not null check (qty > 0),
  price    numeric(8,2) not null,
  note     text not null default ''
);
create index order_lines_order on public.order_lines(order_id);

-- ---------------------------------------------------------------------
-- 7. Row Level Security: nothing is public, everything needs a login
-- ---------------------------------------------------------------------
alter table public.app_users       enable row level security;
alter table public.audit_log       enable row level security;
alter table public.waiters         enable row level security;
alter table public.waiter_sessions enable row level security;
alter table public.menu_items      enable row level security;
alter table public.stock           enable row level security;
alter table public.settings        enable row level security;
alter table public.open_tables     enable row level security;
alter table public.orders          enable row level security;
alter table public.order_lines     enable row level security;

revoke all on all tables in schema public from anon;

create policy "see own role"      on public.app_users  for select to authenticated using (user_id = auth.uid() or public.is_owner());
create policy "owner reads audit" on public.audit_log  for select to authenticated using (public.is_owner());
create policy "staff sees waiters" on public.waiters   for select to authenticated using (public.is_staff());
-- the PIN hash is never readable from the app
revoke select on public.waiters from authenticated;
grant select (id, name, active, sort, created_at) on public.waiters to authenticated;

create policy "staff reads menu"   on public.menu_items for select to authenticated using (public.is_staff());
create policy "owner adds dishes"  on public.menu_items for insert to authenticated with check (public.is_owner());
create policy "owner edits dishes" on public.menu_items for update to authenticated using (public.is_owner()) with check (public.is_owner());

create policy "staff reads stock"    on public.stock       for select to authenticated using (public.is_staff());
create policy "staff reads settings" on public.settings    for select to authenticated using (public.is_staff());
create policy "staff reads tables"   on public.open_tables for select to authenticated using (public.is_staff());

-- waiters: only today's orders · owner: all history
create policy "orders: owner all, staff today" on public.orders for select to authenticated
  using (public.is_owner() or (public.is_staff() and day = public.rome_today()));
create policy "lines follow orders" on public.order_lines for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (public.is_owner() or (public.is_staff() and o.day = public.rome_today()))));

-- (All writes to tables, stock, orders go through the functions below.)

-- Log every menu change (price, name, hidden)
create or replace function public.menu_items_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    perform public.audit('menu_add', 'menu_item', new.id, to_jsonb(new));
  elsif (old.price, old.name_it, old.name_en, old.hidden, old.section) is distinct from (new.price, new.name_it, new.name_en, new.hidden, new.section) then
    perform public.audit('menu_edit', 'menu_item', new.id, jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new)));
  end if;
  return new;
end $$;
create trigger menu_items_log before insert or update on public.menu_items
  for each row execute function public.menu_items_log();

-- ---------------------------------------------------------------------
-- 8. Functions used by the app
-- ---------------------------------------------------------------------
create or replace function public.require_staff() returns void language plpgsql stable as $$
begin
  if not public.is_staff() then raise exception 'Not allowed. Please log in again.' using errcode = '42501'; end if;
end $$;
create or replace function public.require_owner() returns void language plpgsql stable as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can do this.' using errcode = '42501'; end if;
end $$;

-- Waiter for a PIN session token (null when unknown or expired)
create or replace function public.waiter_of(p_token uuid) returns public.waiters
language sql stable security definer set search_path = public as $$
  select w.* from public.waiter_sessions s join public.waiters w on w.id = s.waiter_id
  where s.token = p_token and s.expires_at > now()
$$;
revoke all on function public.waiter_of(uuid) from public, anon, authenticated;

-- Waiter PIN login. 5 wrong PINs → locked for 1 minute.
create or replace function public.waiter_login(p_waiter uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare w public.waiters; v_token uuid;
begin
  perform public.require_staff();
  select * into w from public.waiters where id = p_waiter and active for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Waiter not found'); end if;
  if w.locked_until is not null and w.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'Too many wrong PINs. Wait one minute.');
  end if;
  if w.pin_hash = extensions.crypt(coalesce(p_pin, ''), w.pin_hash) then
    update public.waiters set failed_attempts = 0, locked_until = null where id = w.id;
    delete from public.waiter_sessions where expires_at < now();
    insert into public.waiter_sessions(waiter_id) values (w.id) returning token into v_token;
    return jsonb_build_object('ok', true, 'token', v_token, 'id', w.id, 'name', w.name);
  end if;
  update public.waiters set
    failed_attempts = case when w.failed_attempts + 1 >= 5 then 0 else w.failed_attempts + 1 end,
    locked_until    = case when w.failed_attempts + 1 >= 5 then now() + interval '1 minute' else null end
  where id = w.id;
  return jsonb_build_object('ok', false, 'error', 'Wrong PIN');
end $$;

-- Owner: add or change a waiter (p_pin null = keep the old PIN)
create or replace function public.owner_save_waiter(p_id uuid, p_name text, p_pin text, p_active boolean default true)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  perform public.require_owner();
  if coalesce(trim(p_name), '') = '' then raise exception 'Name is empty'; end if;
  if p_pin is not null and p_pin !~ '^[0-9]{4}$' then raise exception 'The PIN must be 4 numbers'; end if;
  if p_id is null then
    if p_pin is null then raise exception 'A new waiter needs a PIN'; end if;
    insert into public.waiters(name, pin_hash, active, sort)
    values (trim(p_name), extensions.crypt(p_pin, extensions.gen_salt('bf')), coalesce(p_active, true),
            (select coalesce(max(sort), 0) + 1 from public.waiters))
    returning id into v_id;
    perform public.audit('waiter_add', 'waiter', v_id::text, jsonb_build_object('name', trim(p_name)));
  else
    update public.waiters set
      name = trim(p_name),
      active = coalesce(p_active, active),
      pin_hash = case when p_pin is null then pin_hash else extensions.crypt(p_pin, extensions.gen_salt('bf')) end,
      failed_attempts = 0, locked_until = null
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Waiter not found'; end if;
    if p_pin is not null then delete from public.waiter_sessions where waiter_id = p_id; end if;
    perform public.audit('waiter_edit', 'waiter', v_id::text,
      jsonb_build_object('name', trim(p_name), 'active', p_active, 'pin_changed', p_pin is not null));
  end if;
  return v_id;
end $$;

-- Change stock of one dish by delta (only if counted). Internal.
create or replace function public.stock_move(p_item text, p_delta int) returns void
language sql security definer set search_path = public as $$
  update public.stock set remaining = remaining + p_delta, updated_at = now()
  where item_id = p_item and p_delta <> 0
$$;
revoke all on function public.stock_move(text, int) from public, anon, authenticated;

-- One change on an open table. Ops:
--  {t:'item', id, d}  {t:'served', id, n}  {t:'inote', id, note}
--  {t:'set', fields:{client, roomNo, building, room, note}}  {t:'clear'}
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
        'room', coalesce((d->>'room')::boolean, false), 'note', coalesce(d->>'note', ''));
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
  if not is_open and d->>'client' = '' and d->>'roomNo' = '' and d->>'note' = '' and d->>'building' = '' and not (d->>'room')::boolean then
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

-- Insert one order + its lines. Internal, used by submit_order and import.
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
                            room_service, room_fee, note, total, source)
  values (o->>'uid', v_day, v_closed, (o->>'table')::int, coalesce(trim(o->>'client'), ''), coalesce(trim(o->>'roomNo'), ''),
          case when o->>'building' in ('HCO', 'DEP') then o->>'building' else '' end,
          p_waiter_id, coalesce(p_waiter_name, ''), coalesce((o->>'roomService')::boolean, false), v_fee,
          coalesce(trim(o->>'note'), ''), v_total, p_source)
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

-- "Send to reception": save the order in history and free the table.
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
  -- free the table, but not if somebody opened it again after this order was closed
  delete from public.open_tables where table_no = (p_order->>'table')::int
    and (opened_at is null or opened_at <= v_closed + interval '2 seconds');
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Reopen a sent order (mistake): it goes back to its table, the history keeps it marked "reopened".
create or replace function public.reopen_order(p_id bigint, p_token uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders; w public.waiters; d jsonb; l public.order_lines;
begin
  perform public.require_staff();
  select * into o from public.orders where id = p_id for update;
  if not found or o.status <> 'closed' then raise exception 'Order not found'; end if;
  if not public.is_owner() and o.day <> public.rome_today() then raise exception 'Only orders of today can be reopened'; end if;
  if exists (select 1 from public.open_tables where table_no = o.table_no and data->'items' <> '{}'::jsonb) then
    raise exception 'Table % already has an open order', o.table_no;
  end if;
  w := public.waiter_of(p_token);
  d := jsonb_build_object('items', '{}'::jsonb, 'notes', '{}'::jsonb, 'served', '{}'::jsonb, 'client', o.client, 'roomNo', o.room_no,
                          'building', o.building, 'room', o.room_service, 'note', o.note);
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

-- Owner only: delete an order. A full copy goes into the audit log.
create or replace function public.delete_order(p_id bigint, p_reason text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders; snap jsonb;
begin
  perform public.require_owner();
  select * into o from public.orders where id = p_id;
  if not found then raise exception 'Order not found'; end if;
  snap := to_jsonb(o) || jsonb_build_object('lines', (select coalesce(jsonb_agg(to_jsonb(l) order by l.pos), '[]') from public.order_lines l where l.order_id = o.id),
                                            'reason', coalesce(p_reason, ''));
  perform public.audit('order_delete', 'order', o.id::text, snap);
  delete from public.orders where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Stock page
create or replace function public.stock_set(p_item text, p_remaining int)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_staff();
  if p_remaining is null then
    delete from public.stock where item_id = p_item;
  else
    insert into public.stock(item_id, remaining) values (p_item, greatest(0, p_remaining))
    on conflict (item_id) do update set remaining = greatest(0, p_remaining), updated_at = now();
  end if;
end $$;

create or replace function public.stock_new_day(p_token uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare w public.waiters;
begin
  perform public.require_staff();
  w := public.waiter_of(p_token);
  perform public.audit('stock_new_day', 'stock', null, (select jsonb_object_agg(item_id, remaining) from public.stock), w.name);
  delete from public.stock where true;
end $$;

create or replace function public.set_stock_alert(p_n int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_staff();
  update public.settings set value = to_jsonb(least(10, greatest(0, p_n))) where key = 'stock_alert';
end $$;

-- Owner: load old history (JSON export of the old app). Safe to run twice.
create or replace function public.import_orders(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o jsonb; v_uid text; v_name text; v_wid uuid; n_new int := 0; n_skip int := 0; n_bad int := 0;
begin
  if not (public.is_owner() or coalesce(auth.role(), '') = 'service_role' or session_user in ('postgres', 'supabase_admin')) then
    raise exception 'Only the owner can import history.' using errcode = '42501';
  end if;
  for o in select * from jsonb_array_elements(p_rows) loop
    begin
      v_uid := coalesce(nullif(o->>'uid', ''), 'legacy-' || (o->>'closedAt') || '-' || (o->>'table'));
      v_name := coalesce(nullif(trim(o->>'waiter'), ''), 'Mehdi');   -- the old app showed orders without waiter as Mehdi
      select id into v_wid from public.waiters where lower(name) = lower(v_name);
      if public.insert_order(o || jsonb_build_object('uid', v_uid), v_wid, v_name, 'import') is null then
        n_skip := n_skip + 1;
      else
        n_new := n_new + 1;
      end if;
    exception when others then
      n_bad := n_bad + 1;
    end;
  end loop;
  perform public.audit('history_import', 'orders', null, jsonb_build_object('imported', n_new, 'already_there', n_skip, 'errors', n_bad));
  return jsonb_build_object('imported', n_new, 'already_there', n_skip, 'errors', n_bad);
end $$;

-- Only logged-in users may call functions; set_user_role only from the SQL editor.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.my_role(), public.is_owner(), public.is_staff(), public.rome_today(),
  public.require_staff(), public.require_owner(),
  public.waiter_login(uuid, text), public.owner_save_waiter(uuid, text, text, boolean),
  public.table_op(int, jsonb, uuid), public.submit_order(jsonb, uuid), public.reopen_order(bigint, uuid),
  public.delete_order(bigint, text), public.stock_set(text, int), public.stock_new_day(uuid),
  public.set_stock_alert(int), public.import_orders(jsonb) to authenticated;
revoke execute on function public.set_user_role(text, text), public.audit(text, text, text, jsonb, text) from authenticated;
grant execute on function public.import_orders(jsonb) to service_role;

-- ---------------------------------------------------------------------
-- 9. Live updates (Realtime)
-- ---------------------------------------------------------------------
alter table public.open_tables replica identity full;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.open_tables, public.stock, public.settings, public.menu_items, public.orders;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 10. Starting data: the menu of comande.html and the two waiters
--     (PIN 0000 — change it in the app: Owner → Waiters)
-- ---------------------------------------------------------------------
insert into public.waiters(name, pin_hash, sort) values
  ('Mehdi',  extensions.crypt('0000', extensions.gen_salt('bf')), 1),
  ('Nikola', extensions.crypt('0000', extensions.gen_salt('bf')), 2);

insert into public.menu_items(id, section, name_it, name_en, price, sort) values
 ('spag-pom','primi','Spaghetto al pomodoro','Spaghetti with tomato sauce',12,1),
 ('pasta-speck','primi','Pasta fatta in casa con speck e funghi','Homemade pasta, tomato, speck, mushrooms',13,2),
 ('zuppa','primi','Zuppa di cereali e legumi','Cereal and legume soup',14,3),
 ('carbonara','primi','Spaghetti alla carbonara','Spaghetti carbonara',13,4),
 ('risotto','primi','Risotto ai funghi porcini','Risotto with porcini mushrooms',13,5),
 ('ravioli','primi','Ravioli ricotta e spinaci, datterino e basilico','Ricotta & spinach ravioli, cherry tomato, basil',13,6),
 ('polpette','secondi','Polpette al sugo con pomodori e piselli','Meatballs in tomato sauce with peas',17,1),
 ('filetto','secondi','Filetto di pollo con funghi e patate','Chicken fillet, mushrooms, potatoes',15,2),
 ('cotoletta','secondi','Cotoletta di pollo con patate a spicchi','Breaded chicken cutlet, potato wedges',13,3),
 ('souffle-cioc','dolci','Soufflé al cioccolato','Chocolate lava soufflé',8,1),
 ('souffle-pist','dolci','Soufflé al pistacchio','Pistachio lava soufflé',8,2),
 ('tiramisu','dolci','Tiramisù','Tiramisu',8.5,3),
 ('dolce-casa','dolci','Dolce della casa','Homemade pastry (Bistrot)',8,4),
 ('pinsa-bufala','pinsa','Pinsa Bufala e Pachino','Buffalo mozzarella, cherry tomato',16,1),
 ('pinsa-mortadella','pinsa','Pinsa Stracciatella, mortadella e pistacchio','Stracciatella, mortadella, pistachio',16,2),
 ('pinsa-veg','pinsa','Pinsa Vegetariana','Vegetarian',16,3),
 ('pinsa-tacchino','pinsa','Pinsa Tacchino, rucola e scamorza','Turkey, rocket, smoked scamorza',16,4),
 ('aperitif','aperitivo','Aperitif Experience','Per person · drink + homemade products',25,1),
 ('espresso','caffe','Caffè espresso','Espresso',3,1),
 ('decaf','caffe','Caffè decaffeinato','Decaf coffee',3.5,2),
 ('orzo','caffe','Orzo','Barley coffee',4,3),
 ('ginseng','caffe','Ginseng','Ginseng coffee',4,4),
 ('americano','caffe','Caffè americano','American coffee',5,5),
 ('cappuccino','caffe','Cappuccino','Cappuccino',5,6),
 ('te-verde','caffe','Tè verde','Green tea',5,7),
 ('te-nero','caffe','Tè nero','Black tea',5,8),
 ('te-earl','caffe','Tè Earl Grey','Earl Grey tea',5,9),
 ('cioccolata','caffe','Cioccolata calda','Hot chocolate',5,10),
 ('acqua','bibite','Acqua minerale 0,50 l','Mineral water',3.5,1),
 ('coca','bibite','Coca-Cola','Coke',5,2),
 ('coca-zero','bibite','Coca-Cola Zero','Coke Zero',5,3),
 ('fanta','bibite','Fanta','Fanta',5,4),
 ('schweppes','bibite','Schweppes Tonica','Tonic water',5,5),
 ('spremuta','bibite','Spremuta d''arancia','Fresh orange juice',6.5,6),
 ('redbull','bibite','Red Bull 0,25 l','Red Bull',6.5,7),
 ('manhattan','cocktail','Manhattan','Cocktail',15,1),
 ('aperol','cocktail','Aperol Spritz','Cocktail',15,2),
 ('campari','cocktail','Campari Spritz','Cocktail',15,3),
 ('limoncello-spritz','cocktail','Limoncello Spritz','Cocktail',15,4),
 ('mojito','cocktail','Mojito','Cocktail',15,5),
 ('cuba','cocktail','Cuba Libre','Cocktail',15,6),
 ('gin-tonic','cocktail','Gin Tonic','Cocktail',15,7),
 ('vodka-tonic','cocktail','Vodka Tonic','Cocktail',15,8),
 ('americano-ck','cocktail','Americano','Cocktail (not coffee)',15,9),
 ('negroni','cocktail','Negroni','Cocktail',15,10),
 ('spum-c','vino','Spumante · calice','Sparkling wine · glass',9,1),
 ('spum-b','vino','Spumante · bottiglia','Sparkling wine · bottle',29,2),
 ('bianco-c','vino','Bianco · calice','White, Chardonnay Lazio · glass',10,3),
 ('bianco-b','vino','Bianco · bottiglia','White, Chardonnay Lazio · bottle',35,4),
 ('rosso-c','vino','Rosso · calice','Red, Montepulciano Abruzzo · glass',10,5),
 ('rosso-b','vino','Rosso · bottiglia','Red, Montepulciano Abruzzo · bottle',35,6),
 ('birra','vino','Birra 0,33 l','Beer',6.5,7),
 ('jager','liquori','Amaro Jägermeister','Herbal liqueur',8.5,1),
 ('jefferson','liquori','Amaro Jefferson','Herbal liqueur',11,2),
 ('limoncello','liquori','Limoncello di Capri','Lemon liqueur',8.5,3),
 ('jack','liquori','Whisky Jack Daniel''s','Whiskey',11,4);
-- the seed menu is not an "edit": clear those log lines
delete from public.audit_log where action = 'menu_add';
