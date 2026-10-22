-- Run once in Supabase SQL Editor after 003 (and before deploying this route).
-- Adds a service-role-only RPC. Existing brands and memberships are untouched.
begin;
create or replace function public.circuit_create_brand(
  p_user_id uuid, p_wallet_address text, p_name text, p_slug text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_wallet text;
  v_name text := btrim(p_name);
  v_slug text := lower(btrim(p_slug));
  v_brand public.brands%rowtype;
begin
  -- Lock the user row so a concurrent wallet update cannot race creation.
  select wallet_address into v_wallet from public.users
    where id = p_user_id for update;
  if not found or v_wallet is null or p_wallet_address is distinct from v_wallet then
    raise exception using errcode = '28000', message = 'INVALID_OR_EXPIRED_SESSION';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 120
     or v_name ~ '[[:cntrl:]]'
     or v_slug is null or char_length(v_slug) not between 1 and 80
     or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception using errcode = '22023', message = 'INVALID_BRAND_DETAILS';
  end if;
  insert into public.brands (name, slug, payment_wallet_address)
    values (v_name, v_slug, v_wallet) returning * into v_brand;
  insert into public.brand_memberships (brand_id, user_id, role)
    values (v_brand.id, p_user_id, 'owner');
  return jsonb_build_object(
    'id', v_brand.id, 'name', v_brand.name, 'slug', v_brand.slug,
    'payment_wallet_address', v_brand.payment_wallet_address,
    'created_at', v_brand.created_at, 'role', 'owner');
end;
$$;
revoke all on function public.circuit_create_brand(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.circuit_create_brand(uuid,text,text,text) to service_role;
notify pgrst, 'reload schema';
commit;
