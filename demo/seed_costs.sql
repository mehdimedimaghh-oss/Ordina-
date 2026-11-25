-- DEMO ONLY (invented numbers, invented suppliers): purchase costs + provisional VAT rates for the demo database.
-- Goes through the real owner functions, exactly like the app. Never run this in production.
-- psql -h /var/tmp/demopg -p 55432 -U postgres -d demo -f demo/seed_costs.sql
begin;
-- start clean (demo database only)
truncate public.item_costs, public.item_finance restart identity;
update public.finance_settings set value = case key when 'sales_vat_sections' then '{}'::jsonb when 'vat_status' then '{"confirmed": false, "note": ""}'::jsonb else 'null'::jsonb end;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000aa03', true),
       set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000aa03","email":"owner@demo.app"}', true);
set local role authenticated;

-- provisional demo rates (NOT confirmed): food & soft drinks 10, wine/spirits/cocktails 22
select public.owner_set_vat('{"sales_default":10,"purchase_default":10,"sales_sections":{"vino":22,"champagne":22,"liquori":22,"cocktail":22,"servizio":10}}');

do $$
declare m record; sup text; f numeric; gl int; bottle numeric;
begin
  for m in select * from public.menu_items
            where not hidden and id not in ('aperitif', 'souffle-pist', 'cocktail-misura', 'analcolico-su-misura', 'parmigiana', 'zuppa')   -- left without cost: shows the warning
            order by section, sort loop
    sup := case m.section when 'giorno' then 'Surgelati Roma srl' when 'primi' then 'Surgelati Roma srl' when 'secondi' then 'Surgelati Roma srl'
                          when 'dolci' then 'Dolce Freddo spa' when 'pinsa' then 'Pinsa Bases srl' when 'caffe' then 'Caffè Tevere'
                          when 'bibite' then 'Bevande Lazio' when 'cocktail' then 'Bevande Lazio' when 'liquori' then 'Bevande Lazio' else 'Cantine Demo' end;
    f := case m.section when 'giorno' then 0.27 when 'primi' then 0.25 when 'secondi' then 0.33 when 'dolci' then 0.30 when 'pinsa' then 0.24
                        when 'caffe' then 0.12 when 'bibite' then 0.28 when 'cocktail' then 0.20 when 'liquori' then 0.16 else 0.36 end;
    if m.id like '%-c' then   -- glass: bottle cost ÷ glasses (different per bottle)
      gl := case when m.id like 'spum%' or m.id like 'prosecco%' then 6 when m.id like 'gewurz%' then 4 else 5 end;
      bottle := round((select price from public.menu_items where id = replace(m.id, '-c', '-b')) / 1.22 * 0.36, 2);
      perform public.owner_save_cost(jsonb_build_object('item_id', m.id, 'bottle_cost', bottle, 'glasses', gl, 'valid_from', '2026-09-01', 'invoice_date', '2026-08-28', 'supplier', sup, 'invoice_ref', 'CD-0828'));
    else
      perform public.owner_save_cost(jsonb_build_object('item_id', m.id, 'cost', round(m.price / 1.1 * f, 2), 'valid_from', '2026-09-01', 'invoice_date', '2026-08-28', 'supplier', sup, 'invoice_ref', 'F-' || upper(left(sup, 3)) || '-0828'));
    end if;
  end loop;
  -- 1 November: the frozen-food supplier raises prices by 8% (new invoice)
  for m in select * from public.menu_items where section in ('giorno', 'primi', 'secondi') and not hidden and id not in ('parmigiana', 'zuppa') loop
    perform public.owner_save_cost(jsonb_build_object('item_id', m.id, 'cost', round((select cost from public.item_costs where item_id = m.id and voided_at is null order by valid_from desc limit 1) * 1.08, 2), 'valid_from', '2026-11-01', 'invoice_date', '2026-10-30',
      'supplier', 'Surgelati Roma srl', 'invoice_ref', 'F-SUR-1030', 'note', 'listino novembre +8%'));
  end loop;
end $$;
commit;
select count(*) as costs, count(distinct item_id) as dishes from public.item_costs;
