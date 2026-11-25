-- =====================================================================
--  25/11: new dishes of the day, ONE stock counter for all pinse, today's portions.
--  Run once in Supabase → SQL Editor → Run (after the final menu and bottle files).
--  Safe to run again (it sets today's portions again to these numbers).
-- =====================================================================

-- 1) dishes of the day: Spaghetti cacio e pepe, Melanzane alla parmigiana (€ 13, like "Piatto del giorno")
insert into public.menu_items(id, section, name_it, name_en, price, sort, hidden) values
  ('cacio-pepe', 'giorno', 'Spaghetti cacio e pepe', 'Spaghetti with pecorino and black pepper', 13, 2, false),
  ('parmigiana', 'giorno', 'Melanzane alla parmigiana', 'Aubergine parmigiana', 13, 3, false)
on conflict (id) do update set section = excluded.section, name_it = excluded.name_it, name_en = excluded.name_en,
  price = excluded.price, sort = excluded.sort, hidden = false, updated_at = now();

-- 2) one counter for every pinsa: the bases are bought, then topped as the guest chooses
alter table public.menu_items add column if not exists stock_id text;
insert into public.menu_items(id, section, name_it, name_en, price, sort, hidden)
values ('pinsa-base', 'pinsa', 'Pinsa (basi)', 'Pinsa bases', 0, 0, true)
on conflict (id) do update set hidden = true, name_it = excluded.name_it, name_en = excluded.name_en, price = 0;
update public.menu_items set stock_id = 'pinsa-base' where section = 'pinsa' and id <> 'pinsa-base';
delete from public.stock where item_id in (select id from public.menu_items where stock_id is not null);   -- old per-pinsa counters

-- a dish sold takes one from ITS counter: its own, or the shared one (stock_id)
create or replace function public.stock_move(p_item text, p_delta int) returns void
language sql security definer set search_path = public as $$
  update public.stock set remaining = remaining + p_delta, updated_at = now()
  where p_delta <> 0
    and item_id = coalesce((select nullif(m.stock_id, '') from public.menu_items m where m.id = split_part(p_item, '~', 1)), p_item)
$$;
revoke all on function public.stock_move(text, int) from public, anon, authenticated;

-- the daily "new count" resets the dishes, not the pinsa bases (bought stock, like the bottles)
create or replace function public.stock_new_day(p_token uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare w public.waiters;
begin
  perform public.require_staff();
  w := public.waiter_of(p_token);
  perform public.audit('stock_new_day', 'stock', null, (select jsonb_object_agg(item_id, remaining) from public.stock), w.name);
  delete from public.stock s using public.menu_items m
  where m.id = s.item_id and m.section in ('giorno', 'primi', 'secondi', 'dolci', 'pinsa') and s.item_id <> 'pinsa-base';
end $$;

-- 3) today's portions (25/11)
insert into public.stock(item_id, remaining)
select v.id, v.n from (values
  ('cacio-pepe', 9), ('lasagne', 8), ('parmigiana', 7),
  ('spag-pom', 8), ('pasta-speck', 8), ('zuppa', 8), ('carbonara', 10), ('risotto', 7), ('ravioli', 12),
  ('polpette', 8), ('filetto', 13), ('cotoletta', 10)
) as v(id, n)
where exists (select 1 from public.menu_items m where m.id = v.id)
on conflict (item_id) do update set remaining = excluded.remaining, updated_at = now();
