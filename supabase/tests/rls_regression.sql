-- SQL-level RLS regression checks (local only, seed data from supabase/seed.sql).
--   psql postgresql://postgres:postgres@127.0.0.1:55322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/rls_regression.sql
-- Every case runs in a transaction that is rolled back. A failing ASSERT aborts the run.
\set QUIET on
\set ON_ERROR_STOP on
\o /dev/null

-- Claims helpers: alice / bob / carol with a random (unverified) session and amr=password.
\set alice '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","session_id":"00000000-0000-0000-0000-00000000a11c","amr":[{"method":"password","timestamp":1}]}'
\set bob   '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","session_id":"00000000-0000-0000-0000-000000000b0b","amr":[{"method":"password","timestamp":1}]}'
\set carol '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated","session_id":"00000000-0000-0000-0000-0000000ca201","amr":[{"method":"password","timestamp":1}]}'
\set alice_otp '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","session_id":"00000000-0000-0000-0000-00000000a11d","amr":[{"method":"otp","timestamp":1}]}'
\set alice_oauth '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","session_id":"00000000-0000-0000-0000-00000000a11e","amr":[{"method":"oauth","timestamp":1}]}'

\echo '1. flags OFF: pre-existing behaviour'
begin;
update public.app_settings set device_verification_enforced = false, age_confirmation_required = false;
set local role authenticated;
select set_config('request.jwt.claims', :'alice', true);
do $$ begin
  assert (select count(*) from chat_messages where bubble_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 2, 'alice reads Flatmates chat';
  assert (select count(*) from bubbles) = 2, 'alice sees her 2 bubbles';
  assert (select count(*) from users) = 3, 'alice sees bob and requester carol';
  assert (select count(*) from join_requests) = 1, 'alice sees carol''s request';
  assert (select count(*) from events) = 2 and (select count(*) from food_posts) = 1
     and (select count(*) from market_items) = 1 and (select count(*) from shared_links) = 1, 'content visible';
  assert public.is_session_verified(), 'verified while OFF';
end $$;
select set_config('request.jwt.claims', :'carol', true);
do $$ begin
  assert (select count(*) from chat_messages) = 0, 'carol (pending) reads no chat';
  assert (select count(*) from join_requests) = 1, 'carol sees her own request';
  assert (select count(*) from bubbles) = 1, 'carol sees the bubble she asked to join';
  assert (select count(*) from users) = 1, 'carol sees only herself';
end $$;
rollback;

\echo '2. blocks hide content both ways (flags OFF)'
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'alice', true);
insert into blocks (blocker_id, blocked_id) values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
do $$ begin
  assert (select count(*) from chat_messages where sender_id = '22222222-2222-2222-2222-222222222222') = 0, 'alice no longer sees bob''s chat';
  assert (select count(*) from blocks) = 1, 'alice sees her block';
end $$;
select set_config('request.jwt.claims', :'bob', true);
do $$ begin
  assert (select count(*) from chat_messages where sender_id = '11111111-1111-1111-1111-111111111111') = 0, 'bob no longer sees alice''s chat';
  assert (select count(*) from blocks) = 0, 'bob can''t see alice''s block list';
end $$;
rollback;

\echo '3. device enforcement ON'
begin;
update public.app_settings set device_verification_enforced = true;
set local role authenticated;
select set_config('request.jwt.claims', :'alice', true);
do $$ declare t text; n int; begin
  foreach t in array array['users','bubbles','bubble_members','join_requests','chat_messages','events',
                           'food_posts','market_items','shared_links','blocks','reports'] loop
    execute format('select count(*) from public.%I', t) into n;
    assert n = 0, format('unverified session reads %s rows of %s', n, t);
  end loop;
  assert not public.is_session_verified(), 'not verified';
  assert not public.is_bubble_member('aaaaaaaa-0000-0000-0000-000000000001'), 'is_bubble_member gated';
  assert not public.shares_bubble_with('11111111-1111-1111-1111-111111111111'), 'shares_bubble_with gated';
end $$;
do $$ begin
  begin
    insert into blocks (blocker_id, blocked_id) values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
    assert false, 'block insert should fail';
  exception when insufficient_privilege then null; end;
  begin
    perform public.create_bubble('nope');
    assert false, 'create_bubble should fail';
  exception when insufficient_privilege then
    assert sqlerrm = 'session not verified', sqlerrm;
  end;
  begin
    update users set name = 'x' where id = auth.uid();
    assert not found, 'own profile update must touch nothing';
  end;
end $$;
-- Email-proven and OAuth sessions count as verified.
select set_config('request.jwt.claims', :'alice_otp', true);
do $$ begin
  assert (select count(*) from chat_messages) > 0, 'amr=otp session reads chat';
end $$;
select set_config('request.jwt.claims', :'alice_oauth', true);
do $$ begin
  assert (select count(*) from chat_messages) > 0, 'amr=oauth session reads chat';
end $$;
-- A session listed in verified_sessions counts as verified.
reset role;
insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values ('00000000-0000-0000-0000-00000000a11c', '11111111-1111-1111-1111-111111111111', now(), now(), 'aal1');
insert into public.verified_sessions (session_id, user_id)
values ('00000000-0000-0000-0000-00000000a11c', '11111111-1111-1111-1111-111111111111');
set local role authenticated;
select set_config('request.jwt.claims', :'alice', true);
do $$ begin
  assert (select count(*) from chat_messages) = 2 + 1, 'verified session reads chat in both bubbles';
  assert public.is_session_verified(), 'verified';
end $$;
-- Someone else's session id doesn't help.
select set_config('request.jwt.claims', replace(:'bob', '00000000-0000-0000-0000-000000000b0b', '00000000-0000-0000-0000-00000000a11c'), true);
do $$ begin
  assert not public.is_session_verified(), 'alice''s session id doesn''t verify bob';
end $$;
rollback;

\echo '4. age confirmation ON'
begin;
update public.app_settings set age_confirmation_required = true;
update public.users set age_confirmed_at = now() where id = '22222222-2222-2222-2222-222222222222';
set local role authenticated;
select set_config('request.jwt.claims', :'alice', true);
do $$ begin
  assert (select count(*) from chat_messages) = 0, 'alice (no age) reads nothing';
  assert not public.is_session_verified(), 'not verified without age';
  assert public.is_device_verified(), 'device part still fine';
end $$;
select set_config('request.jwt.claims', :'bob', true);
do $$ begin
  assert (select count(*) from chat_messages) > 0, 'bob (age confirmed) reads chat';
end $$;
select set_config('request.jwt.claims', :'alice', true);
select public.confirm_age('2026-11-22');
do $$ begin
  assert (select count(*) from chat_messages) > 0, 'alice reads chat after confirm_age';
end $$;
rollback;

\echo '5. privileges: internal tables and helpers are closed to clients'
do $$ begin
  assert not has_table_privilege('authenticated', 'public.app_settings', 'select'), 'app_settings closed';
  assert not has_table_privilege('authenticated', 'public.trusted_devices', 'select'), 'trusted_devices closed';
  assert not has_table_privilege('authenticated', 'public.verified_sessions', 'insert'), 'verified_sessions closed';
  assert not has_table_privilege('authenticated', 'public.email_challenges', 'select'), 'email_challenges closed';
  assert not has_column_privilege('authenticated', 'public.users', 'age_confirmed_at', 'update'), 'age not writable';
  assert has_column_privilege('authenticated', 'public.users', 'age_confirmed_at', 'select'), 'age readable';
  assert has_column_privilege('authenticated', 'public.users', 'name', 'update'), 'name writable';
  assert not has_function_privilege('authenticated', 'public.issue_email_challenge(uuid,uuid,text,text,text)', 'execute'), 'issue closed';
  assert not has_function_privilege('authenticated', 'public.complete_email_challenge(uuid,uuid,text)', 'execute'), 'complete closed';
  assert not has_function_privilege('authenticated', 'public.trust_device(uuid,text,text)', 'execute'), 'trust_device closed';
  assert not has_function_privilege('authenticated', 'public.claim_report_alert(uuid)', 'execute'), 'claim_report_alert closed';
  assert not has_function_privilege('anon', 'public.start_device_check(text,text)', 'execute'), 'anon start_device_check closed';
  assert not has_function_privilege('anon', 'public.delete_my_account()', 'execute'), 'anon delete closed';
  assert not has_function_privilege('authenticated', 'public.try_admit_join_request(uuid)', 'execute'), 'internal admit closed';
  assert has_function_privilege('supabase_auth_admin', 'public.hook_before_user_created(jsonb)', 'execute'), 'hook callable by auth';
  assert not has_function_privilege('authenticated', 'public.hook_before_user_created(jsonb)', 'execute'), 'hook closed to clients';
  assert (select device_verification_enforced = false and age_confirmation_required = false from public.app_settings), 'flags default OFF';
end $$;

\echo 'ALL RLS CHECKS PASSED'
