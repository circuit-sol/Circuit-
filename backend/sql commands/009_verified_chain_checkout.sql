begin;

-- New tables isolate verified chain orders from legacy client-written orders.
alter table public.batches add column chain_terms jsonb;
alter table public.batches add column chain_vault_address text;
alter table public.editions add column published boolean not null default false;

create table public.chain_intents (
  id uuid primary key,
  user_id uuid not null references public.users(id),
  wallet_address text not null,
  batch_id uuid not null references public.batches(id),
  kind text not null check (kind in ('initialize','purchase','cancel','advance','balance','freeze','unfreeze','refund','seller_payment','redirect','topup')),
  order_id uuid,
  message_base64 text not null,
  transaction_base64 text not null,
  last_valid_block_height bigint not null,
  expected jsonb not null,
  signature text unique,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index chain_intents_user_idx on public.chain_intents(user_id, created_at desc);
create index chain_intents_batch_idx on public.chain_intents(batch_id);

create table public.chain_orders (
  id uuid primary key,
  batch_id uuid not null references public.batches(id),
  user_id uuid not null references public.users(id),
  buyer_wallet text not null,
  order_address text not null unique,
  vault_address text not null,
  pickup_location_id uuid not null,
  size text,
  quantity integer not null check(quantity between 1 and 100),
  amount_lamports numeric(20,0) not null check(amount_lamports > 0),
  purchase_signature text not null unique,
  purchased_at timestamptz not null,
  cancel_until timestamptz not null,
  cancelled boolean not null default false,
  refunded_lamports numeric(20,0) not null default 0,
  receipt_slot bigint not null default 0,
  collected_at timestamptz,
  created_at timestamptz not null default now()
);
create index chain_orders_buyer_idx on public.chain_orders(user_id, created_at desc);
create index chain_orders_batch_idx on public.chain_orders(batch_id, created_at desc);
create table public.chain_reports (
  order_id uuid primary key references public.chain_orders(id),
  user_id uuid not null references public.users(id),
  message text not null check(char_length(message) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.chain_intents enable row level security;
alter table public.chain_orders enable row level security;
alter table public.chain_reports enable row level security;
revoke all on public.chain_intents, public.chain_orders, public.chain_reports from public, anon, authenticated;
grant select, insert, update on public.chain_intents, public.chain_reports to service_role;
grant select, update(collected_at) on public.chain_orders to service_role;
-- Retire direct client access to the old table too, if present. No old rows deleted.
do $$ begin
  if to_regclass('public.orders') is not null then
    execute 'alter table public.orders enable row level security';
    execute 'revoke all on public.orders from public, anon, authenticated';
  end if;
end $$;

-- One order UUID binds one buyer, batch and quote, including concurrent prepares.
create table public.chain_order_quotes (
  id uuid primary key, user_id uuid not null references public.users(id),
  wallet_address text not null, batch_id uuid not null references public.batches(id),
  choice jsonb not null
);
alter table public.chain_order_quotes enable row level security;
revoke all on public.chain_order_quotes from public,anon,authenticated;
grant select on public.chain_order_quotes to service_role;
create function public.reserve_chain_order(p_order_id uuid,p_user_id uuid,p_wallet text,p_batch_id uuid,p_choice jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare q public.chain_order_quotes%rowtype;
begin
  perform 1 from public.users where id=p_user_id and wallet_address=p_wallet for share;
  if not found then raise exception 'INVALID_OR_EXPIRED_SESSION'; end if;
  insert into public.chain_order_quotes values(p_order_id,p_user_id,p_wallet,p_batch_id,p_choice)
    on conflict(id) do nothing;
  select * into q from public.chain_order_quotes where id=p_order_id for update;
  if q.user_id<>p_user_id or q.wallet_address<>p_wallet or q.batch_id<>p_batch_id or q.choice<>p_choice then
    raise exception 'ORDER_ID_ALREADY_USED'; end if;
end $$;
revoke all on function public.reserve_chain_order(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_chain_order(uuid,uuid,text,uuid,jsonb) to service_role;

-- Locks draft terms before any operational signature is issued. Concurrent edits
-- serialize on this row. Repeated preparations reuse the same immutable terms.
create function public.reserve_chain_batch(p_user_id uuid, p_wallet text,
  p_batch_id uuid, p_revision integer, p_pricing jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.batches%rowtype; e public.editions%rowtype; recipient text;
begin
  perform 1 from public.users where id=p_user_id and wallet_address=p_wallet for share;
  if not found then raise exception 'INVALID_OR_EXPIRED_SESSION'; end if;
  select * into b from public.batches where id=p_batch_id for update;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  select * into e from public.editions where id=b.edition_id for share;
  perform 1 from public.brand_memberships where user_id=p_user_id and brand_id=e.brand_id
    and role in ('owner','editor') for share;
  if not found then raise exception 'BRAND_ACCESS_DENIED'; end if;
  if b.revision <> p_revision then raise exception 'BATCH_REVISION_CONFLICT'; end if;
  if b.chain_status='initialized' then raise exception 'BATCH_ALREADY_INITIALIZED'; end if;
  if b.chain_terms is not null then
    if b.chain_terms->>'seller_wallet' <> p_wallet or b.chain_terms->'pricing' <> p_pricing then
      raise exception 'INITIALIZATION_TERMS_LOCKED';
    end if;
    return to_jsonb(b);
  end if;
  if b.opens_at <= clock_timestamp() + interval '30 seconds' then
    raise exception 'BATCH_OPENING_TOO_SOON';
  end if;
  if date_trunc('second',b.opens_at) <> b.opens_at or date_trunc('second',b.closes_at) <> b.closes_at
    or date_trunc('second',b.production_starts_at) <> b.production_starts_at
    or date_trunc('second',b.release_at) <> b.release_at then raise exception 'WHOLE_SECOND_DATES_REQUIRED'; end if;
  select payment_wallet_address into recipient from public.brands where id=e.brand_id for share;
  update public.batches set chain_status='initializing', updated_at=now(),
    chain_terms=jsonb_build_object('brand_id',e.brand_id,'seller_wallet',p_wallet,
      'payment_wallet',recipient,'pricing',p_pricing)
    where id=p_batch_id returning * into b;
  return to_jsonb(b);
end $$;

-- Called only after exact transaction-message and finalized account verification.
create function public.confirm_chain_batch(p_batch_id uuid, p_batch_address text,
  p_vault_address text, p_signature text, p_revision integer)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.batches%rowtype;
begin
  select * into b from public.batches where id=p_batch_id for update;
  if b.id is null or b.chain_terms is null or b.revision <> p_revision then
    raise exception 'BATCH_REVISION_CONFLICT'; end if;
  if b.chain_status='initialized' then
    if b.chain_batch_address <> p_batch_address or b.chain_vault_address <> p_vault_address then
      raise exception 'CHAIN_ADDRESS_CONFLICT'; end if;
    return;
  end if;
  update public.batches set chain_status='initialized', is_active=true,
    chain_batch_address=p_batch_address, chain_vault_address=p_vault_address,
    initialization_tx_signature=p_signature, updated_at=now() where id=p_batch_id;
  -- Edition is off-chain metadata. Do not fabricate a legacy chain_drop_address.
  update public.editions set published=true, updated_at=now() where id=b.edition_id;
end $$;

-- Serialize receipt refreshes so an older read cannot undo a refund/cancellation.
create function public.record_chain_order(p_order jsonb, p_slot bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.chain_orders(id,batch_id,user_id,buyer_wallet,order_address,vault_address,
    pickup_location_id,size,quantity,amount_lamports,purchase_signature,purchased_at,cancel_until,
    cancelled,refunded_lamports,receipt_slot)
  values((p_order->>'id')::uuid,(p_order->>'batch_id')::uuid,(p_order->>'user_id')::uuid,
    p_order->>'buyer_wallet',p_order->>'order_address',p_order->>'vault_address',
    (p_order->>'pickup_location_id')::uuid,p_order->>'size',(p_order->>'quantity')::integer,
    (p_order->>'amount_lamports')::numeric,p_order->>'purchase_signature',
    (p_order->>'purchased_at')::timestamptz,(p_order->>'cancel_until')::timestamptz,
    (p_order->>'cancelled')::boolean,(p_order->>'refunded_lamports')::numeric,p_slot)
  on conflict(id) do update set cancelled=excluded.cancelled,
    refunded_lamports=excluded.refunded_lamports, receipt_slot=excluded.receipt_slot
  where public.chain_orders.receipt_slot <= excluded.receipt_slot;
end $$;

-- Published products/locked batches cannot be edited via the old draft RPC.
create function public.guard_chain_edition() returns trigger language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.batches where edition_id=old.id and chain_status in ('initializing','initialized'))
    and (to_jsonb(new) - array['published','updated_at']) is distinct from
        (to_jsonb(old) - array['published','updated_at']) then
    raise exception 'EDITION_NOT_EDITABLE';
  end if;
  return new;
end $$;
create trigger guard_chain_edition before update on public.editions
  for each row execute function public.guard_chain_edition();

revoke all on function public.reserve_chain_batch(uuid,text,uuid,integer,jsonb),
 public.confirm_chain_batch(uuid,text,text,text,integer),public.record_chain_order(jsonb,bigint),
 public.guard_chain_edition() from public,anon,authenticated;
grant execute on function public.reserve_chain_batch(uuid,text,uuid,integer,jsonb),
 public.confirm_chain_batch(uuid,text,text,text,integer),public.record_chain_order(jsonb,bigint) to service_role;
commit;
