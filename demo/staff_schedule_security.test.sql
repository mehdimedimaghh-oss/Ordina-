-- Security + logic tests for staff_shifts (demo database). Everything is rolled back at the end.
\set ON_ERROR_STOP 0
begin;
create temp table r(test text, result text);
grant all on r to authenticated, anon;

-- helper to act as a user
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'email', 'test@demo.app')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- 1) staff (waiters' device) can read the whole schedule
select pg_temp.as_user('00000000-0000-0000-0000-00000000aa01');
insert into r select 'staff reads shifts', count(*)::text from public.staff_shifts;
insert into r select 'staff reads months', count(*)::text from public.staff_months;
-- 2) staff cannot write directly
do $$ begin insert into public.staff_shifts(month, day, person, shift) values ('2026-12-01','2026-12-01','X','M');
  insert into r values ('staff direct insert', 'ALLOWED (BAD)'); exception when others then insert into r values ('staff direct insert', 'refused: ' || sqlstate); end $$;
do $$ begin update public.staff_shifts set shift = 'R' where day = '2026-12-01';
  insert into r values ('staff direct update', case when found then 'ALLOWED (BAD)' else 'no row changed' end); exception when others then insert into r values ('staff direct update', 'refused: ' || sqlstate); end $$;
do $$ begin delete from public.staff_shifts where day = '2026-12-01';
  insert into r values ('staff direct delete', case when found then 'ALLOWED (BAD)' else 'no row changed' end); exception when others then insert into r values ('staff direct delete', 'refused: ' || sqlstate); end $$;
-- 3) staff cannot save through the function
do $$ begin perform public.owner_save_month('2026-12-01', '[]', '[]', 1);
  insert into r values ('staff owner_save_month', 'ALLOWED (BAD)'); exception when others then insert into r values ('staff owner_save_month', 'refused: ' || sqlerrm); end $$;
reset role;

-- 4) reception reads the schedule (read only, since 20261128000000_reception_reads_schedule.sql) but cannot save it
select pg_temp.as_user('00000000-0000-0000-0000-00000000aa02');
insert into r select 'reception reads shifts', count(*)::text from public.staff_shifts;
insert into r select 'reception reads months', count(*)::text from public.staff_months;
do $$ begin perform public.owner_save_month('2026-12-01', '[]', '[]', 1);
  insert into r values ('reception owner_save_month', 'ALLOWED (BAD)'); exception when others then insert into r values ('reception owner_save_month', 'refused: ' || sqlerrm); end $$;
reset role;

-- 5) anonymous (not logged in) cannot read
set local role anon;
do $$ begin perform count(*) from public.staff_shifts; insert into r select 'anon reads shifts', (select count(*) from public.staff_shifts)::text;
  exception when others then insert into r values ('anon reads shifts', 'refused: ' || sqlstate); end $$;
reset role;

-- 6) owner saves a new month (February 2027) with two people on C the same day
select pg_temp.as_user('00000000-0000-0000-0000-00000000aa03');
insert into r select 'owner saves Feb 2099 (rolled back)', public.owner_save_month('2099-02-01',
  '[{"name":"Mehdi"},{"name":"Nikola"},{"name":"Ospite Test"}]',
  '[{"name":"Mehdi","day":1,"shift":"C"},{"name":"Ospite Test","day":1,"shift":"C"},{"name":"Nikola","day":1,"shift":"P"},{"name":"Mehdi","day":28,"shift":"R"}]', 0)::text;
insert into r select 'Feb 1 C', string_agg(person, '+' order by sort) from public.staff_shifts where day = '2099-02-01' and shift = 'C';
-- 7) a second owner device with the old version is refused (no overwrite)
do $$ begin perform public.owner_save_month('2099-02-01', '[{"name":"Mehdi"}]', '[]', 0);
  insert into r values ('stale version save', 'ALLOWED (BAD)'); exception when others then insert into r values ('stale version save', 'refused: ' || sqlstate || ' ' || left(sqlerrm, 60)); end $$;
-- 8) invalid data is refused
do $$ begin perform public.owner_save_month('2099-02-01', '[{"name":"A"}]', '[{"name":"A","day":30,"shift":"M"}]', 1);
  insert into r values ('day 30 in February', 'ALLOWED (BAD)'); exception when others then insert into r values ('day 30 in February', 'refused: ' || sqlerrm); end $$;
do $$ begin perform public.owner_save_month('2099-02-01', '[{"name":"A"}]', '[{"name":"A","day":3,"shift":"X"}]', 1);
  insert into r values ('shift X', 'ALLOWED (BAD)'); exception when others then insert into r values ('shift X', 'refused: ' || sqlerrm); end $$;
do $$ begin perform public.owner_save_month('2099-02-01', '[{"name":"A"},{"name":"a"}]', '[]', 1);
  insert into r values ('same name twice', 'ALLOWED (BAD)'); exception when others then insert into r values ('same name twice', 'refused: ' || sqlerrm); end $$;
do $$ begin perform public.owner_save_month('2099-02-01', '[{"name":"A"}]', '[{"name":"B","day":3,"shift":"M"}]', 1);
  insert into r values ('cell for unknown person', 'ALLOWED (BAD)'); exception when others then insert into r values ('cell for unknown person', 'refused: ' || sqlerrm); end $$;
-- 9) a failed save leaves the month as it was (one transaction)
insert into r select 'Feb still intact after refused saves', count(*)::text || ' rows, version ' || (select version from public.staff_months where month = '2099-02-01') from public.staff_shifts where month = '2099-02-01';
-- 10) the audit log got the save
insert into r select 'audit log', action || ' ' || entity_id || ' ' || (details->>'shifts_after') from public.audit_log where action = 'schedule_save' order by at desc limit 1;
-- 11) December untouched by all of this
insert into r select 'December rows / version', count(*)::text || ' / ' || (select version from public.staff_months where month = '2026-12-01') from public.staff_shifts where month = '2026-12-01';
reset role;
select * from r;
rollback;
