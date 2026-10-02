begin;

create function public.manage_edition_image(
  p_edition_id text,
  p_user_id uuid,
  p_wallet_address text,
  p_action text,
  p_image jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  edition public.editions%rowtype;
  next_images jsonb;
  image_path text;
  image_url text;
  image_tag text;
  expected_prefix text;
begin
  -- Confirm the authenticated account still owns this wallet.
  if not exists (
    select 1
    from public.users u
    where u.id = p_user_id
      and u.wallet_address = p_wallet_address
  ) then
    raise exception 'INVALID_OR_EXPIRED_SESSION';
  end if;

  -- Serialize changes to this edition's image list.
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

  if p_action is null or p_action not in ('add', 'remove') then
    raise exception 'INVALID_IMAGE_ACTION';
  end if;

  if p_image is null
    or jsonb_typeof(p_image) <> 'object'
    or jsonb_typeof(p_image -> 'path') is distinct from 'string'
  then
    raise exception 'INVALID_IMAGE_PAYLOAD';
  end if;

  image_path := p_image ->> 'path';

  expected_prefix :=
    'brands/' || edition.brand_id::text ||
    '/editions/' || edition.id || '/';

  -- Only accept a single generated filename under this edition.
  if left(image_path, length(expected_prefix)) <> expected_prefix
    or substring(image_path from length(expected_prefix) + 1)
      !~ '^[a-f0-9-]+\.(jpg|png|webp)$'
  then
    raise exception 'INVALID_IMAGE_PATH';
  end if;

  if p_action = 'add' then
    if jsonb_typeof(p_image -> 'url') is distinct from 'string'
      or nullif(trim(p_image ->> 'url'), '') is null
    then
      raise exception 'INVALID_IMAGE_URL';
    end if;

    if p_image ? 'tag'
      and jsonb_typeof(p_image -> 'tag') is distinct from 'string'
    then
      raise exception 'INVALID_IMAGE_TAG';
    end if;

    image_url := p_image ->> 'url';
    image_tag := coalesce(p_image ->> 'tag', '');

    if length(image_tag) > 100 then
      raise exception 'INVALID_IMAGE_TAG';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(edition.images) as item
      where item ->> 'path' = image_path
    ) then
      raise exception 'IMAGE_ALREADY_ATTACHED';
    end if;

    if jsonb_array_length(edition.images) >= 10 then
      raise exception 'EDITION_IMAGE_LIMIT_REACHED';
    end if;

    next_images := edition.images || jsonb_build_array(
      jsonb_build_object(
        'path', image_path,
        'url', image_url,
        'tag', image_tag
      )
    );
  else
    -- Removing an already-removed path is harmless.
    select coalesce(
      jsonb_agg(item order by position),
      '[]'::jsonb
    )
    into next_images
    from jsonb_array_elements(edition.images)
      with ordinality as entries(item, position)
    where (item ->> 'path') is distinct from image_path;
  end if;

  update public.editions
  set images = next_images,
      image_url = coalesce(next_images -> 0 ->> 'url', '/satin.png'),
      updated_at = now()
  where id = edition.id
  returning * into edition;

  return to_jsonb(edition);
end;
$$;

-- Only our trusted backend may call this function.
revoke all on function public.manage_edition_image(
  text, uuid, text, text, jsonb
) from public, anon, authenticated;

grant execute on function public.manage_edition_image(
  text, uuid, text, text, jsonb
) to service_role;

commit;