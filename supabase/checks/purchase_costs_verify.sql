-- =====================================================================
--  READ-ONLY CHECK (purchase costs security). Safe to run in production: it changes nothing.
--  It acts as the real waiter-device login (role staff), the reception login and an anonymous visitor,
--  exactly like a direct API request would be treated by the database, and tries to read and write
--  every cost table and call every financial function. Any write that wrongly succeeded is undone at once.
--  Supabase → SQL Editor → paste all → Run. Expected: every line "OK", last line "ALL OK".
-- =====================================================================
create temp table if not exists chk(n serial, who text, test text, result text);
truncate chk;
grant all on chk to anon, authenticated; grant usage on sequence chk_n_seq to anon, authenticated;

-- act as a logged-in user of a role (the first login with that role), or as anonymous
create or replace function pg_temp.act(p_role text) returns text language plpgsql as $$
declare u uuid;
begin
  if p_role = 'anon' then perform set_config('role', 'anon', true); return 'anonymous'; end if;
  select user_id into u from public.app_users where role = p_role order by created_at limit 1;
  if u is null then return null; end if;
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  return p_role;
end $$;
-- reading must return nothing (or be refused)
create or replace function pg_temp.read0(who text, tbl text) returns void language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from public.%I', tbl) into n;
  insert into chk(who, test, result) values (who, 'read ' || tbl, case when n = 0 then 'OK (0 rows)' else 'BAD: ' || n || ' rows visible' end);
exception when others then insert into chk(who, test, result) values (who, 'read ' || tbl, 'OK (refused)');
end $$;
-- a write or a call must be refused; if it worked, it is undone and reported BAD
create or replace function pg_temp.refused(who text, what text, stmt text) returns void language plpgsql as $$
begin
  begin execute stmt; raise exception 'WRONGLY_ALLOWED';
  exception when others then
    insert into chk(who, test, result) values (who, what, case when sqlerrm = 'WRONGLY_ALLOWED' then 'BAD: allowed (undone)' else 'OK (refused)' end);
  end;
end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

do $$
declare r text; who text; t text;
begin
  foreach r in array array['staff', 'reception', 'anon'] loop
    who := pg_temp.act(r);
    if who is null then insert into chk(who, test, result) values (r, 'login with this role', 'SKIPPED: no login has this role'); perform set_config('role', 'none', true); continue; end if;
    foreach t in array array['item_costs', 'item_finance', 'finance_settings'] loop
      perform pg_temp.read0(who, t);
      perform pg_temp.refused(who, 'insert ' || t, format('insert into public.%I default values', t));
      perform pg_temp.refused(who, 'update ' || t, case when t = 'item_costs' then 'update public.item_costs set note = note' else format('update public.%I set updated_at = now()', t) end);
      perform pg_temp.refused(who, 'delete ' || t, format('delete from public.%I', t));
    end loop;
    perform pg_temp.refused(who, 'rpc owner_profit',    $q$select public.owner_profit(current_date - 30, current_date)$q$);
    perform pg_temp.refused(who, 'rpc owner_save_cost', $q$select public.owner_save_cost('{"item_id":"ravioli","cost":0,"valid_from":"2026-11-01"}')$q$);
    perform pg_temp.refused(who, 'rpc owner_void_cost', $q$select public.owner_void_cost(1, 'security check')$q$);
    perform pg_temp.refused(who, 'rpc owner_set_vat',   $q$select public.owner_set_vat('{"sales_default":4}')$q$);
    perform pg_temp.refused(who, 'rpc cost_on',         $q$select public.cost_on('ravioli', current_date)$q$);
    perform set_config('role', 'none', true);
  end loop;
end $$;

select n, who, test, result from chk
union all
select 999, '', 'SUMMARY', case when exists (select 1 from chk where result like 'BAD%') then 'PROBLEM: see the BAD lines'
                                when exists (select 1 from chk where result like 'SKIPPED%') then 'OK, but some roles were skipped'
                                else 'ALL OK (' || (select count(*) from chk) || ' checks)' end
order by 1;
