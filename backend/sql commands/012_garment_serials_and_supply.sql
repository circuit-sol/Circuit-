-- Run after 009. Atomic backfill: blocks order writes during migration.
begin;
lock table public.chain_orders in share row exclusive mode;
alter table public.chain_orders add column garment_serial bigint;
create table public.edition_serial_counters (
 edition_id text primary key references public.editions(id),
 last_serial bigint not null default 0 check(last_serial>=0)
);
create table public.chain_garments (
 order_id uuid not null references public.chain_orders(id),
 unit_index integer not null check(unit_index>0),
 edition_id text not null references public.editions(id),
 garment_serial bigint not null check(garment_serial>0),
 primary key(order_id,unit_index), unique(edition_id,garment_serial)
);
alter table public.edition_serial_counters enable row level security;
alter table public.chain_garments enable row level security;
revoke all on public.edition_serial_counters,public.chain_garments from public,anon,authenticated;
grant select on public.chain_garments,public.edition_serial_counters to service_role;
create function public.circuit_allocate_garments(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare o public.chain_orders%rowtype; e text; last_n bigint;
begin
 select * into strict o from public.chain_orders where id=p_id for update;
 if o.garment_serial is not null then return; end if;
 select edition_id into strict e from public.batches where id=o.batch_id;
 insert into public.edition_serial_counters(edition_id) values(e) on conflict do nothing;
 update public.edition_serial_counters set last_serial=last_serial+o.quantity
 where edition_id=e returning last_serial into last_n;
 insert into public.chain_garments(order_id,unit_index,edition_id,garment_serial)
 select o.id,n,e,last_n-o.quantity+n from generate_series(1,o.quantity) n;
 update public.chain_orders set garment_serial=last_n-o.quantity+1 where id=o.id;
end $$;
-- Chronological backfill, deterministic tie-breaker; includes cancelled orders.
do $$ declare r record; begin
 for r in select id from public.chain_orders order by purchased_at,created_at,id loop
  perform public.circuit_allocate_garments(r.id);
 end loop;
end $$;
create function public.circuit_allocate_order_garments() returns trigger
language plpgsql security definer set search_path='' as $$
begin perform public.circuit_allocate_garments(new.id); return new; end $$;
create trigger allocate_order_garments after insert on public.chain_orders
 for each row execute function public.circuit_allocate_order_garments();
-- INSERT ON CONFLICT in record_chain_order fires this only for a new purchase.
-- Its updates (cancellation, refund, re-confirmation) never allocate new serials.
create function public.circuit_guard_order_serials() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.batch_id is distinct from old.batch_id or new.quantity is distinct from old.quantity
 or (old.garment_serial is not null and new.garment_serial is distinct from old.garment_serial) then
  raise exception 'ORDER_SERIAL_IDENTITY_IMMUTABLE';
 end if;
 return new;
end $$;
create trigger guard_order_serials before update on public.chain_orders
 for each row execute function public.circuit_guard_order_serials();
create function public.circuit_batch_stats(p_batch_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with target as (
  select b.id,b.edition_id,e.max_supply from public.batches b
  join public.editions e on e.id=b.edition_id
  where b.id=p_batch_id and b.is_active and b.chain_status='initialized' and e.published
 ), scoped as (
  select 'batch' as scope,o.* from public.chain_orders o join target t on o.batch_id=t.id
  union all
  select 'edition' as scope,o.* from public.chain_orders o join public.batches b on b.id=o.batch_id
  join target t on t.edition_id=b.edition_id
 ), totals as (
  select s.scope, sum(quantity) as purchased,
   sum(case when cancelled then quantity else 0 end) as cancelled,
   sum(case when not cancelled then quantity else 0 end) as claimed,
   sum(case when not cancelled and refunded_lamports>=amount_lamports then quantity else 0 end) as fully_refunded,
   max(purchased_at) as last_purchase
  from scoped s group by s.scope
 )
 select jsonb_build_object('batch_id',t.id,'edition_id',t.edition_id,
  'source','verified_database_orders','as_of',statement_timestamp(),
  'max_supply',t.max_supply,'supply_scope','edition','supply_enforced',false,
  'batch',jsonb_build_object('purchased_units',coalesce(b.purchased,0),'cancelled_units',coalesce(b.cancelled,0),
    'claimed_units',coalesce(b.claimed,0),'fully_refunded_units',coalesce(b.fully_refunded,0)),
  'edition',jsonb_build_object('purchased_units',coalesce(e.purchased,0),'cancelled_units',coalesce(e.cancelled,0),
    'claimed_units',coalesce(e.claimed,0),'fully_refunded_units',coalesce(e.fully_refunded,0)),
  'last_recorded_purchase_at',e.last_purchase)
 from target t left join totals b on b.scope='batch' left join totals e on e.scope='edition';
$$;
revoke all on function public.circuit_allocate_garments(uuid),public.circuit_allocate_order_garments(),
 public.circuit_guard_order_serials(),public.circuit_batch_stats(uuid) from public,anon,authenticated;
grant execute on function public.circuit_batch_stats(uuid) to service_role;
notify pgrst,'reload schema';
commit;
