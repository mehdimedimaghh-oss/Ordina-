-- Reception reads the staff schedule (read only): security test on the DEMO database. Rolled back at the end.
-- psql -h /var/tmp/demopg -p 55432 -U postgres -d demo -f demo/reception_schedule.test.sql
\set ON_ERROR_STOP 1
\pset footer off
\o /dev/null
begin;
create temp table r(n serial, test text, pass boolean, info text);
grant all on r to authenticated, anon; grant usage on sequence r_n_seq to authenticated, anon;
create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.ok(t text, cond boolean, info text default '') returns void language sql as $$ insert into r(test, pass, info) values (t, coalesce(cond, false), info) $$;
create function pg_temp.refused(t text, stmt text) returns void language plpgsql as $$
begin
  begin execute stmt; raise exception 'WRONGLY_ALLOWED';
  exception when others then perform pg_temp.ok(t, sqlerrm <> 'WRONGLY_ALLOWED', left(sqlerrm, 80)); end;
end $$;
create temp table fp as select (select md5(string_agg(s::text, ',' order by id)) from public.staff_shifts s) as shifts,
                               (select md5(string_agg(m::text, ',' order by month)) from public.staff_months m) as months;
grant select on fp to authenticated, anon;

-- RECEPTION: can read everything of the schedule
select pg_temp.as_user('00000000-0000-0000-0000-00000000aa02');
select pg_temp.ok('reception reads all schedule months', (select count(*) from public.staff_months) = (select count(*) from public.staff_months where true), (select count(*)::text || ' months' from public.staff_months));
select pg_temp.ok('reception reads the shifts (e.g. December 2026: 124)', (select count(*) from public.staff_shifts where month = '2026-12-01') = 124);
select pg_temp.ok('reception sees 22/12 C = Cristian + Nuova risorsa', (select string_agg(person, '+' order by sort) from public.staff_shifts where day = '2026-12-22' and shift = 'C') = 'Cristian+Nuova risorsa');
-- RECEPTION: cannot change anything
select pg_temp.refused('reception: insert a shift', $$insert into public.staff_shifts(month, day, person, shift) values ('2026-12-01', '2026-12-01', 'X', 'M')$$);
select pg_temp.refused('reception: update a shift', $$update public.staff_shifts set shift = 'R'$$);
select pg_temp.refused('reception: delete shifts', $$delete from public.staff_shifts$$);
select pg_temp.refused('reception: insert a month', $$insert into public.staff_months(month) values ('2099-01-01')$$);
select pg_temp.refused('reception: update a month', $$update public.staff_months set version = 99$$);
select pg_temp.refused('reception: delete months', $$delete from public.staff_months$$);
select pg_temp.refused('reception: owner_save_month', $$select public.owner_save_month('2026-12-01', '[]', '[]', 1)$$);
-- RECEPTION: still no costs (unchanged)
select pg_temp.ok('reception still reads 0 purchase costs', (select count(*) from public.item_costs) = 0);
reset role;
-- WAITERS (staff): unchanged
select pg_temp.as_user('00000000-0000-0000-0000-00000000aa01');
select pg_temp.ok('waiters still read the schedule', (select count(*) from public.staff_shifts) > 0);
select pg_temp.refused('waiters still cannot save the schedule', $$select public.owner_save_month('2026-12-01', '[]', '[]', 1)$$);
reset role;
-- ANONYMOUS: nothing
set local role anon;
select pg_temp.refused('anonymous cannot read the schedule', 'select count(*) from public.staff_shifts');
reset role;
-- nothing changed
select pg_temp.ok('schedule unchanged by all the attempts', (select md5(string_agg(s::text, ',' order by id)) from public.staff_shifts s) = (select shifts from fp)
  and (select md5(string_agg(m::text, ',' order by month)) from public.staff_months m) = (select months from fp));
\o
select n, case when pass then 'PASS' else 'FAIL' end as result, test, info from r order by n;
select count(*) filter (where pass) as passed, count(*) filter (where not pass) as failed from r;
rollback;
