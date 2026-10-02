begin;

do $$
declare
  seller_id uuid;
  demo_brand_id uuid;
  new_wallet text :=
    'FxmA8bTYUC6mCMijDzV6SfnWp7FWRQpsbiAVghy9Hmq9';
begin
  select id into strict seller_id
  from public.users
  where id = 'ee9a2fb1-a175-4fd5-a9fd-bc100bc627e3'::uuid
    and email = 'olamideoluwalusi@gmail.com'
  for update;

  select id into strict demo_brand_id
  from public.brands
  where slug = 'circuit-demo'
  for update;

  if exists (
    select 1
    from public.users
    where wallet_address = new_wallet
      and id <> seller_id
  ) then
    raise exception
      'This wallet already belongs to another user. No changes made.';
  end if;

  update public.users
  set wallet_address = new_wallet,
      last_login_at = null
  where id = seller_id
    and wallet_address is distinct from new_wallet;

  insert into public.brand_memberships (
    brand_id,
    user_id,
    role
  )
  values (
    demo_brand_id,
    seller_id,
    'owner'
  )
  on conflict (brand_id, user_id)
  do update set role = excluded.role;
end;
$$;

commit;