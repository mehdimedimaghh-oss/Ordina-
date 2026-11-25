-- =====================================================================
--  PURCHASE COSTS & MARGINS (owner only)
--  * item_costs:       one purchase cost per serving, WITHOUT VAT, with the date it is valid from.
--                      Never changed or deleted: a correction cancels the old row (with a reason) and adds a new one.
--  * item_finance:     per dish: sales VAT %, purchase VAT %, servings per pack (e.g. glasses per bottle) (all optional)
--  * Pack ÷ servings:   cost per serving = pack amount (after discount, purchase VAT excluded) ÷ servings/units in it
--                      (2 packs of 4 portions = 8; a box of 24 cans = 24; a wine bottle = the glasses poured from it)
--  * finance_settings: default VAT rates per section and the "confirmed by the commercialista" flag
--  * owner_profit():   revenue, cost and margin of a period, calculated in the database for the owner only
--  Waiters and reception can NOT read anything of this. Menu prices, orders and order lines are NOT changed.
--  Run once in Supabase → SQL Editor → Run. Safe to run again.
-- =====================================================================

create table if not exists public.item_costs (
  id           bigint generated always as identity primary key,
  item_id      text not null references public.menu_items(id),
  cost         numeric(10,4) not null check (cost >= 0 and cost < 100000),   -- per serving, VAT excluded
  valid_from   date not null,                                                 -- sales from this day use this cost
  invoice_date date,
  supplier     text not null default '' check (length(supplier) <= 80),
  invoice_ref  text not null default '' check (length(invoice_ref) <= 60),
  purchase_vat numeric(5,2) check (purchase_vat between 0 and 100),           -- for information only
  pack_cost    numeric(10,4) check (pack_cost >= 0),                          -- Pack ÷ servings: pack amount after discount, VAT excl.
  pack_units   int check (pack_units between 1 and 1000),                     -- servings / units in that amount (glasses for a bottle)
  note         text not null default '' check (length(note) <= 300),
  created_at   timestamptz not null default now(),
  created_by   text default (auth.jwt() ->> 'email'),
  voided_at    timestamptz,                                                    -- cancelled (corrected): kept for history
  voided_by    text,
  void_reason  text,
  replaced_by  bigint references public.item_costs(id)
);
create unique index if not exists item_costs_one_per_day on public.item_costs(item_id, valid_from) where voided_at is null;
create index if not exists item_costs_item on public.item_costs(item_id, valid_from desc);

create table if not exists public.item_finance (
  item_id            text primary key references public.menu_items(id),
  sales_vat          numeric(5,2) check (sales_vat between 0 and 100),
  purchase_vat       numeric(5,2) check (purchase_vat between 0 and 100),
  units_per_pack     int check (units_per_pack between 1 and 1000),             -- remembered from the last Pack ÷ servings
  updated_at         timestamptz not null default now(),
  updated_by         text
);

-- a database that ran an earlier draft of this file (demo): rename the old "bottle ÷ glasses" columns
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'item_costs' and column_name = 'bottle_cost') then
    alter table public.item_costs rename column bottle_cost to pack_cost;
    alter table public.item_costs rename column glasses to pack_units;
    alter table public.item_costs drop constraint if exists item_costs_glasses_check;
    alter table public.item_costs add constraint item_costs_pack_units_check check (pack_units between 1 and 1000);
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'item_finance' and column_name = 'glasses_per_bottle') then
    alter table public.item_finance rename column glasses_per_bottle to units_per_pack;
    alter table public.item_finance drop constraint if exists item_finance_glasses_per_bottle_check;
    alter table public.item_finance add constraint item_finance_units_per_pack_check check (units_per_pack between 1 and 1000);
  end if;
end $$;

create table if not exists public.finance_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
-- nothing is assumed: no VAT rate until the owner writes one; not confirmed
insert into public.finance_settings(key, value) values
  ('sales_vat_default', 'null'), ('sales_vat_sections', '{}'), ('purchase_vat_default', 'null'),
  ('vat_status', '{"confirmed": false, "note": ""}')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Security: only the owner reads; nobody writes directly (only the functions below)
-- ---------------------------------------------------------------------
alter table public.item_costs       enable row level security;
alter table public.item_finance     enable row level security;
alter table public.finance_settings enable row level security;
drop policy if exists "owner reads costs"   on public.item_costs;
drop policy if exists "owner reads finance" on public.item_finance;
drop policy if exists "owner reads finance settings" on public.finance_settings;
create policy "owner reads costs"   on public.item_costs       for select to authenticated using (public.is_owner());
create policy "owner reads finance" on public.item_finance     for select to authenticated using (public.is_owner());
create policy "owner reads finance settings" on public.finance_settings for select to authenticated using (public.is_owner());
revoke all on public.item_costs, public.item_finance, public.finance_settings from anon;
revoke insert, update, delete, truncate on public.item_costs, public.item_finance, public.finance_settings from authenticated;
grant select on public.item_costs, public.item_finance, public.finance_settings to authenticated;

-- the cost valid for a dish on a day (null = no cost)
create or replace function public.cost_on(p_item text, p_day date) returns numeric
language sql stable security definer set search_path = public as $$
  select cost from public.item_costs
   where item_id = p_item and voided_at is null and valid_from <= p_day
   order by valid_from desc, id desc limit 1
$$;
revoke all on function public.cost_on(text, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Save a purchase cost (or correct one: p.replaces = id of the row to cancel, p.reason = why)
--   p = {item_id, cost, valid_from, invoice_date, supplier, invoice_ref, purchase_vat, pack_cost, pack_units, note, replaces, reason}
--   cost is per serving WITHOUT VAT. Pack ÷ servings: with pack_cost + pack_units, cost = pack_cost ÷ pack_units
--   (pack_cost = the invoice line after discount, purchase VAT excluded). Old names bottle_cost / glasses are accepted too.
-- ---------------------------------------------------------------------
create or replace function public.owner_save_cost(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m public.menu_items; v_old public.item_costs; v_cost numeric; v_from date; v_inv date; v_pack numeric; v_units int;
        v_pvat numeric; v_id bigint; v_before numeric; v_sold int; v_next date;
begin
  perform public.require_owner();
  select * into m from public.menu_items where id = p->>'item_id';
  if not found then raise exception 'Unknown dish'; end if;
  v_inv  := nullif(p->>'invoice_date', '')::date;
  v_from := coalesce(nullif(p->>'valid_from', '')::date, v_inv);
  if v_from is null then raise exception 'Write the date this cost is valid from (or the invoice date)'; end if;
  if v_from > public.rome_today() + 366 then raise exception 'The date is too far in the future'; end if;
  if v_from < date '2020-01-01' then raise exception 'The date is too old'; end if;
  v_pack  := nullif(coalesce(p->>'pack_cost', p->>'bottle_cost'), '')::numeric;
  v_units := nullif(coalesce(p->>'pack_units', p->>'glasses'), '')::int;
  if v_pack is not null then
    if v_pack < 0 or v_pack >= 1000000 then raise exception 'Write the pack amount like 23,44 (after discount, VAT excluded)'; end if;
    if v_units is null or v_units < 1 or v_units > 1000 then raise exception 'Write how many servings or units are in this pack (1–1000)'; end if;
    v_cost := round(v_pack / v_units, 4);
  else
    v_cost := nullif(p->>'cost', '')::numeric; v_units := null;
  end if;
  if v_cost is null or v_cost < 0 or v_cost >= 100000 then raise exception 'Write a cost like 3,20 (VAT excluded)'; end if;
  v_pvat := nullif(p->>'purchase_vat', '')::numeric;
  if v_pvat is not null and (v_pvat < 0 or v_pvat > 100) then raise exception 'Purchase VAT must be between 0 and 100'; end if;

  if nullif(p->>'replaces', '') is not null then
    select * into v_old from public.item_costs where id = (p->>'replaces')::bigint for update;
    if not found or v_old.item_id <> m.id or v_old.voided_at is not null then raise exception 'The cost to correct was not found (maybe already corrected)'; end if;
    if length(trim(coalesce(p->>'reason', ''))) < 3 then raise exception 'Write why you correct this cost'; end if;
    update public.item_costs set voided_at = now(), voided_by = coalesce(auth.jwt() ->> 'email', 'owner'), void_reason = trim(p->>'reason')
     where id = v_old.id;
  end if;
  if exists (select 1 from public.item_costs where item_id = m.id and valid_from = v_from and voided_at is null) then
    raise exception 'There is already a cost for % from %. Use "Correct" to change it.', m.name_it, to_char(v_from, 'DD/MM/YYYY');
  end if;

  v_before := public.cost_on(m.id, v_from);
  insert into public.item_costs(item_id, cost, valid_from, invoice_date, supplier, invoice_ref, purchase_vat, pack_cost, pack_units, note)
  values (m.id, v_cost, v_from, v_inv, left(trim(coalesce(p->>'supplier', '')), 80), left(trim(coalesce(p->>'invoice_ref', '')), 60),
          v_pvat, v_pack, v_units, left(trim(coalesce(p->>'note', '')), 300))
  returning id into v_id;
  if v_old.id is not null then update public.item_costs set replaced_by = v_id where id = v_old.id; end if;
  if v_units is not null then   -- remember the servings of this pack (glasses of this bottle) for next time
    insert into public.item_finance(item_id, units_per_pack, updated_by) values (m.id, v_units, auth.jwt() ->> 'email')
    on conflict (item_id) do update set units_per_pack = excluded.units_per_pack, updated_at = now(), updated_by = excluded.updated_by;
  end if;

  -- how many servings already sold get this cost (documented in the audit log)
  select min(valid_from) into v_next from public.item_costs where item_id = m.id and voided_at is null and valid_from > v_from;
  select coalesce(sum(l.qty), 0) into v_sold from public.order_lines l join public.orders o on o.id = l.order_id
   where o.status = 'closed' and split_part(l.item_id, '~', 1) = m.id and o.day >= v_from and (v_next is null or o.day < v_next);

  perform public.audit(case when v_old.id is null then 'cost_save' else 'cost_correct' end, 'item_cost', m.id,
    jsonb_build_object('name', m.name_it, 'cost', v_cost, 'valid_from', v_from, 'invoice_date', v_inv,
      'supplier', coalesce(p->>'supplier', ''), 'invoice_ref', coalesce(p->>'invoice_ref', ''), 'pack_cost', v_pack, 'pack_units', v_units,
      'cost_before', v_before, 'sold_affected', v_sold, 'id', v_id,
      'replaces', v_old.id, 'old_cost', v_old.cost, 'old_valid_from', v_old.valid_from, 'reason', nullif(trim(coalesce(p->>'reason', '')), '')));
  return jsonb_build_object('ok', true, 'id', v_id, 'cost', v_cost, 'valid_from', v_from, 'sold_affected', v_sold);
end $$;
revoke all on function public.owner_save_cost(jsonb) from public, anon;
grant execute on function public.owner_save_cost(jsonb) to authenticated;

-- Cancel a cost without a replacement (e.g. typed for the wrong dish). Kept in the history.
create or replace function public.owner_void_cost(p_id bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.item_costs;
begin
  perform public.require_owner();
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Write why you cancel this cost'; end if;
  select * into c from public.item_costs where id = p_id for update;
  if not found or c.voided_at is not null then raise exception 'Cost not found (maybe already cancelled)'; end if;
  update public.item_costs set voided_at = now(), voided_by = coalesce(auth.jwt() ->> 'email', 'owner'), void_reason = trim(p_reason) where id = p_id;
  perform public.audit('cost_void', 'item_cost', c.item_id,
    jsonb_build_object('name', (select name_it from public.menu_items where id = c.item_id), 'id', c.id, 'cost', c.cost, 'valid_from', c.valid_from, 'reason', trim(p_reason)));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.owner_void_cost(bigint, text) from public, anon;
grant execute on function public.owner_void_cost(bigint, text) to authenticated;

-- ---------------------------------------------------------------------
-- VAT rates (all optional, nothing assumed)
--   p = {sales_default: n|null, sales_sections: {section: n}, purchase_default: n|null,
--        items: {item_id: {sales_vat: n|null, purchase_vat: n|null}}, confirmed: bool, note: text}
--   Changing any rate removes the "confirmed" mark unless confirmed=true is sent again with a note.
-- ---------------------------------------------------------------------
create or replace function public.owner_set_vat(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_before jsonb; v_after jsonb; k text; v jsonb; r numeric; v_conf boolean; v_note text; v_secs jsonb := '{}';
  ok_rate constant text := 'VAT rates must be numbers between 0 and 100';
begin
  perform public.require_owner();
  select jsonb_build_object('settings', (select jsonb_object_agg(key, value) from public.finance_settings),
                            'items', (select coalesce(jsonb_object_agg(item_id, jsonb_build_object('sales_vat', sales_vat, 'purchase_vat', purchase_vat)), '{}') from public.item_finance))
    into v_before;

  if p ? 'sales_default' then
    r := nullif(p->>'sales_default', '')::numeric; if r is not null and (r < 0 or r > 100) then raise exception '%', ok_rate; end if;
    update public.finance_settings set value = coalesce(to_jsonb(r), 'null'), updated_at = now(), updated_by = auth.jwt() ->> 'email' where key = 'sales_vat_default';
  end if;
  if p ? 'purchase_default' then
    r := nullif(p->>'purchase_default', '')::numeric; if r is not null and (r < 0 or r > 100) then raise exception '%', ok_rate; end if;
    update public.finance_settings set value = coalesce(to_jsonb(r), 'null'), updated_at = now(), updated_by = auth.jwt() ->> 'email' where key = 'purchase_vat_default';
  end if;
  if p ? 'sales_sections' then
    if jsonb_typeof(p->'sales_sections') <> 'object' then raise exception 'Bad data'; end if;
    for k, v in select * from jsonb_each(p->'sales_sections') loop
      r := nullif(v #>> '{}', '')::numeric;
      if r is null then continue; end if;
      if r < 0 or r > 100 then raise exception '%', ok_rate; end if;
      v_secs := v_secs || jsonb_build_object(k, r);
    end loop;
    update public.finance_settings set value = v_secs, updated_at = now(), updated_by = auth.jwt() ->> 'email' where key = 'sales_vat_sections';
  end if;
  if p ? 'items' then
    if jsonb_typeof(p->'items') <> 'object' then raise exception 'Bad data'; end if;
    for k, v in select * from jsonb_each(p->'items') loop
      if not exists (select 1 from public.menu_items where id = k) then raise exception 'Unknown dish %', k; end if;
      if (nullif(v->>'sales_vat', '')::numeric) not between 0 and 100 or (nullif(v->>'purchase_vat', '')::numeric) not between 0 and 100 then raise exception '%', ok_rate; end if;
      insert into public.item_finance(item_id, sales_vat, purchase_vat, updated_by)
      values (k, nullif(v->>'sales_vat', '')::numeric, nullif(v->>'purchase_vat', '')::numeric, auth.jwt() ->> 'email')
      on conflict (item_id) do update set sales_vat = excluded.sales_vat, purchase_vat = excluded.purchase_vat, updated_at = now(), updated_by = excluded.updated_by;
    end loop;
  end if;

  v_conf := coalesce((p->>'confirmed')::boolean, false);
  v_note := left(trim(coalesce(p->>'note', '')), 300);
  if v_conf and length(v_note) < 3 then raise exception 'To mark the VAT rates as confirmed, write who confirmed them and when'; end if;
  update public.finance_settings
     set value = jsonb_build_object('confirmed', v_conf, 'note', v_note, 'at', case when v_conf then now() end, 'by', case when v_conf then auth.jwt() ->> 'email' end),
         updated_at = now(), updated_by = auth.jwt() ->> 'email'
   where key = 'vat_status';

  select jsonb_build_object('settings', (select jsonb_object_agg(key, value) from public.finance_settings),
                            'items', (select coalesce(jsonb_object_agg(item_id, jsonb_build_object('sales_vat', sales_vat, 'purchase_vat', purchase_vat)), '{}') from public.item_finance))
    into v_after;
  perform public.audit('vat_save', 'finance', 'vat', jsonb_build_object('before', v_before, 'after', v_after));
  return jsonb_build_object('ok', true, 'confirmed', v_conf);
end $$;
revoke all on function public.owner_set_vat(jsonb) from public, anon;
grant execute on function public.owner_set_vat(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Margins of a period (owner only). Counts only SENT orders (status 'closed'), like the dashboard.
-- Custom drinks ("cocktail-misura~abc") count as their menu dish. A sale uses the cost valid on ITS day.
-- A line without cost or without VAT rate is NOT counted as 0: it is reported as missing.
-- Coperto and room-service fee = service income (no purchase cost), shown apart.
-- ---------------------------------------------------------------------
create or replace function public.owner_profit(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_def numeric; v_secs jsonb; v_status jsonb; v_res jsonb;
begin
  perform public.require_owner();
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Bad date range'; end if;
  if p_to - p_from > 800 then raise exception 'Choose at most about 2 years'; end if;
  select nullif(value #>> '{}', '')::numeric into v_def from public.finance_settings where key = 'sales_vat_default';
  select value into v_secs   from public.finance_settings where key = 'sales_vat_sections';
  select value into v_status from public.finance_settings where key = 'vat_status';
  v_secs := coalesce(v_secs, '{}');

  with o as (
    select * from public.orders where status = 'closed' and day between p_from and p_to
  ), l as (
    select o.day, split_part(ol.item_id, '~', 1) as item_id, ol.name, ol.section as lsec, ol.qty, ol.price
      from o join public.order_lines ol on ol.order_id = o.id
  ), x as (
    select l.day, l.item_id, coalesce(m.name_it, l.name) as dish, coalesce(m.section, l.lsec) as section, l.qty,
           l.qty * l.price as gross,
           coalesce(f.sales_vat, (v_secs ->> coalesce(m.section, l.lsec))::numeric, v_def) as vat,
           public.cost_on(l.item_id, l.day) as unit_cost
      from l left join public.menu_items m on m.id = l.item_id
             left join public.item_finance f on f.item_id = l.item_id
  ), y as (
    select x.*, case when vat is not null then gross / (1 + vat / 100) end as net,
           case when unit_cost is not null then qty * unit_cost end as cost,
           (vat is not null and unit_cost is not null) as known
      from x
  ), items as (
    select item_id, max(dish) as dish, max(section) as section,
           sum(qty) as qty, sum(gross) as gross, sum(net) as net,
           min(vat) as vat_min, max(vat) as vat_max,
           sum(qty) filter (where unit_cost is null) as qty_no_cost,
           sum(gross) filter (where unit_cost is null) as gross_no_cost,
           sum(qty) filter (where vat is null) as qty_no_vat,
           sum(net) filter (where known) as k_net, sum(cost) filter (where known) as k_cost,
           sum(qty) filter (where known) as k_qty
      from y group by item_id
  ), sections as (
    select section, sum(gross) as gross, sum(net) filter (where known) as k_net, sum(cost) filter (where known) as k_cost,
           sum(gross) filter (where not known) as gross_unknown
      from y group by section
  ), days as (
    select day, sum(gross) as gross, sum(net) filter (where known) as k_net, sum(cost) filter (where known) as k_cost,
           sum(gross) filter (where not known) as gross_unknown
      from y group by day
  ), svc as (
    select coalesce(sum(covers * cover_fee), 0) as cover, coalesce(sum(room_fee), 0) as room, coalesce(sum(total), 0) as total, count(*) as orders
      from o
  ), svc_vat as (
    select coalesce((v_secs ->> 'servizio')::numeric, v_def) as vat
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'provisional', not coalesce((v_status ->> 'confirmed')::boolean, false),
    'vat_status', v_status,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'item_id', item_id, 'name', dish, 'section', section, 'qty', qty, 'gross', round(gross, 2), 'net', round(net, 2),
        'vat_min', vat_min, 'vat_max', vat_max,
        'qty_no_cost', coalesce(qty_no_cost, 0), 'gross_no_cost', round(coalesce(gross_no_cost, 0), 2), 'qty_no_vat', coalesce(qty_no_vat, 0),
        'known_qty', coalesce(k_qty, 0), 'known_net', round(k_net, 2), 'cost', round(k_cost, 2),
        'unit_cost', case when k_qty > 0 then round(k_cost / k_qty, 4) end,
        'margin', round(k_net - k_cost, 2),
        'food_cost_pct', case when k_net > 0 then round(k_cost / k_net * 100, 1) end) order by gross desc) from items), '[]'),
    'sections', coalesce((select jsonb_agg(jsonb_build_object('section', section, 'gross', round(gross, 2), 'known_net', round(k_net, 2), 'cost', round(k_cost, 2),
        'margin', round(k_net - k_cost, 2), 'food_cost_pct', case when k_net > 0 then round(k_cost / k_net * 100, 1) end,
        'gross_unknown', round(coalesce(gross_unknown, 0), 2)) order by gross desc) from sections), '[]'),
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'gross', round(gross, 2), 'known_net', round(k_net, 2), 'cost', round(k_cost, 2),
        'margin', round(k_net - k_cost, 2), 'gross_unknown', round(coalesce(gross_unknown, 0), 2)) order by day) from days), '[]'),
    'service', (select jsonb_build_object('cover', round(cover, 2), 'room_fee', round(room, 2), 'vat', (select vat from svc_vat),
        'net', case when (select vat from svc_vat) is not null then round((cover + room) / (1 + (select vat from svc_vat) / 100), 2) end) from svc),
    'totals', (select jsonb_build_object(
        'orders', (select orders from svc), 'revenue_gross', (select round(total, 2) from svc),
        'dishes_gross', round(coalesce(sum(gross), 0), 2),
        'known_net', round(coalesce(sum(net) filter (where known), 0), 2), 'cost', round(coalesce(sum(cost) filter (where known), 0), 2),
        'margin', round(coalesce(sum(net) filter (where known), 0) - coalesce(sum(cost) filter (where known), 0), 2),
        'food_cost_pct', case when sum(net) filter (where known) > 0 then round(sum(cost) filter (where known) / sum(net) filter (where known) * 100, 1) end,
        'gross_unknown', round(coalesce(sum(gross) filter (where not known), 0), 2),
        'gross_no_cost', round(coalesce(sum(gross) filter (where unit_cost is null), 0), 2),
        'gross_no_vat', round(coalesce(sum(gross) filter (where vat is null), 0), 2),
        'items_no_cost', (select count(*) from items where qty_no_cost > 0),
        'items_no_vat', (select count(*) from items where qty_no_vat > 0),
        'coverage_pct', case when sum(gross) > 0 then round(coalesce(sum(gross) filter (where known), 0) / sum(gross) * 100, 1) end) from y)
  ) into v_res;
  return v_res;
end $$;
revoke all on function public.owner_profit(date, date) from public, anon;
grant execute on function public.owner_profit(date, date) to authenticated;
