begin;

create table public.editions (
  -- Keep the existing text-based drop ID format.
  id text primary key
    check (
      id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      and octet_length(id) <= 32
    ),

  brand_id uuid not null references public.brands(id),
  created_by uuid not null references public.users(id),

  name text not null
    check (char_length(trim(name)) between 1 and 120),
  description text not null default '',

  image_url text not null default '/satin.png',
  images jsonb not null default '[]'::jsonb
    check (jsonb_typeof(images) = 'array'),

  price_usd numeric(12, 2) not null
    check (price_usd > 0),
  has_variable_prices boolean not null default false,
  prices_by_size jsonb not null default '{}'::jsonb
    check (jsonb_typeof(prices_by_size) = 'object'),

  max_supply integer not null check (max_supply > 0),

  fabric text not null default '',
  headpiece text not null default '',
  embroidery text not null default '',

  starts_at timestamptz,
  ends_at timestamptz,

  -- New drops start unpublished.
  is_active boolean not null default false,
  chain_status text not null default 'pending'
    check (chain_status in ('pending', 'initialized', 'failed')),
  chain_drop_address text,
  initialization_tx_signature text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint editions_valid_dates check (
    starts_at is null
    or ends_at is null
    or ends_at > starts_at
  ),

  constraint editions_initialized_details check (
    chain_status <> 'initialized'
    or (
      nullif(trim(chain_drop_address), '') is not null
      and nullif(trim(initialization_tx_signature), '') is not null
    )
  ),

  constraint editions_active_requires_chain check (
    not is_active or chain_status = 'initialized'
  )
);

create index editions_brand_id_idx
  on public.editions(brand_id);

alter table public.editions enable row level security;

-- Keep writes disabled until the protected routes are ready.
revoke all on table public.editions
  from public, anon, authenticated, service_role;

grant select on table public.editions to service_role;

commit;