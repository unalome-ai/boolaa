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
\set mod   '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated","session_id":"00000000-0000-0000-0000-00000000a0d1","amr":[{"method":"password","timestamp":1}]}'
\set dave  '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated","session_id":"00000000-0000-0000-0000-00000000da7e","amr":[{"method":"password","timestamp":1}]}'
\set erin  '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated","session_id":"00000000-0000-0000-0000-0000000e4141","amr":[{"method":"password","timestamp":1}]}'

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

\echo '6. moderation: admin RPCs are admin-only'
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'alice', true);
do $$ declare c text; begin
  assert not public.is_admin(), 'alice is not an admin';
  foreach c in array array[
    $q$select public.admin_list_reports('open', 10, 0)$q$,
    $q$select public.admin_get_report('dddddddd-0000-0000-0000-000000000001')$q$,
    $q$select public.admin_resolve_report('dddddddd-0000-0000-0000-000000000001', 'dismiss', null, null)$q$,
    $q$select public.admin_unsuspend('55555555-5555-5555-5555-555555555555', null)$q$,
    $q$select public.admin_find_users('Dave', 10)$q$] loop
    begin
      execute c;
      assert false, 'non-admin ran: ' || c;
    exception when insufficient_privilege then
      assert sqlerrm = 'permission denied', format('%s -> %s', c, sqlerrm);
    end;
  end loop;
  assert (select count(*) from public.moderation_actions) = 0, 'non-admin reads no audit log';
end $$;
rollback;
do $$ begin
  assert not has_table_privilege('authenticated', 'public.admins', 'select'), 'admins closed';
  assert not has_table_privilege('authenticated', 'public.moderation_actions', 'insert'), 'audit log append-only for clients';
  assert not has_column_privilege('authenticated', 'public.users', 'status', 'update'), 'status not writable';
  assert not has_function_privilege('anon', 'public.admin_list_reports(text,int,int)', 'execute'), 'anon list closed';
  assert not has_function_privilege('anon', 'public.admin_resolve_report(uuid,text,text,int)', 'execute'), 'anon resolve closed';
  assert not has_function_privilege('authenticated', 'public.set_account_status(uuid,text,text,timestamptz)', 'execute'), 'set_account_status internal';
  assert not has_function_privilege('authenticated', 'public.require_admin()', 'execute'), 'require_admin internal';
end $$;

\echo '7. moderation: suspend blocks the user (own row stays readable), unsuspend restores'
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'mod', true);
do $$ declare r jsonb; begin
  assert public.is_admin(), 'mod is admin';
  assert (public.admin_list_reports('open', 200, 0) -> 'items') @> '[{"id": "dddddddd-0000-0000-0000-000000000001"}]', 'seeded report listed';
  r := public.admin_resolve_report('dddddddd-0000-0000-0000-000000000001', 'suspend', 'first warning', 7);
  assert r ->> 'status' = 'actioned', r::text;
  assert (select count(*) from public.moderation_actions where action = 'suspend' and created_at = now()) = 1, 'audit row readable by admin';
end $$;
reset role;
do $$ begin
  assert (select banned_until between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour'
            from auth.users where id = '55555555-5555-5555-5555-555555555555'), 'GoTrue ban until the end of the suspension';
  assert (select status = 'suspended' and status_reason = 'harassment' from public.users where id = '55555555-5555-5555-5555-555555555555'), 'status set';
  assert (select handled_note = 'first warning' and handled_at is not null from public.reports where id = 'dddddddd-0000-0000-0000-000000000001'), 'report handled';
  assert (select status = 'open' from public.reports where id = 'dddddddd-0000-0000-0000-000000000002'), 'other target stays open';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', :'dave', true);
do $$ begin
  assert not public.is_session_verified(), 'suspended session not verified';
  assert (select count(*) from chat_messages) = 0, 'suspended user reads no chat';
  assert (select count(*) from bubbles) = 0, 'no bubbles';
  assert (select count(*) from users) = 1, 'only own row';
  assert (select status from users where id = auth.uid()) = 'suspended', 'reads own status';
  begin
    insert into chat_messages (bubble_id, sender_id, content) values ('aaaaaaaa-0000-0000-0000-000000000003', auth.uid(), 'x');
    assert false, 'suspended insert should fail';
  exception when insufficient_privilege then null; end;
  begin
    perform public.report_content('user', '66666666-6666-6666-6666-666666666666', 'spam', null);
    assert false, 'report should fail';
  exception when insufficient_privilege then assert sqlerrm = 'account suspended', sqlerrm; end;
  update users set name = 'x' where id = auth.uid();
  assert not found, 'suspended user can''t rename';
end $$;
select set_config('request.jwt.claims', :'erin', true);
do $$ begin
  assert (select count(*) from chat_messages where sender_id = '55555555-5555-5555-5555-555555555555') = 3, 'content of a suspended user stays visible';
end $$;
-- An ended suspension counts as active without any job.
reset role;
update public.users set status_until = now() - interval '1 minute' where id = '55555555-5555-5555-5555-555555555555';
set local role authenticated;
select set_config('request.jwt.claims', :'dave', true);
do $$ begin
  assert (select count(*) from chat_messages) > 0, 'expired suspension: access back';
end $$;
reset role;
update public.users set status_until = now() + interval '1 day' where id = '55555555-5555-5555-5555-555555555555';
set local role authenticated;
select set_config('request.jwt.claims', :'mod', true);
do $$ declare r jsonb; begin
  r := public.admin_unsuspend('55555555-5555-5555-5555-555555555555', 'appeal accepted');
  assert r ->> 'previous_status' = 'suspended', r::text;
end $$;
select set_config('request.jwt.claims', :'dave', true);
do $$ begin
  assert (select count(*) from chat_messages) > 0, 'unsuspended user reads chat again';
  assert (select status from users where id = auth.uid()) = 'active', 'active';
end $$;
reset role;
do $$ begin
  assert (select banned_until is null from auth.users where id = '55555555-5555-5555-5555-555555555555'), 'GoTrue ban lifted';
end $$;
rollback;

\echo '8. moderation: each action, duplicates closed, ban, suspended user may delete the account'
begin;
-- A duplicate report on the same message (as if a second member reported it).
insert into public.reports (reporter_id, bubble_id, target_type, target_id, reported_user_id, reason, alert_sent_at)
values ('66666666-6666-6666-6666-666666666666', 'aaaaaaaa-0000-0000-0000-000000000003', 'chat_message',
        'cccccccc-0000-0000-0000-000000000004', '55555555-5555-5555-5555-555555555555', 'hate', now());
set local role authenticated;
select set_config('request.jwt.claims', :'mod', true);
do $$ declare r jsonb; begin
  r := public.admin_resolve_report('dddddddd-0000-0000-0000-000000000001', 'delete_content', 'removed', null);
  assert (r ->> 'duplicates_closed')::int = 1 and (r ->> 'rows_deleted')::int = 1, r::text;
  assert not exists (select 1 from public.reports where target_id = 'cccccccc-0000-0000-0000-000000000004' and status = 'open'), 'duplicates closed';
  assert (public.admin_get_report('dddddddd-0000-0000-0000-000000000001') -> 'snapshot' ->> 'deleted')::boolean, 'snapshot says deleted';
  begin
    perform public.admin_resolve_report('dddddddd-0000-0000-0000-000000000001', 'dismiss', null, null);
    assert false, 'handled twice';
  exception when others then assert sqlerrm = 'report already handled', sqlerrm; end;
  begin
    perform public.admin_resolve_report('dddddddd-0000-0000-0000-000000000002', 'suspend', null, 0);
    assert false, 'bad days';
  exception when others then assert sqlerrm = 'invalid suspension length', sqlerrm; end;
  begin
    perform public.admin_resolve_report('dddddddd-0000-0000-0000-000000000002', 'delete_content', null, null);
    assert false, 'user report has no content';
  exception when others then assert sqlerrm = 'a user report has no content to delete', sqlerrm; end;
  r := public.admin_resolve_report('dddddddd-0000-0000-0000-000000000002', 'remove_from_bubble', null, null);
  assert r ->> 'status' = 'actioned', r::text;
end $$;
reset role;
do $$ begin
  assert not exists (select 1 from public.bubble_members where user_id = '55555555-5555-5555-5555-555555555555'), 'dave removed from Book Club';
  assert (select role from public.bubble_members where user_id = '66666666-6666-6666-6666-666666666666') = 'owner', 'erin still owner';
  assert (select count(*) from public.moderation_actions where created_at = now()) = 2, 'two audit rows';
end $$;
-- Dismiss and ban on fresh reports.
insert into public.reports (id, reporter_id, bubble_id, target_type, target_id, reported_user_id, reason, alert_sent_at) values
  ('dddddddd-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
   'user', '22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'spam', now()),
  ('dddddddd-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
   'user', '22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'other', now());
set local role authenticated;
select set_config('request.jwt.claims', :'mod', true);
do $$ declare r jsonb; begin
  r := public.admin_resolve_report('dddddddd-0000-0000-0000-0000000000a1', 'dismiss', 'not spam', null);
  assert r ->> 'status' = 'dismissed' and (r ->> 'duplicates_closed')::int = 1, r::text;
  assert (public.admin_list_reports('dismissed', 200, 0) -> 'items') @> '[{"id": "dddddddd-0000-0000-0000-0000000000a2", "status": "dismissed"}]', 'dismissed tab shows the closed duplicate';
end $$;
reset role;
update public.reports set status = 'open', handled_at = null where id = 'dddddddd-0000-0000-0000-0000000000a2';
set local role authenticated;
select set_config('request.jwt.claims', :'mod', true);
do $$ declare r jsonb; begin
  r := public.admin_resolve_report('dddddddd-0000-0000-0000-0000000000a2', 'ban', 'spam bot', null);
  assert (r ->> 'bubbles_left')::int = 2, r::text;
end $$;
reset role;
do $$ begin
  assert (select status = 'banned' and status_until is null from public.users where id = '22222222-2222-2222-2222-222222222222'), 'banned';
  assert (select banned_until > now() + interval '50 years' from auth.users where id = '22222222-2222-2222-2222-222222222222'), 'GoTrue ban';
  assert (select role from public.bubble_members where bubble_id = 'aaaaaaaa-0000-0000-0000-000000000002'
            and user_id = '11111111-1111-1111-1111-111111111111') = 'owner', 'ownership handed to alice';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', :'bob', true);
do $$ begin
  assert (select count(*) from users) = 1 and (select status from users) = 'banned', 'banned user reads own status only';
  perform public.delete_my_account();
end $$;
reset role;
do $$ begin
  assert not exists (select 1 from auth.users where id = '22222222-2222-2222-2222-222222222222'), 'banned user could delete the account';
end $$;
rollback;

\echo '9. moderation with device enforcement ON'
begin;
update public.app_settings set device_verification_enforced = true;
set local role authenticated;
select set_config('request.jwt.claims', :'mod', true);
do $$ begin
  begin
    perform public.admin_list_reports('open', 10, 0);
    assert false, 'unverified admin';
  exception when insufficient_privilege then assert sqlerrm = 'session not verified', sqlerrm; end;
end $$;
select set_config('request.jwt.claims', :'alice', true);
do $$ begin
  begin
    perform public.admin_list_reports('open', 10, 0);
    assert false, 'non-admin';
  exception when insufficient_privilege then assert sqlerrm = 'permission denied', sqlerrm; end;
end $$;
reset role;
insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
  ('00000000-0000-0000-0000-00000000a0d1', '44444444-4444-4444-4444-444444444444', now(), now(), 'aal1'),
  ('00000000-0000-0000-0000-00000000da7e', '55555555-5555-5555-5555-555555555555', now(), now(), 'aal1');
insert into public.verified_sessions (session_id, user_id) values
  ('00000000-0000-0000-0000-00000000a0d1', '44444444-4444-4444-4444-444444444444'),
  ('00000000-0000-0000-0000-00000000da7e', '55555555-5555-5555-5555-555555555555');
set local role authenticated;
select set_config('request.jwt.claims', :'mod', true);
do $$ begin
  perform public.admin_resolve_report('dddddddd-0000-0000-0000-000000000001', 'suspend', null, 1);
end $$;
select set_config('request.jwt.claims', :'dave', true);
do $$ begin
  assert (select count(*) from chat_messages) = 0, 'suspended (verified device) reads no chat';
  assert (select status from users where id = auth.uid()) = 'suspended', 'reads own status';
end $$;
-- Same user on an unverified session: not even the own row.
select set_config('request.jwt.claims', replace(:'dave', '00000000-0000-0000-0000-00000000da7e', '00000000-0000-0000-0000-00000000da7f'), true);
do $$ begin
  assert (select count(*) from users) = 0, 'unverified device: nothing';
end $$;
rollback;

\echo '10. bubble roles: roles change only through owner RPCs (20261123190000_bubble_roles.sql)'
begin;
update public.app_settings set device_verification_enforced = false, age_confirmation_required = false;
do $$ begin
  assert not has_table_privilege('authenticated', 'public.bubble_members', 'update'), 'bubble_members not updatable';
  assert not has_table_privilege('authenticated', 'public.bubble_members', 'insert'), 'bubble_members not insertable';
  assert not has_function_privilege('authenticated', 'public.bubble_role(uuid,uuid)', 'execute'), 'bubble_role internal';
  assert not has_function_privilege('anon', 'public.transfer_ownership(uuid,uuid)', 'execute'), 'anon transfer closed';
  assert not has_function_privilege('anon', 'public.set_member_role(uuid,uuid,text)', 'execute'), 'anon set role closed';
end $$;
set local role authenticated;
-- Climbing Crew: bob owns, alice is a member.
select set_config('request.jwt.claims', :'alice', true);
do $$ begin
  begin
    perform public.set_member_role('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'admin');
    assert false, 'member promoted herself';
  exception when others then assert sqlerrm = 'only the owner can change roles', sqlerrm; end;
  assert not public.can_manage_bubble('aaaaaaaa-0000-0000-0000-000000000002'), 'member does not manage';
end $$;
select set_config('request.jwt.claims', :'bob', true);
do $$ begin
  perform public.set_member_role('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'admin');
end $$;
select set_config('request.jwt.claims', :'alice', true);
do $$ begin
  assert public.can_manage_bubble('aaaaaaaa-0000-0000-0000-000000000002'), 'admin manages';
  begin
    perform public.remove_member('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222');
    assert false, 'admin removed the owner';
  exception when others then assert sqlerrm = 'only the owner can remove admins', sqlerrm; end;
end $$;
select set_config('request.jwt.claims', :'bob', true);
do $$ begin
  perform public.transfer_ownership('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111');
  assert (select array_agg(role order by role) from bubble_members where bubble_id = 'aaaaaaaa-0000-0000-0000-000000000002')
         = array['admin', 'owner'], 'bob admin, alice owner';
end $$;
reset role;
rollback;

\echo 'ALL RLS CHECKS PASSED'
