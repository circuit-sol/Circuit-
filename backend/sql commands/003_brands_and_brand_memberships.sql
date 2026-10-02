create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null
    check (char_length(trim(name)) between 1 and 120),
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  payment_wallet_address text not null
    check (char_length(trim(payment_wallet_address)) > 0),
  created_at timestamptz not null default now()
);

create table public.brand_memberships (
  brand_id uuid not null
    references public.brands(id),
  user_id uuid not null
    references public.users(id),
  role text not null default 'editor'
    check (role in ('owner', 'editor')),
  created_at timestamptz not null default now(),

  primary key (brand_id, user_id)
);

create index brand_memberships_user_id_idx
  on public.brand_memberships(user_id);

-- Access goes through our backend.
alter table public.brands enable row level security;
alter table public.brand_memberships enable row level security;

revoke all on table public.brands
  from public, anon, authenticated;

revoke all on table public.brand_memberships
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.brands, public.brand_memberships
  to service_role;

commit;