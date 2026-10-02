begin;

create function public.update_edition_draft(
  p_edition_id text,
  p_user_id uuid,
  p_wallet_address text,
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  edition public.editions%rowtype;
  field_name text;
  field_value jsonb;
begin
  if not exists (
    select 1
    from public.users u
    where u.id = p_user_id
      and u.wallet_address = p_wallet_address
  ) then
    raise exception 'INVALID_OR_EXPIRED_SESSION';
  end if;

  select e.* into edition
  from public.editions e
  where e.id = p_edition_id
  for update;

  if not found then
    raise exception 'EDITION_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.brand_memberships m
    where m.brand_id = edition.brand_id
      and m.user_id = p_user_id
      and m.role in ('owner', 'editor')
  ) then
    raise exception 'BRAND_ACCESS_DENIED';
  end if;

  -- Keep this endpoint limited to drafts without on-chain initialization.
  if edition.is_active
    or edition.chain_status not in ('pending', 'failed')
    or edition.chain_drop_address is not null
    or edition.initialization_tx_signature is not null
  then
    raise exception 'EDITION_NOT_EDITABLE';
  end if;

  if p_changes is null
    or jsonb_typeof(p_changes) <> 'object'
    or p_changes = '{}'::jsonb
  then
    raise exception 'INVALID_EDITION_CHANGES';
  end if;

  for field_name, field_value in
    select key, value from jsonb_each(p_changes)
  loop
    if field_name in (
      'name', 'description', 'fabric', 'headpiece', 'embroidery'
    ) then
      if jsonb_typeof(field_value) <> 'string' then
        raise exception 'INVALID_EDITION_CHANGES';
      end if;
    elsif field_name in ('price_usd', 'max_supply') then
      if jsonb_typeof(field_value) <> 'number' then
        raise exception 'INVALID_EDITION_CHANGES';
      end if;
    else
      raise exception 'UNSUPPORTED_FIELDS';
    end if;
  end loop;

  if p_changes ? 'name' and
    char_length(trim(p_changes ->> 'name')) not between 1 and 120
  then
    raise exception 'INVALID_EDITION_CHANGES';
  end if;

  if char_length(p_changes ->> 'description') > 10000
    or char_length(p_changes ->> 'fabric') > 500
    or char_length(p_changes ->> 'headpiece') > 500
    or char_length(p_changes ->> 'embroidery') > 500
  then
    raise exception 'INVALID_EDITION_CHANGES';
  end if;

  if p_changes ? 'price_usd' then
    if (p_changes ->> 'price_usd')::numeric <= 0
      or (p_changes ->> 'price_usd')::numeric > 9999999999.99
      or (p_changes ->> 'price_usd')::numeric <>
        round((p_changes ->> 'price_usd')::numeric, 2)
    then
      raise exception 'INVALID_EDITION_CHANGES';
    end if;
  end if;

  if p_changes ? 'max_supply' then
    if (p_changes ->> 'max_supply')::numeric < 1
      or (p_changes ->> 'max_supply')::numeric > 2147483647
      or (p_changes ->> 'max_supply')::numeric <>
        trunc((p_changes ->> 'max_supply')::numeric)
    then
      raise exception 'INVALID_EDITION_CHANGES';
    end if;
  end if;

  update public.editions
  set
    name = coalesce(trim(p_changes ->> 'name'), edition.name),
    description = coalesce(
      trim(p_changes ->> 'description'), edition.description
    ),
    fabric = coalesce(trim(p_changes ->> 'fabric'), edition.fabric),
    headpiece = coalesce(
      trim(p_changes ->> 'headpiece'), edition.headpiece
    ),
    embroidery = coalesce(
      trim(p_changes ->> 'embroidery'), edition.embroidery
    ),
    price_usd = coalesce(
      (p_changes ->> 'price_usd')::numeric, edition.price_usd
    ),
    max_supply = coalesce(
      (p_changes ->> 'max_supply')::numeric::integer,
      edition.max_supply
    ),
    updated_at = now()
  where id = edition.id
  returning * into edition;

  return to_jsonb(edition);
end;
$$;

revoke all on function public.update_edition_draft(
  text, uuid, text, jsonb
) from public, anon, authenticated;

grant execute on function public.update_edition_draft(
  text, uuid, text, jsonb
) to service_role;

commit;