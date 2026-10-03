begin;

-- Draft configuration only. A later verified Anchor integration owns activation.
create table public.batches (
  id uuid primary key default gen_random_uuid(),
  edition_id text not null references public.editions(id),
  created_by uuid not null references public.users(id),
  name text not null check (char_length(trim(name)) between 1 and 120),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  production_starts_at timestamptz not null,
  release_at timestamptz not null,
  pickup_locations jsonb not null,
  chain_status text not null default 'pending'
    check (chain_status in ('pending', 'initializing', 'initialized', 'failed')),
  chain_batch_address text,
  initialization_tx_signature text,
  is_active boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (isfinite(opens_at) and isfinite(closes_at)
    and isfinite(production_starts_at) and isfinite(release_at)),
  check (closes_at > opens_at),
  check (production_starts_at >= closes_at + interval '48 hours'),
  check (release_at > production_starts_at),
  check (jsonb_typeof(pickup_locations) = 'array'
    and jsonb_array_length(pickup_locations) between 1 and 20),
  check (chain_status <> 'initialized' or (
    nullif(trim(chain_batch_address), '') is not null
    and nullif(trim(initialization_tx_signature), '') is not null)),
  check (not is_active or chain_status = 'initialized')
);

create index batches_edition_created_idx on public.batches(edition_id, created_at desc);
alter table public.batches enable row level security;
revoke all on public.batches from public, anon, authenticated, service_role;
grant select on public.batches to service_role;

-- Writes run through this function, including a current-wallet and brand check.
-- Location IDs are generated here; locations are replaced as a complete list
-- on draft edits. Once initialization starts, this endpoint cannot edit terms.
create function public.save_batch_draft(
  p_user_id uuid,
  p_wallet_address text,
  p_batch_id uuid,
  p_changes jsonb,
  p_expected_revision integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.batches%rowtype;
  edition public.editions%rowtype;
  field_name text;
  field_value jsonb;
  location jsonb;
  locations jsonb := '[]'::jsonb;
  parsed_date timestamptz;
begin
  -- Held through the write so concurrent identity/membership changes serialize.
  perform 1 from public.users u
    where u.id = p_user_id and u.wallet_address = p_wallet_address for share;
  if not found then raise exception 'INVALID_OR_EXPIRED_SESSION'; end if;

  if p_changes is null or jsonb_typeof(p_changes) <> 'object'
    or p_changes = '{}'::jsonb then
    raise exception 'INVALID_BATCH_CHANGES';
  end if;

  for field_name, field_value in select key, value from jsonb_each(p_changes) loop
    if field_name not in ('edition_id', 'name', 'opens_at', 'closes_at',
      'production_starts_at', 'release_at', 'pickup_locations')
      or (p_batch_id is not null and field_name = 'edition_id') then
      raise exception 'UNSUPPORTED_FIELDS';
    end if;
    if field_name <> 'pickup_locations' and jsonb_typeof(field_value) <> 'string' then
      raise exception 'INVALID_BATCH_CHANGES';
    end if;
  end loop;

  if p_batch_id is null then
    if not (p_changes ?& array['edition_id', 'name', 'opens_at', 'closes_at',
      'production_starts_at', 'release_at', 'pickup_locations']) then
      raise exception 'MISSING_BATCH_FIELDS';
    end if;
    batch.edition_id := p_changes ->> 'edition_id';
  else
    select b.* into batch from public.batches b where b.id = p_batch_id for update;
    if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  end if;

  select e.* into edition from public.editions e where e.id = batch.edition_id for share;
  if not found then raise exception 'EDITION_NOT_FOUND'; end if;
  perform 1 from public.brand_memberships m
    where m.brand_id = edition.brand_id and m.user_id = p_user_id
      and m.role in ('owner', 'editor') for share;
  if not found then raise exception 'BRAND_ACCESS_DENIED'; end if;

  if p_batch_id is not null then
    if batch.is_active or batch.chain_status not in ('pending', 'failed')
      or batch.chain_batch_address is not null
      or batch.initialization_tx_signature is not null then
      raise exception 'BATCH_NOT_EDITABLE';
    end if;
    if p_expected_revision is null or batch.revision <> p_expected_revision then
      raise exception 'BATCH_REVISION_CONFLICT';
    end if;
  end if;

  if p_changes ? 'name' then
    batch.name := trim(p_changes ->> 'name');
    if char_length(batch.name) not between 1 and 120 then
      raise exception 'INVALID_BATCH_NAME';
    end if;
  end if;

  foreach field_name in array array['opens_at', 'closes_at', 'production_starts_at', 'release_at'] loop
    if p_changes ? field_name then
      -- Require an explicit UTC timestamp, rejecting locale-dependent date input.
      if (p_changes ->> field_name) !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$' then
        raise exception 'INVALID_BATCH_DATE';
      end if;
      begin
        parsed_date := (p_changes ->> field_name)::timestamptz;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception 'INVALID_BATCH_DATE';
      end;
      case field_name
        when 'opens_at' then batch.opens_at := parsed_date;
        when 'closes_at' then batch.closes_at := parsed_date;
        when 'production_starts_at' then batch.production_starts_at := parsed_date;
        when 'release_at' then batch.release_at := parsed_date;
      end case;
    end if;
  end loop;
  if batch.closes_at <= batch.opens_at
    or batch.production_starts_at < batch.closes_at + interval '48 hours'
    or batch.release_at <= batch.production_starts_at then
    raise exception 'INVALID_BATCH_SCHEDULE';
  end if;
  if batch.opens_at <= clock_timestamp() then
    raise exception 'BATCH_OPENING_MUST_BE_FUTURE';
  end if;

  if p_changes ? 'pickup_locations' then
    if jsonb_typeof(p_changes -> 'pickup_locations') <> 'array' then
      raise exception 'INVALID_PICKUP_LOCATIONS';
    end if;
    if jsonb_array_length(p_changes -> 'pickup_locations') not between 1 and 20 then
      raise exception 'INVALID_PICKUP_LOCATIONS';
    end if;
    for location in select value from jsonb_array_elements(p_changes -> 'pickup_locations') loop
      if jsonb_typeof(location) <> 'object' then raise exception 'INVALID_PICKUP_LOCATIONS'; end if;
      if not (location ?& array['name', 'address'])
        or (location - array['name', 'address', 'instructions']) <> '{}'::jsonb
        or jsonb_typeof(location -> 'name') <> 'string'
        or jsonb_typeof(location -> 'address') <> 'string'
        or char_length(trim(location ->> 'name')) not between 1 and 120
        or char_length(trim(location ->> 'address')) not between 1 and 1000
        or (location ? 'instructions' and (
          jsonb_typeof(location -> 'instructions') <> 'string'
          or char_length(location ->> 'instructions') > 2000)) then
        raise exception 'INVALID_PICKUP_LOCATIONS';
      end if;
      locations := locations || jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid(), 'name', trim(location ->> 'name'),
        'address', trim(location ->> 'address'),
        'instructions', trim(coalesce(location ->> 'instructions', ''))
      ));
    end loop;
    batch.pickup_locations := locations;
  end if;

  if p_batch_id is null then
    insert into public.batches (edition_id, created_by, name, opens_at, closes_at,
      production_starts_at, release_at, pickup_locations)
    values (batch.edition_id, p_user_id, batch.name, batch.opens_at, batch.closes_at,
      batch.production_starts_at, batch.release_at, batch.pickup_locations)
    returning * into batch;
  else
    update public.batches b set name = batch.name, opens_at = batch.opens_at,
      closes_at = batch.closes_at, production_starts_at = batch.production_starts_at,
      release_at = batch.release_at, pickup_locations = batch.pickup_locations,
      revision = b.revision + 1, updated_at = clock_timestamp()
    where b.id = p_batch_id returning b.* into batch;
  end if;
  return to_jsonb(batch);
end;
$$;

revoke all on function public.save_batch_draft(uuid, text, uuid, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.save_batch_draft(uuid, text, uuid, jsonb, integer)
  to service_role;

commit;
