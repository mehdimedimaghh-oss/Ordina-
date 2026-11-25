-- Purchase costs: security + calculation tests on the DEMO database. Everything is rolled back at the end.
-- psql -h /var/tmp/demopg -p 55432 -U postgres -d demo -f demo/purchase_costs.test.sql
\set ON_ERROR_STOP 1
\pset footer off
\o /dev/null
begin;
create temp table r(n serial, test text, pass boolean, info text);
grant all on r to authenticated, anon; grant usage on sequence r_n_seq to authenticated, anon;
create temp table snap(k text primary key, v text);

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'email', case uid
    when '00000000-0000-0000-0000-00000000aa01' then 'staff@demo.app' when '00000000-0000-0000-0000-00000000aa02' then 'reception@demo.app'
    else 'owner@demo.app' end)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.ok(t text, cond boolean, info text default '') returns void language sql as $$ insert into r(test, pass, info) values (t, coalesce(cond, false), info) $$;
-- run a statement, expect it to FAIL
create function pg_temp.refused(t text, stmt text) returns void language plpgsql as $$
begin execute stmt; perform pg_temp.ok(t, false, 'ALLOWED');
exception when others then perform pg_temp.ok(t, true, left(sqlerrm, 90)); end $$;
-- run a statement, expect it to WORK
create function pg_temp.works(t text, stmt text) returns void language plpgsql as $$
begin execute stmt; perform pg_temp.ok(t, true);
exception when others then perform pg_temp.ok(t, false, left(sqlerrm, 120)); end $$;

-- fingerprints of what must never change
insert into snap select 'menu', md5(string_agg(id || '|' || price || '|' || name_it || '|' || hidden, ',' order by id)) from public.menu_items;
insert into snap select 'orders', md5(string_agg(o::text, ',' order by id)) from public.orders o;
insert into snap select 'lines', md5(string_agg(l::text, ',' order by id)) from public.order_lines l;
insert into snap select 'shifts', md5(coalesce(string_agg(s::text, ',' order by id), '')) from public.staff_shifts s;
insert into snap select 'audit0', max(id)::text from public.audit_log;

-- ============ OWNER: save costs ============
select pg_temp.as_user('00000000-0000-0000-0000-00000000aa03');
select pg_temp.works('owner saves Lasagne €3,20 from 01/11 (invoice date)',
  $$select public.owner_save_cost('{"item_id":"lasagne","cost":3.2,"invoice_date":"2026-11-01","supplier":"Surgelati Roma","invoice_ref":"F-101"}')$$);
select pg_temp.ok('no effective date written → invoice date used', (select valid_from = '2026-11-01' from public.item_costs where item_id = 'lasagne'));
select pg_temp.refused('same dish, same date again → refused (use Correct)', $$select public.owner_save_cost('{"item_id":"lasagne","cost":9,"valid_from":"2026-11-01"}')$$);
select pg_temp.refused('no date at all → refused', $$select public.owner_save_cost('{"item_id":"lasagne","cost":3}')$$);
select pg_temp.refused('negative cost → refused', $$select public.owner_save_cost('{"item_id":"lasagne","cost":-1,"valid_from":"2026-11-02"}')$$);
select pg_temp.refused('unknown dish → refused', $$select public.owner_save_cost('{"item_id":"nope","cost":1,"valid_from":"2026-11-02"}')$$);
select pg_temp.works('owner saves a new supplier price €3,50 from 20/11',
  $$select public.owner_save_cost('{"item_id":"lasagne","cost":3.5,"valid_from":"2026-11-20","invoice_date":"2026-11-18","supplier":"Surgelati Roma","invoice_ref":"F-140"}')$$);
select pg_temp.ok('20/11 cost documented: effective date 20/11, invoice 18/11',
  (select valid_from = '2026-11-20' and invoice_date = '2026-11-18' from public.item_costs where item_id = 'lasagne' and cost = 3.5));
-- correction
select pg_temp.refused('correct without a reason → refused',
  format($$select public.owner_save_cost('{"item_id":"lasagne","cost":3.4,"valid_from":"2026-11-20","replaces":%s}')$$, (select id from public.item_costs where cost = 3.5)));
select pg_temp.works('correct €3,50 → €3,40 with a reason',
  format($$select public.owner_save_cost('{"item_id":"lasagne","cost":3.4,"valid_from":"2026-11-20","invoice_date":"2026-11-18","supplier":"Surgelati Roma","replaces":%s,"reason":"typo on the invoice"}')$$, (select id from public.item_costs where cost = 3.5)));
select pg_temp.ok('old €3,50 kept, marked cancelled, linked to the new one',
  (select voided_at is not null and void_reason = 'typo on the invoice' and replaced_by is not null from public.item_costs where cost = 3.5));
select pg_temp.ok('Lasagne history: 3 rows (2 valid + 1 cancelled)', (select count(*) = 3 and count(*) filter (where voided_at is null) = 2 from public.item_costs where item_id = 'lasagne'));
-- glass helper
select pg_temp.refused('glass helper without number of glasses → refused', $$select public.owner_save_cost('{"item_id":"merlot-c","bottle_cost":12,"valid_from":"2026-11-01"}')$$);
select pg_temp.works('Merlot glass = bottle €12 ÷ 6 glasses', $$select public.owner_save_cost('{"item_id":"merlot-c","bottle_cost":12,"glasses":6,"valid_from":"2026-11-01","invoice_date":"2026-10-30"}')$$);
select pg_temp.ok('glass cost = €2,0000 and 6 glasses remembered for this bottle',
  (select c.cost = 2 and f.glasses_per_bottle = 6 from public.item_costs c join public.item_finance f using (item_id) where c.item_id = 'merlot-c'));
select pg_temp.works('White wine glass = bottle €10 ÷ 4 glasses (other bottle, other number)', $$select public.owner_save_cost('{"item_id":"bianco-c","bottle_cost":10,"glasses":4,"valid_from":"2026-11-01"}')$$);
select pg_temp.ok('glasses are per bottle (6 and 4)', (select string_agg(glasses_per_bottle::text, ',' order by item_id) = '4,6' from public.item_finance where glasses_per_bottle is not null));
-- a price change in the middle of the month (Ravioli: sold every day 1–12/11)
select pg_temp.works('Ravioli €2,00 from 01/11', $$select public.owner_save_cost('{"item_id":"ravioli","cost":2,"valid_from":"2026-11-01","invoice_date":"2026-11-01"}')$$);
select pg_temp.works('Ravioli €2,40 from 07/11 (new supplier price)', $$select public.owner_save_cost('{"item_id":"ravioli","cost":2.4,"valid_from":"2026-11-07","invoice_date":"2026-11-06","supplier":"Pasta Fresca srl"}')$$);
-- void
select pg_temp.works('typo cost for Carbonara saved', $$select public.owner_save_cost('{"item_id":"carbonara","cost":30,"valid_from":"2026-11-01"}')$$);
select pg_temp.refused('cancel without reason → refused', format('select public.owner_void_cost(%s, %L)', (select id from public.item_costs where item_id = 'carbonara'), ''));
select pg_temp.works('cancel with reason', format('select public.owner_void_cost(%s, %L)', (select id from public.item_costs where item_id = 'carbonara'), 'wrong dish'));
select pg_temp.ok('cancelled cost still in history, not used', (select bool_and(voided_at is not null) and count(*) = 1 from public.item_costs where item_id = 'carbonara'));

-- ============ OWNER: margins ============
-- no VAT rate written yet → nothing assumed
select pg_temp.ok('no VAT rate yet → no margin invented, all revenue reported as missing VAT',
  (select (t->>'known_net')::numeric = 0 and (t->>'gross_no_vat')::numeric = (t->>'dishes_gross')::numeric and p->>'provisional' = 'true'
     from (select p, p->'totals' t from (select public.owner_profit('2026-11-01', '2026-11-25') p) a) b));
select pg_temp.works('owner writes provisional VAT: dishes of the day + pasta 10%, wine 22%, Merlot glass 22%',
  $$select public.owner_set_vat('{"sales_sections":{"giorno":10,"primi":10,"vino":22},"items":{"merlot-c":{"sales_vat":22}}}')$$);
select pg_temp.refused('mark VAT as confirmed without saying by whom → refused', $$select public.owner_set_vat('{"confirmed":true}')$$);
create temp table p as select public.owner_profit('2026-11-01', '2026-11-25') as p;
grant select on p to authenticated;
select pg_temp.ok('still PROVISIONAL (not confirmed)', (select p->>'provisional' = 'true' from p));
-- totals must equal the dashboard: sum of the totals of sent orders
select pg_temp.ok('revenue = dashboard total (sent orders only)',
  (select (p->'totals'->>'revenue_gross')::numeric = (select sum(total) from public.orders where status = 'closed' and day between '2026-11-01' and '2026-11-25') from p),
  (select p->'totals'->>'revenue_gross' from p));
select pg_temp.ok('dishes + coperto + room fee = revenue',
  (select (p->'totals'->>'dishes_gross')::numeric + (p->'service'->>'cover')::numeric + (p->'service'->>'room_fee')::numeric = (p->'totals'->>'revenue_gross')::numeric from p));
select pg_temp.ok('reopened orders not counted',
  (select (p->'totals'->>'orders')::int = (select count(*) from public.orders where status = 'closed' and day between '2026-11-01' and '2026-11-25') from p));
-- Ravioli cost: 2,00 before 07/11, 2,40 from 07/11
select pg_temp.ok('Ravioli cost = qty before 07/11 × 2,00 + qty from 07/11 × 2,40',
  (select (i->>'cost')::numeric = (select round(sum(l.qty * case when o.day < '2026-11-07' then 2 else 2.4 end), 2)
      from public.order_lines l join public.orders o on o.id = l.order_id where o.status = 'closed' and o.day between '2026-11-01' and '2026-11-25' and split_part(l.item_id, '~', 1) = 'ravioli')
     from p, jsonb_array_elements(p->'items') i where i->>'item_id' = 'ravioli'),
  (select concat(i->>'qty', ' sold, cost € ', i->>'cost') from p, jsonb_array_elements(p->'items') i where i->>'item_id' = 'ravioli'));
select pg_temp.ok('Ravioli margin = revenue ÷ 1,10 − cost, food cost % right',
  (select abs((i->>'margin')::numeric - ((i->>'gross')::numeric / 1.10 - (i->>'cost')::numeric)) < 0.02
      and abs((i->>'food_cost_pct')::numeric - (i->>'cost')::numeric / ((i->>'gross')::numeric / 1.10) * 100) < 0.1
     from p, jsonb_array_elements(p->'items') i where i->>'item_id' = 'ravioli'),
  (select concat('revenue € ', i->>'gross', ' · margin € ', i->>'margin', ' · food cost ', i->>'food_cost_pct', '%') from p, jsonb_array_elements(p->'items') i where i->>'item_id' = 'ravioli'));
select pg_temp.ok('Merlot glass uses its own VAT 22% and cost 2,00',
  (select coalesce((i->>'qty')::int = 0, true) or (i->>'vat_min')::numeric = 22 and (i->>'unit_cost')::numeric = 2 from p, jsonb_array_elements(p->'items') i where i->>'item_id' = 'merlot-c'));
select pg_temp.ok('Carbonara (cancelled cost) reported as "cost missing", not as €0',
  (select coalesce((i->>'qty_no_cost')::int = (i->>'qty')::int and i->>'cost' is null, true) from p, jsonb_array_elements(p->'items') i where i->>'item_id' = 'carbonara'));
select pg_temp.ok('warning counts dishes without cost', (select (p->'totals'->>'items_no_cost')::int > 0 and (p->'totals'->>'gross_no_cost')::numeric > 0 from p),
  (select concat(p->'totals'->>'items_no_cost', ' dishes, € ', p->'totals'->>'gross_no_cost') from p));
-- custom drinks counted as their menu dish
select pg_temp.ok('custom drinks ("…~abc") counted as their menu dish',
  (select not exists (select 1 from p, jsonb_array_elements(p->'items') i where i->>'item_id' like '%~%')));
-- confirm VAT
select pg_temp.works('owner confirms VAT with a note', $$select public.owner_set_vat('{"confirmed":true,"note":"Confirmed by commercialista Rossi, 01/12"}')$$);
select pg_temp.ok('after confirmation: not provisional', (select public.owner_profit('2026-11-01', '2026-11-25')->>'provisional' = 'false'));
select pg_temp.works('owner changes a rate without confirming again', $$select public.owner_set_vat('{"sales_sections":{"giorno":10,"vino":22,"primi":10,"caffe":10}}')$$);
select pg_temp.ok('changing a rate → PROVISIONAL again', (select public.owner_profit('2026-11-01', '2026-11-25')->>'provisional' = 'true'));
select pg_temp.refused('VAT 150% → refused', $$select public.owner_set_vat('{"sales_default":150}')$$);
reset role;

-- ============ AUDIT ============
select pg_temp.ok('audit: costs saved, corrected, cancelled, VAT changes all logged',
  (select count(*) filter (where action = 'cost_save') = 7 and count(*) filter (where action = 'cost_correct') = 1
      and count(*) filter (where action = 'cost_void') = 1 and count(*) filter (where action = 'vat_save') = 3
     from public.audit_log where id > (select v::bigint from snap where k = 'audit0')),
  (select string_agg(action || '×' || n, ' ') from (select action, count(*) n from public.audit_log where id > (select v::bigint from snap where k = 'audit0') group by 1) a));
select pg_temp.ok('audit of the correction keeps old cost, new cost and reason',
  (select details->>'old_cost' = '3.5000' and details->>'cost' = '3.4' and details->>'reason' = 'typo on the invoice' from public.audit_log where action = 'cost_correct' order by id desc limit 1),
  (select details::text from public.audit_log where action = 'cost_correct' order by id desc limit 1));
select pg_temp.ok('audit says how many sales already sold got the new cost', (select (details->>'sold_affected')::int >= 0 from public.audit_log where action = 'cost_save' order by id limit 1));

-- ============ WAITERS (staff) and RECEPTION ============
select pg_temp.as_user('00000000-0000-0000-0000-00000000aa01');
select pg_temp.ok('waiters read 0 costs', (select count(*) = 0 from public.item_costs));
select pg_temp.ok('waiters read 0 VAT / glasses rows', (select count(*) = 0 from public.item_finance) and (select count(*) = 0 from public.finance_settings));
select pg_temp.refused('waiters: direct insert of a cost', $$insert into public.item_costs(item_id, cost, valid_from) values ('lasagne', 1, '2026-11-01')$$);
select pg_temp.refused('waiters: owner_save_cost', $$select public.owner_save_cost('{"item_id":"lasagne","cost":1,"valid_from":"2026-11-03"}')$$);
select pg_temp.refused('waiters: owner_void_cost', 'select public.owner_void_cost(1, ''because'')');
select pg_temp.refused('waiters: owner_set_vat', $$select public.owner_set_vat('{"sales_default":4}')$$);
select pg_temp.refused('waiters: owner_profit', $$select public.owner_profit('2026-11-01', '2026-11-25')$$);
select pg_temp.refused('waiters: cost_on (internal)', $$select public.cost_on('lasagne', '2026-11-25')$$);
select pg_temp.ok('waiters still read the menu with prices (unchanged)', (select count(*) > 0 from public.menu_items));
select pg_temp.as_user('00000000-0000-0000-0000-00000000aa02');
select pg_temp.ok('reception reads 0 costs / VAT / settings', (select count(*) = 0 from public.item_costs) and (select count(*) = 0 from public.item_finance) and (select count(*) = 0 from public.finance_settings));
select pg_temp.refused('reception: owner_save_cost', $$select public.owner_save_cost('{"item_id":"lasagne","cost":1,"valid_from":"2026-11-03"}')$$);
select pg_temp.refused('reception: owner_profit', $$select public.owner_profit('2026-11-01', '2026-11-25')$$);
select pg_temp.refused('reception: owner_set_vat', $$select public.owner_set_vat('{"sales_default":4}')$$);
select pg_temp.refused('reception: direct update of a cost', $$update public.item_costs set cost = 0$$);
reset role;
set local role anon;
select pg_temp.refused('anonymous: read costs', 'select count(*) from public.item_costs');
select pg_temp.refused('anonymous: owner_profit', $$select public.owner_profit('2026-11-01', '2026-11-25')$$);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000aa03');
select pg_temp.refused('even the owner cannot write the table directly (only through the functions)', $$update public.item_costs set cost = 0$$);
select pg_temp.refused('even the owner cannot delete history', $$delete from public.item_costs$$);
reset role;

-- ============ NOTHING ELSE CHANGED ============
select pg_temp.ok('menu selling prices unchanged', (select md5(string_agg(id || '|' || price || '|' || name_it || '|' || hidden, ',' order by id)) from public.menu_items) = (select v from snap where k = 'menu'));
select pg_temp.ok('orders unchanged', (select md5(string_agg(o::text, ',' order by id)) from public.orders o) = (select v from snap where k = 'orders'));
select pg_temp.ok('order lines unchanged', (select md5(string_agg(l::text, ',' order by id)) from public.order_lines l) = (select v from snap where k = 'lines'));
select pg_temp.ok('staff schedule unchanged', (select md5(coalesce(string_agg(s::text, ',' order by id), '')) from public.staff_shifts s) = (select v from snap where k = 'shifts'));

\o
select n, case when pass then 'PASS' else 'FAIL' end as result, test, info from r order by n;
select count(*) filter (where pass) as passed, count(*) filter (where not pass) as failed from r;
rollback;
