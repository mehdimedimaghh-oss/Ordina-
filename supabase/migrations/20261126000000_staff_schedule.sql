-- =====================================================================
--  MONTHLY STAFF SCHEDULE (Turni) — managed by the owner in the app, no code change per month.
--  * staff_months: one row per month (the people in the order of the sheet + a version number)
--  * staff_shifts: one row per person per day: M (06:30–14:30), C (11:00–19:00), P (17:00–01:00), R (rest)
--  * read: owner + waiters' devices (staff). NOT reception. Write: only the owner, through owner_save_month
--  * the months already written in the app code (Nov 2026, Dec 2026, 1 Jan 2027) are copied as they are
--  Run once in Supabase → SQL Editor → Run. Safe to run again (it never overwrites a saved month).
-- =====================================================================

create table if not exists public.staff_months (
  month      date primary key check (extract(day from month) = 1),
  people     jsonb not null default '[]'::jsonb,       -- [{"name": "Mehdi", "waiter_id": "…"}, …] in the order of the grid
  version    int not null default 1,                    -- +1 at every save: two owners cannot overwrite each other
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.staff_shifts (
  id        bigint generated always as identity primary key,
  month     date not null references public.staff_months(month) on delete cascade,
  day       date not null,
  person    text not null check (length(trim(person)) between 1 and 60),
  waiter_id uuid references public.waiters(id) on delete set null,
  shift     text not null check (shift in ('M', 'C', 'P', 'R')),
  sort      int not null default 0,
  constraint staff_shifts_day_in_month check (date_trunc('month', day)::date = month),
  constraint staff_shifts_one_per_day unique (day, person)
);
create index if not exists staff_shifts_day on public.staff_shifts(day);

alter table public.staff_months enable row level security;
alter table public.staff_shifts enable row level security;
-- read: owner and the waiters' devices (is_staff = owner or staff). Reception is not staff: no access.
drop policy if exists "staff reads months" on public.staff_months;
drop policy if exists "staff reads shifts" on public.staff_shifts;
create policy "staff reads months" on public.staff_months for select to authenticated using (public.is_staff());
create policy "staff reads shifts" on public.staff_shifts for select to authenticated using (public.is_staff());
-- no insert/update/delete policy: nobody writes directly, only through owner_save_month (owner only)
revoke insert, update, delete on public.staff_months, public.staff_shifts from anon, authenticated;
grant select on public.staff_months, public.staff_shifts to authenticated;

-- Save one whole month in one transaction.
--   p_people: [{"name": "Mehdi", "waiter_id": "uuid or null"}, …]   (order of the rows)
--   p_cells:  [{"name": "Mehdi", "day": 1, "shift": "M"}, …]          (empty cells are simply not sent)
--   p_version: the version the owner opened (0 for a month never saved). If somebody saved in between: refused.
create or replace function public.owner_save_month(p_month date, p_people jsonb, p_cells jsonb, p_version int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cur public.staff_months; v_before int; v_after int; v_names text[]; c jsonb; v_day date; v_last int; v_new int;
begin
  perform public.require_owner();
  if p_month is null or extract(day from p_month) <> 1 then raise exception 'Month must be the first day of the month'; end if;
  if jsonb_typeof(coalesce(p_people, '[]')) <> 'array' or jsonb_typeof(coalesce(p_cells, '[]')) <> 'array' then raise exception 'Bad data'; end if;
  if jsonb_array_length(coalesce(p_people, '[]')) > 40 then raise exception 'Too many people (max 40)'; end if;

  -- people: names not empty, not repeated (case-insensitive)
  select array_agg(trim(x->>'name')) into v_names from jsonb_array_elements(coalesce(p_people, '[]')) x;
  if exists (select 1 from unnest(coalesce(v_names, '{}')) n where n is null or length(n) = 0 or length(n) > 60) then raise exception 'Every person needs a name (max 60 letters)'; end if;
  if (select count(distinct lower(n)) from unnest(coalesce(v_names, '{}')) n) <> coalesce(array_length(v_names, 1), 0) then raise exception 'The same name is twice in the list'; end if;

  -- lock the month; check nobody saved since the owner opened it
  insert into public.staff_months(month, people, version) values (p_month, '[]', 0) on conflict (month) do nothing;
  select * into cur from public.staff_months where month = p_month for update;
  if cur.version <> coalesce(p_version, 0) then
    raise exception 'This month was changed on another device (version % vs %). Reload it and make your changes again.', cur.version, coalesce(p_version, 0) using errcode = '40001';
  end if;

  select count(*) into v_before from public.staff_shifts where month = p_month;
  delete from public.staff_shifts where month = p_month;
  v_last := extract(day from (p_month + interval '1 month - 1 day'))::int;
  for c in select * from jsonb_array_elements(coalesce(p_cells, '[]')) loop
    if (c->>'shift') not in ('M', 'C', 'P', 'R') then raise exception 'Unknown shift %', c->>'shift'; end if;
    if (c->>'day')::int not between 1 and v_last then raise exception 'Day % is not in this month', c->>'day'; end if;
    if not (trim(c->>'name') = any (v_names)) then raise exception '% is not in the list of people', c->>'name'; end if;
    v_day := p_month + ((c->>'day')::int - 1);
    insert into public.staff_shifts(month, day, person, waiter_id, shift, sort)
    select p_month, v_day, trim(c->>'name'),
           (select nullif(x->>'waiter_id', '')::uuid from jsonb_array_elements(p_people) x where trim(x->>'name') = trim(c->>'name') limit 1),
           c->>'shift', array_position(v_names, trim(c->>'name')) - 1;
  end loop;
  select count(*) into v_after from public.staff_shifts where month = p_month;

  update public.staff_months
     set people = coalesce(p_people, '[]'), version = cur.version + 1, updated_at = now(), updated_by = coalesce(auth.jwt() ->> 'email', 'owner')
   where month = p_month
  returning version into v_new;
  perform public.audit('schedule_save', 'staff_month', to_char(p_month, 'YYYY-MM'),
    jsonb_build_object('people', v_names, 'shifts_before', v_before, 'shifts_after', v_after, 'version', v_new));
  return jsonb_build_object('ok', true, 'version', v_new, 'shifts', v_after);
end $$;
revoke all on function public.owner_save_month(date, jsonb, jsonb, int) from public, anon;
grant execute on function public.owner_save_month(date, jsonb, jsonb, int) to authenticated;

-- live updates on every device
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.staff_months; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.staff_shifts; exception when duplicate_object then null; end;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Copy of the months already in the app (src/schedule.js), exactly as they are.
-- A month already saved in the database is never touched.
-- ---------------------------------------------------------------------
with m(month, people) as (values
('2026-11-01', '[{"name":"Gabri"},{"name":"Mehdi"},{"name":"Cristian"},{"name":"Nikola"},{"name":"Zai"}]'::jsonb),
('2026-12-01', '[{"name":"Gabri"},{"name":"Mehdi"},{"name":"Cristian"},{"name":"Nikola"},{"name":"Nuova risorsa"}]'::jsonb),
('2027-01-01', '[{"name":"Mehdi"},{"name":"Cristian"},{"name":"Nikola"},{"name":"Nuova risorsa"}]'::jsonb)
), ins as (
  insert into public.staff_months(month, people, version, updated_by)
  select month::date, people, 1, 'import from app (schedule.js)' from m
  on conflict (month) do nothing
  returning month
)
insert into public.staff_shifts(month, day, person, shift, sort)
select date_trunc('month', r.day::date)::date, r.day::date, r.person, r.shift, r.sort
from (values
('2026-11-01', 'Gabri', 'M', 0),
('2026-11-02', 'Gabri', 'M', 0),
('2026-11-03', 'Mehdi', 'M', 1),
('2026-11-04', 'Mehdi', 'M', 1),
('2026-11-05', 'Mehdi', 'M', 1),
('2026-11-06', 'Mehdi', 'M', 1),
('2026-11-07', 'Gabri', 'M', 0),
('2026-11-08', 'Gabri', 'M', 0),
('2026-11-09', 'Mehdi', 'M', 1),
('2026-11-10', 'Gabri', 'M', 0),
('2026-11-11', 'Gabri', 'M', 0),
('2026-11-12', 'Mehdi', 'M', 1),
('2026-11-13', 'Mehdi', 'M', 1),
('2026-11-14', 'Zai', 'M', 4),
('2026-11-15', 'Mehdi', 'M', 1),
('2026-11-16', 'Gabri', 'M', 0),
('2026-11-17', 'Gabri', 'M', 0),
('2026-11-18', 'Gabri', 'M', 0),
('2026-11-19', 'Mehdi', 'M', 1),
('2026-11-20', 'Zai', 'M', 4),
('2026-11-21', 'Gabri', 'M', 0),
('2026-11-22', 'Gabri', 'M', 0),
('2026-11-23', 'Mehdi', 'M', 1),
('2026-11-24', 'Mehdi', 'M', 1),
('2026-11-25', 'Mehdi', 'M', 1),
('2026-11-26', 'Mehdi', 'M', 1),
('2026-11-27', 'Mehdi', 'M', 1),
('2026-11-28', 'Zai', 'M', 4),
('2026-11-29', 'Mehdi', 'M', 1),
('2026-11-30', 'Mehdi', 'M', 1),
('2026-11-01', 'Mehdi', 'C', 1),
('2026-11-02', 'Mehdi', 'C', 1),
('2026-11-03', 'Gabri', 'C', 0),
('2026-11-04', 'Gabri', 'C', 0),
('2026-11-05', 'Nikola', 'C', 3),
('2026-11-06', 'Nikola', 'C', 3),
('2026-11-07', 'Nikola', 'C', 3),
('2026-11-08', 'Zai', 'C', 4),
('2026-11-09', 'Gabri', 'C', 0),
('2026-11-10', 'Mehdi', 'C', 1),
('2026-11-11', 'Mehdi', 'C', 1),
('2026-11-12', 'Zai', 'C', 4),
('2026-11-13', 'Gabri', 'C', 0),
('2026-11-14', 'Gabri', 'C', 0),
('2026-11-15', 'Gabri', 'C', 0),
('2026-11-16', 'Mehdi', 'C', 1),
('2026-11-17', 'Mehdi', 'C', 1),
('2026-11-18', 'Mehdi', 'C', 1),
('2026-11-19', 'Zai', 'C', 4),
('2026-11-20', 'Mehdi', 'C', 1),
('2026-11-21', 'Zai', 'C', 4),
('2026-11-22', 'Zai', 'C', 4),
('2026-11-23', 'Gabri', 'C', 0),
('2026-11-24', 'Gabri', 'C', 0),
('2026-11-25', 'Gabri', 'C', 0),
('2026-11-26', 'Zai', 'C', 4),
('2026-11-27', 'Nikola', 'C', 3),
('2026-11-28', 'Nikola', 'C', 3),
('2026-11-29', 'Zai', 'C', 4),
('2026-11-30', 'Nikola', 'C', 3),
('2026-11-01', 'Nikola', 'P', 3),
('2026-11-02', 'Nikola', 'P', 3),
('2026-11-03', 'Cristian', 'P', 2),
('2026-11-04', 'Zai', 'P', 4),
('2026-11-05', 'Zai', 'P', 4),
('2026-11-06', 'Zai', 'P', 4),
('2026-11-07', 'Zai', 'P', 4),
('2026-11-08', 'Nikola', 'P', 3),
('2026-11-09', 'Nikola', 'P', 3),
('2026-11-10', 'Nikola', 'P', 3),
('2026-11-11', 'Cristian', 'P', 2),
('2026-11-12', 'Cristian', 'P', 2),
('2026-11-13', 'Nikola', 'P', 3),
('2026-11-14', 'Nikola', 'P', 3),
('2026-11-15', 'Zai', 'P', 4),
('2026-11-16', 'Nikola', 'P', 3),
('2026-11-17', 'Nikola', 'P', 3),
('2026-11-18', 'Nikola', 'P', 3),
('2026-11-19', 'Nikola', 'P', 3),
('2026-11-20', 'Nikola', 'P', 3),
('2026-11-21', 'Nikola', 'P', 3),
('2026-11-22', 'Cristian', 'P', 2),
('2026-11-23', 'Cristian', 'P', 2),
('2026-11-24', 'Nikola', 'P', 3),
('2026-11-25', 'Nikola', 'P', 3),
('2026-11-26', 'Nikola', 'P', 3),
('2026-11-27', 'Gabri', 'P', 0),
('2026-11-28', 'Gabri', 'P', 0),
('2026-11-29', 'Gabri', 'P', 0),
('2026-11-30', 'Gabri', 'P', 0),
('2026-11-01', 'Zai', 'R', 4),
('2026-11-02', 'Zai', 'R', 4),
('2026-11-03', 'Zai', 'R', 4),
('2026-11-04', 'Nikola', 'R', 3),
('2026-11-05', 'Gabri', 'R', 0),
('2026-11-06', 'Gabri', 'R', 0),
('2026-11-07', 'Mehdi', 'R', 1),
('2026-11-08', 'Mehdi', 'R', 1),
('2026-11-09', 'Zai', 'R', 4),
('2026-11-10', 'Zai', 'R', 4),
('2026-11-11', 'Nikola', 'R', 3),
('2026-11-12', 'Gabri', 'R', 0),
('2026-11-13', 'Zai', 'R', 4),
('2026-11-14', 'Mehdi', 'R', 1),
('2026-11-15', 'Nikola', 'R', 3),
('2026-11-16', 'Zai', 'R', 4),
('2026-11-17', 'Zai', 'R', 4),
('2026-11-18', 'Zai', 'R', 4),
('2026-11-19', 'Gabri', 'R', 0),
('2026-11-20', 'Gabri', 'R', 0),
('2026-11-21', 'Mehdi', 'R', 1),
('2026-11-22', 'Nikola', 'R', 3),
('2026-11-23', 'Nikola', 'R', 3),
('2026-11-24', 'Zai', 'R', 4),
('2026-11-25', 'Zai', 'R', 4),
('2026-11-26', 'Gabri', 'R', 0),
('2026-11-27', 'Zai', 'R', 4),
('2026-11-28', 'Mehdi', 'R', 1),
('2026-11-29', 'Nikola', 'R', 3),
('2026-11-30', 'Zai', 'R', 4),
('2026-11-01', 'Cristian', 'R', 2),
('2026-11-02', 'Cristian', 'R', 2),
('2026-11-03', 'Nikola', 'R', 3),
('2026-11-04', 'Cristian', 'R', 2),
('2026-11-05', 'Cristian', 'R', 2),
('2026-11-06', 'Cristian', 'R', 2),
('2026-11-07', 'Cristian', 'R', 2),
('2026-11-08', 'Cristian', 'R', 2),
('2026-11-09', 'Cristian', 'R', 2),
('2026-11-10', 'Cristian', 'R', 2),
('2026-11-11', 'Zai', 'R', 4),
('2026-11-12', 'Nikola', 'R', 3),
('2026-11-13', 'Cristian', 'R', 2),
('2026-11-14', 'Cristian', 'R', 2),
('2026-11-15', 'Cristian', 'R', 2),
('2026-11-16', 'Cristian', 'R', 2),
('2026-11-17', 'Cristian', 'R', 2),
('2026-11-18', 'Cristian', 'R', 2),
('2026-11-19', 'Cristian', 'R', 2),
('2026-11-20', 'Cristian', 'R', 2),
('2026-11-21', 'Cristian', 'R', 2),
('2026-11-22', 'Mehdi', 'R', 1),
('2026-11-23', 'Zai', 'R', 4),
('2026-11-24', 'Cristian', 'R', 2),
('2026-11-25', 'Cristian', 'R', 2),
('2026-11-26', 'Cristian', 'R', 2),
('2026-11-27', 'Cristian', 'R', 2),
('2026-11-28', 'Cristian', 'R', 2),
('2026-11-29', 'Cristian', 'R', 2),
('2026-11-30', 'Cristian', 'R', 2),
('2026-12-01', 'Gabri', 'M', 0),
('2026-12-02', 'Gabri', 'M', 0),
('2026-12-03', 'Gabri', 'M', 0),
('2026-12-04', 'Mehdi', 'M', 1),
('2026-12-05', 'Gabri', 'M', 0),
('2026-12-06', 'Gabri', 'M', 0),
('2026-12-07', 'Gabri', 'M', 0),
('2026-12-08', 'Mehdi', 'M', 1),
('2026-12-09', 'Gabri', 'M', 0),
('2026-12-10', 'Gabri', 'M', 0),
('2026-12-11', 'Gabri', 'M', 0),
('2026-12-12', 'Gabri', 'M', 0),
('2026-12-13', 'Gabri', 'M', 0),
('2026-12-14', 'Mehdi', 'M', 1),
('2026-12-15', 'Mehdi', 'M', 1),
('2026-12-16', 'Gabri', 'M', 0),
('2026-12-17', 'Gabri', 'M', 0),
('2026-12-18', 'Gabri', 'M', 0),
('2026-12-19', 'Gabri', 'M', 0),
('2026-12-20', 'Gabri', 'M', 0),
('2026-12-21', 'Cristian', 'M', 2),
('2026-12-22', 'Mehdi', 'M', 1),
('2026-12-23', 'Mehdi', 'M', 1),
('2026-12-24', 'Mehdi', 'M', 1),
('2026-12-25', 'Mehdi', 'M', 1),
('2026-12-26', 'Mehdi', 'M', 1),
('2026-12-27', 'Mehdi', 'M', 1),
('2026-12-28', 'Mehdi', 'M', 1),
('2026-12-29', 'Nuova risorsa', 'M', 4),
('2026-12-30', 'Nuova risorsa', 'M', 4),
('2026-12-31', 'Mehdi', 'M', 1),
('2026-12-01', 'Mehdi', 'C', 1),
('2026-12-02', 'Mehdi', 'C', 1),
('2026-12-03', 'Mehdi', 'C', 1),
('2026-12-04', 'Cristian', 'C', 2),
('2026-12-05', 'Cristian', 'C', 2),
('2026-12-06', 'Cristian', 'C', 2),
('2026-12-07', 'Mehdi', 'C', 1),
('2026-12-08', 'Cristian', 'C', 2),
('2026-12-09', 'Mehdi', 'C', 1),
('2026-12-10', 'Mehdi', 'C', 1),
('2026-12-11', 'Mehdi', 'C', 1),
('2026-12-12', 'Cristian', 'C', 2),
('2026-12-13', 'Cristian', 'C', 2),
('2026-12-14', 'Cristian', 'C', 2),
('2026-12-15', 'Cristian', 'C', 2),
('2026-12-16', 'Mehdi', 'C', 1),
('2026-12-17', 'Mehdi', 'C', 1),
('2026-12-18', 'Mehdi', 'C', 1),
('2026-12-19', 'Mehdi', 'C', 1),
('2026-12-20', 'Cristian', 'C', 2),
('2026-12-21', 'Nuova risorsa', 'C', 4),
('2026-12-22', 'Cristian', 'C', 2),
('2026-12-22', 'Nuova risorsa', 'C', 4),
('2026-12-23', 'Nuova risorsa', 'C', 4),
('2026-12-24', 'Nuova risorsa', 'C', 4),
('2026-12-25', 'Nuova risorsa', 'C', 4),
('2026-12-26', 'Nuova risorsa', 'C', 4),
('2026-12-27', 'Cristian', 'C', 2),
('2026-12-28', 'Cristian', 'C', 2),
('2026-12-29', 'Cristian', 'C', 2),
('2026-12-30', 'Cristian', 'C', 2),
('2026-12-31', 'Nuova risorsa', 'C', 4),
('2026-12-01', 'Cristian', 'P', 2),
('2026-12-02', 'Nikola', 'P', 3),
('2026-12-03', 'Nikola', 'P', 3),
('2026-12-04', 'Nikola', 'P', 3),
('2026-12-05', 'Nikola', 'P', 3),
('2026-12-06', 'Nikola', 'P', 3),
('2026-12-07', 'Cristian', 'P', 2),
('2026-12-08', 'Nikola', 'P', 3),
('2026-12-09', 'Cristian', 'P', 2),
('2026-12-10', 'Nikola', 'P', 3),
('2026-12-11', 'Nikola', 'P', 3),
('2026-12-12', 'Nikola', 'P', 3),
('2026-12-13', 'Nikola', 'P', 3),
('2026-12-14', 'Nikola', 'P', 3),
('2026-12-15', 'Nikola', 'P', 3),
('2026-12-16', 'Cristian', 'P', 2),
('2026-12-17', 'Cristian', 'P', 2),
('2026-12-18', 'Nikola', 'P', 3),
('2026-12-19', 'Nikola', 'P', 3),
('2026-12-20', 'Nikola', 'P', 3),
('2026-12-21', 'Nikola', 'P', 3),
('2026-12-22', 'Nikola', 'P', 3),
('2026-12-23', 'Cristian', 'P', 2),
('2026-12-24', 'Nikola', 'P', 3),
('2026-12-25', 'Cristian', 'P', 2),
('2026-12-26', 'Cristian', 'P', 2),
('2026-12-27', 'Nikola', 'P', 3),
('2026-12-28', 'Nikola', 'P', 3),
('2026-12-29', 'Nikola', 'P', 3),
('2026-12-30', 'Nikola', 'P', 3),
('2026-12-31', 'Nikola', 'P', 3),
('2026-12-01', 'Nikola', 'R', 3),
('2026-12-02', 'Cristian', 'R', 2),
('2026-12-03', 'Cristian', 'R', 2),
('2026-12-04', 'Gabri', 'R', 0),
('2026-12-05', 'Mehdi', 'R', 1),
('2026-12-06', 'Mehdi', 'R', 1),
('2026-12-07', 'Nikola', 'R', 3),
('2026-12-08', 'Gabri', 'R', 0),
('2026-12-09', 'Nikola', 'R', 3),
('2026-12-10', 'Cristian', 'R', 2),
('2026-12-11', 'Cristian', 'R', 2),
('2026-12-12', 'Mehdi', 'R', 1),
('2026-12-13', 'Mehdi', 'R', 1),
('2026-12-14', 'Gabri', 'R', 0),
('2026-12-15', 'Gabri', 'R', 0),
('2026-12-16', 'Nikola', 'R', 3),
('2026-12-17', 'Nikola', 'R', 3),
('2026-12-18', 'Cristian', 'R', 2),
('2026-12-19', 'Cristian', 'R', 2),
('2026-12-20', 'Mehdi', 'R', 1),
('2026-12-21', 'Mehdi', 'R', 1),
('2026-12-23', 'Nikola', 'R', 3),
('2026-12-24', 'Cristian', 'R', 2),
('2026-12-25', 'Nikola', 'R', 3),
('2026-12-26', 'Nikola', 'R', 3),
('2026-12-27', 'Nuova risorsa', 'R', 4),
('2026-12-28', 'Nuova risorsa', 'R', 4),
('2026-12-29', 'Mehdi', 'R', 1),
('2026-12-30', 'Mehdi', 'R', 1),
('2026-12-31', 'Cristian', 'R', 2),
('2027-01-01', 'Nuova risorsa', 'M', 3),
('2027-01-01', 'Cristian', 'C', 1),
('2027-01-01', 'Nikola', 'P', 2),
('2027-01-01', 'Mehdi', 'R', 0)
) as r(day, person, shift, sort)
where date_trunc('month', r.day::date)::date in (select month from ins);

-- link the imported people to the waiters with the same name (if they have a PIN in the app)
update public.staff_shifts s set waiter_id = w.id
from public.waiters w
where s.waiter_id is null and lower(w.name) = lower(s.person);
update public.staff_months m set people = (
  select jsonb_agg(case when w.id is null then p else p || jsonb_build_object('waiter_id', w.id) end order by ord)
  from jsonb_array_elements(m.people) with ordinality as e(p, ord)
  left join public.waiters w on lower(w.name) = lower(p->>'name')
) where m.updated_by = 'import from app (schedule.js)' and jsonb_array_length(m.people) > 0;
