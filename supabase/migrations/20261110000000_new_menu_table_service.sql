-- =====================================================================
--  Comande Pranzo · new rooftop bar menu (November 2026) + table service per person
--  1) MENU: new cocktails, new wines (Gewürztraminer, Syrah, Prosecco), new wine prices,
--     pinsa names. Old cocktails / Pinsa Vegetariana are only HIDDEN (old orders keep them).
--     Lunch dishes (primi, secondi, dolci) are not touched.
--  2) TABLE SERVICE ("Servizio al tavolo"): € 2,00 per person (coperti), added by itself
--     to every order with guests. The waiter can untick it for one table; the owner can
--     change the price (Owner → Menu & prices). Saved in every order (cover_fee), so old
--     totals never change when the price changes.
--  Safe on a database in use: no order is changed or deleted. Safe to run twice.
-- =====================================================================

-- ---------- 1) menu ----------
insert into public.menu_items(id, section, name_it, name_en, price, sort, hidden) values
 -- cocktails € 15
 ('negroni-sbagliato','cocktail','Negroni Sbagliato','Cocktail',15,1,false),
 ('americano-bianco','cocktail','Americano Bianco','Cocktail',15,2,false),
 ('moscow-mule','cocktail','Moscow Mule','Cocktail',15,3,false),
 ('gin-lemon','cocktail','Gin Lemon','Cocktail',15,4,false),
 ('mojito-frutta','cocktail','Mojito alla Frutta','Fruit mojito',15,5,false),
 ('spritz-pesca','cocktail','Spritz alla Pesca','Peach spritz',15,6,false),
 ('spritz-bergamotto','cocktail','Spritz al Bergamotto','Bergamot spritz',15,7,false),
 ('parisienne','cocktail','Parisienne','Cocktail',15,8,false),
 ('margarita','cocktail','Margarita','Cocktail',15,9,false),
 ('espresso-martini','cocktail','Espresso Martini','Cocktail',15,10,false),
 ('cocktail-misura','cocktail','Cocktail su misura','Tailor-made cocktail (ask the barman)',15,11,false),
 -- wines and bubbles
 ('spum-c','vino','Spumante · calice','Sparkling wine · glass',9,1,false),
 ('spum-b','vino','Spumante · bottiglia','Sparkling wine · bottle',29,2,false),
 ('bianco-c','vino','Bianco · calice','White, Chardonnay Lazio · glass',8,3,false),
 ('bianco-b','vino','Bianco · bottiglia','White, Chardonnay Lazio · bottle',32,4,false),
 ('gewurz-c','vino','Gewürztraminer d''Isera · calice','Gewürztraminer · glass',10,5,false),
 ('gewurz-b','vino','Gewürztraminer d''Isera · bottiglia','Gewürztraminer · bottle',40,6,false),
 ('rosso-c','vino','Rosso · calice','Red, Montepulciano Abruzzo · glass',8,7,false),
 ('rosso-b','vino','Rosso · bottiglia','Red, Montepulciano Abruzzo · bottle',32,8,false),
 ('syrah-c','vino','Syrah Divina · calice','Syrah · glass',10,9,false),
 ('syrah-b','vino','Syrah Divina · bottiglia','Syrah · bottle',40,10,false),
 ('prosecco-c','vino','Prosecco Gemin DOC Treviso · calice','Prosecco Extra Dry · glass',9,11,false),
 ('prosecco-b','vino','Prosecco Gemin DOC Treviso · bottiglia','Prosecco Extra Dry · bottle',29,12,false),
 ('birra','vino','Birra 0,33 l','Beer',6.5,13,false),
 -- pinsa € 16
 ('pinsa-bufala','pinsa','Pinsa Bufala e Pachino','Buffalo mozzarella, cherry tomato',16,1,false),
 ('pinsa-mortadella','pinsa','Pinsa Stracciatella, mortadella e pistacchio','Stracciatella, mortadella, pistachio',16,2,false),
 ('pinsa-tacchino','pinsa','Pinsa Fesa di tacchino, rucola e scamorza affumicata','Turkey, rocket, smoked scamorza',16,3,false),
 -- coffee bar, soft drinks, aperitivo, spirits, home-made pastry (same prices, written again so the menu is exactly the card)
 ('espresso','caffe','Caffè espresso','Espresso',3,1,false),
 ('decaf','caffe','Caffè decaffeinato','Decaf coffee',3.5,2,false),
 ('orzo','caffe','Orzo','Barley coffee',4,3,false),
 ('ginseng','caffe','Ginseng','Ginseng coffee',4,4,false),
 ('americano','caffe','Caffè americano','American coffee',5,5,false),
 ('cappuccino','caffe','Cappuccino','Cappuccino',5,6,false),
 ('te-nero','caffe','Tè nero','Black tea',5,7,false),
 ('te-verde','caffe','Tè verde','Green tea',5,8,false),
 ('te-earl','caffe','Tè Earl Grey','Earl Grey tea',5,9,false),
 ('cioccolata','caffe','Cioccolata calda','Hot chocolate',5,10,false),
 ('acqua','bibite','Acqua minerale','Mineral water',3.5,1,false),
 ('coca','bibite','Coca-Cola','Coke',5,2,false),
 ('coca-zero','bibite','Coca-Cola Zero','Coke Zero',5,3,false),
 ('fanta','bibite','Fanta','Fanta',5,4,false),
 ('schweppes','bibite','Schweppes Tonica','Tonic water',5,5,false),
 ('spremuta','bibite','Spremuta d''arancia','Fresh orange juice',6.5,6,false),
 ('redbull','bibite','Red Bull','Red Bull',6.5,7,false),
 ('aperitif','aperitivo','Formula Aperitivo','Per person · drink + homemade specialties',25,1,false),
 ('limoncello','liquori','Limoncello di Capri','Lemon liqueur',8.5,1,false),
 ('jager','liquori','Amaro Jägermeister','Herbal liqueur',8.5,2,false),
 ('jefferson','liquori','Amaro Jefferson','Herbal liqueur',11,3,false),
 ('jack','liquori','Whisky Jack Daniel''s','Whiskey',11,4,false),
 ('dolce-casa','dolci','Dolce della casa','Homemade pastry',8,4,false)
on conflict (id) do update set section = excluded.section, name_it = excluded.name_it, name_en = excluded.name_en,
  price = excluded.price, sort = excluded.sort, hidden = false;

-- not on the new card any more: hidden, not deleted (old orders and the history keep them)
update public.menu_items set hidden = true
 where id in ('manhattan','aperol','campari','limoncello-spritz','mojito','cuba','gin-tonic','vodka-tonic','americano-ck','negroni','pinsa-veg')
   and not hidden;

-- ---------- 2) table service per person ----------
insert into public.settings(key, value) values ('cover_fee', '2') on conflict (key) do nothing;
alter table public.orders add column if not exists cover_fee numeric(10,2) not null default 0;   -- price per person used in this order

create or replace function public.owner_set_cover_fee(p_fee numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare old numeric;
begin
  if not public.is_owner() then raise exception 'Only the owner can change the table service' using errcode = '42501'; end if;
  if p_fee is null or p_fee < 0 or p_fee > 50 then raise exception 'Price must be between 0 and 50'; end if;
  select (value #>> '{}')::numeric into old from public.settings where key = 'cover_fee';
  insert into public.settings(key, value) values ('cover_fee', to_jsonb(round(p_fee, 2)))
    on conflict (key) do update set value = excluded.value;
  perform public.audit('cover_fee', 'settings', 'cover_fee', jsonb_build_object('before', old, 'after', round(p_fee, 2)), null);
  return jsonb_build_object('ok', true, 'cover_fee', round(p_fee, 2));
end $$;
revoke all on function public.owner_set_cover_fee(numeric) from public, anon;
grant execute on function public.owner_set_cover_fee(numeric) to authenticated;

-- open tables: one more field, "coverOff" (the waiter unticked the table service for this table)
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
        'covers', coalesce((d->>'covers')::int, 0), 'coverOff', coalesce((d->>'coverOff')::boolean, false));
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
      elsif k = 'coverOff' then d := jsonb_set(d, '{coverOff}', to_jsonb(coalesce((v #>> '{}')::boolean, false)));
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
  if not is_open and d->>'client' = '' and d->>'roomNo' = '' and d->>'note' = '' and d->>'building' = '' and not (d->>'room')::boolean
     and (d->>'covers')::int = 0 and not (d->>'coverOff')::boolean then
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

-- saving an order: total = dishes + room service + guests × table service
-- (an order without "coverFee" — old app, imports, a tablet not updated yet — has no table service, like before)
create or replace function public.insert_order(o jsonb, p_waiter_id uuid, p_waiter_name text, p_source text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_closed timestamptz; v_day date; v_total numeric := 0; v_fee numeric; v_cover numeric; v_covers int; l jsonb; i int := 0;
begin
  v_closed := to_timestamp(coalesce((o->>'closedAt')::double precision, extract(epoch from now()) * 1000) / 1000.0);
  if v_closed > now() + interval '5 minutes' then v_closed := now(); end if;
  v_day := coalesce((o->>'day')::date, (v_closed at time zone 'Europe/Rome')::date);
  v_fee := case when coalesce((o->>'roomService')::boolean, false)
                then coalesce((o->>'roomFee')::numeric, (select (value #>> '{}')::numeric from public.settings where key = 'room_fee'), 10) else 0 end;
  v_covers := least(99, greatest(0, coalesce((o->>'covers')::int, 0)));
  v_cover := least(50, greatest(0, coalesce((o->>'coverFee')::numeric, 0)));
  for l in select * from jsonb_array_elements(coalesce(o->'items', '[]')) loop
    v_total := v_total + (l->>'qty')::int * (l->>'p')::numeric;
  end loop;
  v_total := v_total + v_fee + v_covers * v_cover;

  insert into public.orders(uid, day, closed_at, table_no, client, room_no, building, waiter_id, waiter_name,
                            room_service, room_fee, note, total, source, covers, cover_fee)
  values (o->>'uid', v_day, v_closed, (o->>'table')::int, coalesce(trim(o->>'client'), ''), coalesce(trim(o->>'roomNo'), ''),
          case when o->>'building' in ('HCO', 'DEP') then o->>'building' else '' end,
          p_waiter_id, coalesce(p_waiter_name, ''), coalesce((o->>'roomService')::boolean, false), v_fee,
          coalesce(trim(o->>'note'), ''), v_total, p_source, v_covers, v_cover)
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

-- reopening keeps the "no table service" choice
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
                          'building', o.building, 'room', o.room_service, 'note', o.note, 'covers', o.covers,
                          'coverOff', (o.covers > 0 and o.cover_fee = 0));
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
