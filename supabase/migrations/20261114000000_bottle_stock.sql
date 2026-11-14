-- =====================================================================
--  BOTTLE STOCK (wines, champagne, beers)
--  1) "Nuovo conteggio del giorno" resets only the DISHES; bottles are an inventory and stay.
--  2) The bottle counts of 14/11 (fridge 5th floor + store room above the fridge + champagne).
--  Run once in Supabase → SQL Editor → Run, AFTER 20261111000000_final_menu.sql.
--  Running it again sets the bottles back to these numbers.
-- =====================================================================

create or replace function public.stock_new_day(p_token uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare w public.waiters;
begin
  perform public.require_staff();
  w := public.waiter_of(p_token);
  perform public.audit('stock_new_day', 'stock', null, (select jsonb_object_agg(item_id, remaining) from public.stock), w.name);
  delete from public.stock s using public.menu_items m
  where m.id = s.item_id and m.section in ('giorno', 'primi', 'secondi', 'dolci', 'pinsa');
end $$;

-- bottles counted on 14/11 (only dishes that exist in the menu are set)
insert into public.stock(item_id, remaining)
select v.id, v.n from (values
  ('champ-mumm', 2),            -- Champagne Grand Cordon Mumm
  ('champ-moet-rosso', 2),      -- Moët & Chandon Impérial
  ('franciacorta-magnum', 1),   -- Franciacorta Magnum 1,5 L
  ('rosso-b', 8),               -- Montepulciano d'Abruzzo
  ('merlot-b', 11),             -- Merlot Villa Dugo
  ('syrah-b', 6),               -- Syrah
  ('ribolla-b', 9),             -- Ribolla Gialla: 3 + 3 (fridge) + 3 (store room)
  ('malvasia-b', 11),           -- Malvasia puntinata Lazio: 3 (fridge) + 8 (store room)
  ('gewurz-b', 7),              -- Gewürztraminer: 3 + 3 d'Isera (Trentino) + 1 Lazio
  ('prosecco-b', 7),            -- Prosecco: 3 + 3 Gemin + 1 Lenynae
  ('bianco-b', 5)               -- Chardonnay Lazio
) as v(id, n)
where exists (select 1 from public.menu_items m where m.id = v.id)
on conflict (item_id) do update set remaining = excluded.remaining, updated_at = now();
