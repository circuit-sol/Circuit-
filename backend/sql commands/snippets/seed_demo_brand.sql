begin;

do $$
declare
  seller_id uuid;
  new_brand_id uuid;
  seller_wallet text :=
    '5J4rFUXsiaCMrpVYjCrYh8nnKgxaZMxUfE7KcUKB7prS';
begin
  -- Match the specific account shown in your screenshot.
  select id into strict seller_id
  from public.users
  where id = 'ee9a2fb1-a175-4fd5-a9fd-bc100bc627e3'::uuid
    and email = 'olamideoluwalusi@gmail.com'
  for update;

  -- Stop rather than merge two different accounts.
  if exists (
    select 1
    from public.users
    where wallet_address = seller_wallet
      and id <> seller_id
  ) then
    raise exception
      'This wallet already belongs to another user. No changes made.';
  end if;

  update public.users
  set wallet_address = seller_wallet,
      last_login_at = null
  where id = seller_id;

  insert into public.brands (
    name,
    slug,
    payment_wallet_address
  )
  values (
    'Circuit Demo',
    'circuit-demo',
    seller_wallet
  )
  returning id into new_brand_id;

  insert into public.brand_memberships (
    brand_id,
    user_id,
    role
  )
  values (
    new_brand_id,
    seller_id,
    'owner'
  );
end;
$$;

commit;