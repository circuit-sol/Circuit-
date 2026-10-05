-- Run in the TEST Supabase SQL editor AFTER migration 008.
-- Uses one existing edition with an owner/editor and rolls back all test writes.
-- This is a test, not a numbered migration. No wallet secrets are needed.
begin;
do $$
declare
  identity record;
  payload jsonb;
  result jsonb;
  batch_id uuid;
  candidate jsonb;
  expected text;
  actual text;
begin
  select u.id user_id, u.wallet_address, e.id edition_id into identity
    from public.editions e
    join public.brand_memberships m on m.brand_id = e.brand_id
    join public.users u on u.id = m.user_id
    where m.role in ('owner', 'editor') order by e.created_at limit 1;
  if not found then raise exception 'Create an edition with an owner/editor before testing'; end if;

  payload := jsonb_build_object(
    'edition_id', identity.edition_id, 'name', 'Rollback-only batch test',
    'opens_at', to_char((now() + interval '1 day') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'closes_at', to_char((now() + interval '2 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'production_starts_at', to_char((now() + interval '4 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'release_at', to_char((now() + interval '10 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'pickup_locations', jsonb_build_array(jsonb_build_object('name', 'Test studio', 'address', 'Test address'))
  );
  result := public.save_batch_draft(identity.user_id, identity.wallet_address, null, payload, null);
  batch_id := (result ->> 'id')::uuid;
  if (result ->> 'is_active')::boolean or result ->> 'chain_status' <> 'pending'
    or result #>> '{pickup_locations,0,id}' is null then
    raise exception 'FAIL: unsafe defaults or missing generated location ID';
  end if;

  result := public.save_batch_draft(identity.user_id, identity.wallet_address,
    batch_id, '{"name":"Renamed draft"}'::jsonb, 1);
  if (result ->> 'revision')::integer <> 2 then raise exception 'FAIL: revision not advanced'; end if;
  begin
    perform public.save_batch_draft(identity.user_id, identity.wallet_address,
      batch_id, '{"name":"Stale edit"}'::jsonb, 1);
    raise exception 'FAIL: stale edit accepted';
  exception when others then
    if sqlerrm <> 'BATCH_REVISION_CONFLICT' then raise; end if;
  end;

  for candidate, expected in select * from (values
    (payload || '{"is_active":true}'::jsonb, 'UNSUPPORTED_FIELDS'),
    (payload || jsonb_build_object('closes_at', payload ->> 'opens_at'), 'INVALID_BATCH_SCHEDULE'),
    (payload || jsonb_build_object('production_starts_at', payload ->> 'closes_at'), 'INVALID_BATCH_SCHEDULE'),
    (payload || jsonb_build_object('release_at', payload ->> 'production_starts_at'), 'INVALID_BATCH_SCHEDULE'),
    (payload || '{"opens_at":"2099-02-30T00:00:00Z"}'::jsonb, 'INVALID_BATCH_DATE'),
    (payload || '{"opens_at":"2099-01-01"}'::jsonb, 'INVALID_BATCH_DATE'),
    (payload || '{"pickup_locations":[]}'::jsonb, 'INVALID_PICKUP_LOCATIONS'),
    (payload || '{"pickup_locations":[{"name":"Test","address":""}]}'::jsonb, 'INVALID_PICKUP_LOCATIONS'),
    (payload || '{"pickup_locations":[{"name":"Test","address":"Place","id":"injected"}]}'::jsonb, 'INVALID_PICKUP_LOCATIONS'),
    (payload || '{"name":null}'::jsonb, 'INVALID_BATCH_CHANGES')
  ) as cases(changes, error_name) loop
    actual := null;
    begin
      perform public.save_batch_draft(identity.user_id, identity.wallet_address, null, candidate, null);
    exception when others then actual := sqlerrm;
    end;
    if actual is distinct from expected then
      raise exception 'FAIL: expected %, got %', expected, coalesce(actual, 'accepted');
    end if;
  end loop;

  begin
    perform public.save_batch_draft(identity.user_id, 'different-wallet', null, payload, null);
    raise exception 'FAIL: stale wallet accepted';
  exception when others then
    if sqlerrm <> 'INVALID_OR_EXPIRED_SESSION' then raise; end if;
  end;

  -- Membership removal and state changes are test-only and all rolled back.
  delete from public.brand_memberships where user_id = identity.user_id
    and brand_id = (select brand_id from public.editions where id = identity.edition_id);
  begin
    perform public.save_batch_draft(identity.user_id, identity.wallet_address, null, payload, null);
    raise exception 'FAIL: nonmember accepted';
  exception when others then
    if sqlerrm <> 'BRAND_ACCESS_DENIED' then raise; end if;
  end;
  insert into public.brand_memberships(brand_id, user_id, role)
    select brand_id, identity.user_id, 'owner' from public.editions where id = identity.edition_id;
  update public.batches set chain_status = 'initializing' where id = batch_id;
  begin
    perform public.save_batch_draft(identity.user_id, identity.wallet_address,
      batch_id, '{"name":"Must not edit"}'::jsonb, 2);
    raise exception 'FAIL: initializing batch edited';
  exception when others then
    if sqlerrm <> 'BATCH_NOT_EDITABLE' then raise; end if;
  end;

  if has_table_privilege('service_role', 'public.batches', 'INSERT')
    or has_table_privilege('service_role', 'public.batches', 'UPDATE')
    or has_table_privilege('service_role', 'public.batches', 'DELETE')
    or has_function_privilege('anon', 'public.save_batch_draft(uuid,text,uuid,jsonb,integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.save_batch_draft(uuid,text,uuid,jsonb,integer)', 'EXECUTE') then
    raise exception 'FAIL: unintended write permissions';
  end if;
  raise notice 'Batch SQL smoke tests passed; all writes will roll back.';
end;
$$;
rollback;
