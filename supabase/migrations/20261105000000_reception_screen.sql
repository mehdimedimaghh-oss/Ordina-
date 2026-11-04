-- =====================================================================
--  Comande Pranzo · Reception screen: mark orders as "charged"
--  Paste this whole file in Supabase → SQL Editor → Run (one time).
-- =====================================================================

alter table public.orders add column if not exists charged_at timestamptz;
alter table public.orders add column if not exists charged_by text;

-- Reception ticks "Charged ✓" (or removes it). Staff: today's orders only. Owner: any order.
create or replace function public.mark_charged(p_id bigint, p_charged boolean, p_by text default 'Reception')
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  perform public.require_staff();
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'Order not found'; end if;
  if not public.is_owner() and o.day <> public.rome_today() then raise exception 'Only orders of today'; end if;
  if p_charged and o.status <> 'closed' then raise exception 'This order was reopened: wait for the new one'; end if;
  update public.orders set
    charged_at = case when p_charged then coalesce(charged_at, now()) else null end,
    charged_by = case when p_charged then coalesce(nullif(trim(p_by), ''), 'Reception') else null end
  where id = p_id returning * into o;
  perform public.audit(case when p_charged then 'order_charged' else 'order_uncharged' end, 'order', o.id::text,
    jsonb_build_object('table', o.table_no, 'total', o.total, 'day', o.day), coalesce(nullif(trim(p_by), ''), 'Reception'));
  return jsonb_build_object('ok', true, 'charged_at', o.charged_at);
end $$;

revoke execute on function public.mark_charged(bigint, boolean, text) from public, anon;
grant execute on function public.mark_charged(bigint, boolean, text) to authenticated;
