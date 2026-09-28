create table public.wallet_auth_challenges (
  id uuid primary key,
  wallet_address text not null,
  message text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

alter table public.wallet_auth_challenges enable row level security;

revoke all on public.wallet_auth_challenges from anon, authenticated;
grant select, insert, update, delete
  on public.wallet_auth_challenges to service_role;

create index wallet_auth_challenges_expiry_idx
  on public.wallet_auth_challenges (expires_at);