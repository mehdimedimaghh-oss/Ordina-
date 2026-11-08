-- =====================================================================
--  Comande Pranzo · rooftop tables + movable chairs
--  Paste this whole file in Supabase → SQL Editor → Run (one time).
--
--  * rooftop_tables: the 10 physical tables (T1–T10), which app table number (1–30)
--    each one is, and if it is ACTIVE or CLOSED (set by the owner in Menu & prices).
--  * rooftop_chairs: where every physical chair is. One row per place (T1–T10 + storage).
--    A chair is always in exactly one place, so it can never be counted twice.
--    Moving chairs is one atomic step: the total (31) never changes by itself.
--  The guests field (OSPITI / "covers") is NOT duplicated: it stays on open tables and orders.
-- =====================================================================

create table if not exists public.rooftop_tables (
  id        text primary key,
  sort      int not null,
  app_table int unique check (app_table between 1 and 30),
  active    boolean not null default true,
  bench_seats int not null default 0 check (bench_seats between 0 and 10),   -- fixed bench seats (T8, T9)
  updated_at timestamptz not null default now()
);

create table if not exists public.rooftop_chairs (
  location   text primary key,            -- 'T1'…'T10' or 'storage'
  chairs     int not null check (chairs >= 0),
  updated_at timestamptz not null default now()
);

insert into public.rooftop_tables(id, sort) values
  ('T1', 1), ('T2', 2), ('T3', 3), ('T4', 4), ('T5', 5), ('T6', 6), ('T7', 7), ('T8', 8), ('T9', 9), ('T10', 10)
on conflict do nothing;
update public.rooftop_tables set bench_seats = 2 where id in ('T8', 'T9');

-- Starting position: 26 chairs on the rooftop + 5 in storage = 31. The owner can correct it in Menu & prices.
insert into public.rooftop_chairs(location, chairs) values
  ('T1', 2), ('T2', 2), ('T3', 2), ('T4', 2), ('T5', 2), ('T6', 4), ('T7', 4), ('T8', 2), ('T9', 2), ('T10', 4), ('storage', 5)
on conflict do nothing;

alter table public.rooftop_tables enable row level security;
alter table public.rooftop_chairs enable row level security;
revoke all on public.rooftop_tables, public.rooftop_chairs from anon;
drop policy if exists "staff reads rooftop tables" on public.rooftop_tables;
create policy "staff reads rooftop tables" on public.rooftop_tables for select to authenticated using (public.is_staff());
drop policy if exists "staff reads chairs" on public.rooftop_chairs;
create policy "staff reads chairs"         on public.rooftop_chairs for select to authenticated using (public.is_staff());

-- Waiters (and the owner) move chairs: from a table or storage, to a table or storage.
create or replace function public.chairs_move(p_from text, p_to text, p_n int, p_token uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.waiters; v_left int;
begin
  perform public.require_staff();
  if p_n is null or p_n < 1 or p_n > 31 then raise exception 'Number of chairs must be 1 or more'; end if;
  if p_from = p_to then raise exception 'Choose two different places'; end if;
  if not exists (select 1 from public.rooftop_chairs where location = p_to) then raise exception 'Unknown place %', p_to; end if;
  -- lock both rows in a fixed order (no deadlock when two waiters move at the same time)
  perform 1 from public.rooftop_chairs where location in (p_from, p_to) order by location for update;
  update public.rooftop_chairs set chairs = chairs - p_n, updated_at = now()
    where location = p_from and chairs >= p_n returning chairs into v_left;
  if v_left is null then
    raise exception 'Not enough chairs at % (there are %)', p_from, coalesce((select chairs from public.rooftop_chairs where location = p_from), 0);
  end if;
  update public.rooftop_chairs set chairs = chairs + p_n, updated_at = now() where location = p_to;
  w := public.waiter_of(p_token);
  perform public.audit('chairs_move', 'chairs', p_from || '→' || p_to, jsonb_build_object('from', p_from, 'to', p_to, 'n', p_n), w.name);
  return (select jsonb_object_agg(location, chairs) from public.rooftop_chairs);
end $$;

-- Owner: correct the whole inventory (e.g. after counting, or when chairs are bought / broken)
create or replace function public.owner_set_chairs(p_counts jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k text; v jsonb; before jsonb;
begin
  perform public.require_owner();
  select jsonb_object_agg(location, chairs) into before from public.rooftop_chairs;
  for k, v in select * from jsonb_each(p_counts) loop
    if not exists (select 1 from public.rooftop_chairs where location = k) then raise exception 'Unknown place %', k; end if;
    if (v #>> '{}')::int < 0 then raise exception 'Chairs cannot be negative'; end if;
    update public.rooftop_chairs set chairs = (v #>> '{}')::int, updated_at = now() where location = k;
  end loop;
  perform public.audit('chairs_set', 'chairs', null, jsonb_build_object('before', before, 'after', (select jsonb_object_agg(location, chairs) from public.rooftop_chairs)));
  return (select jsonb_object_agg(location, chairs) from public.rooftop_chairs);
end $$;

-- Owner: link a physical table to its app number, and mark it ACTIVE / CLOSED
create or replace function public.owner_set_rooftop_table(p_id text, p_app int, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_owner();
  if p_app is not null and exists (select 1 from public.rooftop_tables where app_table = p_app and id <> p_id) then
    raise exception 'App table % is already linked to %', p_app, (select id from public.rooftop_tables where app_table = p_app);
  end if;
  update public.rooftop_tables set app_table = p_app, active = coalesce(p_active, active), updated_at = now() where id = p_id;
  if not found then raise exception 'Unknown table %', p_id; end if;
  perform public.audit('rooftop_table', 'rooftop_table', p_id, jsonb_build_object('app_table', p_app, 'active', p_active));
end $$;

revoke execute on function public.chairs_move(text, text, int, uuid), public.owner_set_chairs(jsonb), public.owner_set_rooftop_table(text, int, boolean) from public, anon;
grant execute on function public.chairs_move(text, text, int, uuid), public.owner_set_chairs(jsonb), public.owner_set_rooftop_table(text, int, boolean) to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.rooftop_tables, public.rooftop_chairs;
    exception when duplicate_object then null;   -- already live (the file was run before)
    end;
  end if;
end $$;
