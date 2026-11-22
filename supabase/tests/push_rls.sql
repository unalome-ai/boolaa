-- SQL checks for push notifications (docs/push-notifications.md): RLS of the new tables,
-- the token RPCs, and who the outbox triggers notify. Local only, seed data from seed.sql.
--   psql postgresql://postgres:postgres@127.0.0.1:55322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/push_rls.sql
-- Every case runs in a transaction that is rolled back (pg_net calls queued inside are
-- rolled back too). A failing ASSERT aborts the run.
\set QUIET on
\set ON_ERROR_STOP on
\o /dev/null

\set alice '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","session_id":"00000000-0000-0000-0000-00000000a11c","amr":[{"method":"password","timestamp":1}]}'
\set bob   '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","session_id":"00000000-0000-0000-0000-000000000b0b","amr":[{"method":"password","timestamp":1}]}'
\set carol '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated","session_id":"00000000-0000-0000-0000-0000000ca201","amr":[{"method":"password","timestamp":1}]}'
\set dave  '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated","session_id":"00000000-0000-0000-0000-00000000da7e","amr":[{"method":"password","timestamp":1}]}'

-- Device tokens used below (fake but well-formed).
\set tok_a '''aaaa000000000000000000000000000000000000000000000000000000000001'''
\set tok_b '''android-bob-token-0000000000000001'''
\set tok_c '''android-carol-token-000000000000001'''
\set web_ep '''https://fcm.googleapis.com/fcm/send/alice-web-endpoint-1'''
\set p256dh '''BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'''
\set authk  '''BTBZMqHH6r4Tts7J_aSIgg'''

\echo 'push 1. tokens: register, own-row RLS, move between users, unregister'
begin;
update public.app_settings set device_verification_enforced = false, age_confirmation_required = false;
set local role authenticated;
select set_config('request.jwt.claims', :'alice', true);
select public.register_push_token('ios', :tok_a, p_apns_env := 'sandbox', p_locale := 'ro', p_app_version := '1.0 (7)');
select public.register_push_token('web', null, :web_ep, :p256dh, :authk, p_locale := 'en');
do $$ begin
  assert (select count(*) from push_tokens) = 2, 'alice sees her 2 tokens';
  assert (select token from push_tokens where platform = 'web') = (select endpoint from push_tokens where platform = 'web'), 'web token = endpoint';
  assert (select apns_env || locale from push_tokens where platform = 'ios') = 'sandboxro', 'apns_env and locale stored';
end $$;
-- Re-registering refreshes, never duplicates.
select public.register_push_token('ios', upper(:tok_a), p_apns_env := 'production');
do $$ begin
  assert (select count(*) from push_tokens where platform = 'ios') = 1, 'no duplicate';
  assert (select apns_env from push_tokens where platform = 'ios') = 'production', 'env updated';
end $$;
-- Validation.
do $$ begin
  begin perform public.register_push_token('ios', 'not-hex', p_apns_env := 'sandbox'); assert false, 'bad ios token';
  exception when others then assert sqlerrm = 'invalid push token', sqlerrm; end;
  begin perform public.register_push_token('ios', repeat('a', 64)); assert false, 'apns env required';
  exception when others then assert sqlerrm = 'invalid apns env', sqlerrm; end;
  begin perform public.register_push_token('web', null, 'https://evil.example.com/x', 'x', 'y'); assert false, 'endpoint allowlist';
  exception when others then assert sqlerrm = 'invalid push endpoint', sqlerrm; end;
  begin perform public.register_push_token('sms', 'x'); assert false, 'platform';
  exception when others then assert sqlerrm = 'invalid platform', sqlerrm; end;
end $$;
-- No direct writes.
do $$ begin
  begin
    insert into push_tokens (user_id, platform, token) values (auth.uid(), 'android', 'direct-insert-0000000');
    assert false, 'direct insert must fail';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims', :'bob', true);
do $$ begin
  assert (select count(*) from push_tokens) = 0, 'bob sees none of alice''s tokens';
  delete from push_tokens;  -- RLS: deletes nothing of alice's
end $$;
-- The same device token registered by bob (shared phone) moves to bob.
select public.register_push_token('ios', :tok_a, p_apns_env := 'sandbox');
do $$ begin
  assert (select count(*) from push_tokens) = 1, 'bob now owns the token';
end $$;
select set_config('request.jwt.claims', :'alice', true);
do $$ begin
  assert (select count(*) from push_tokens) = 1, 'alice keeps only her web token';
  assert public.unregister_push_token('https://fcm.googleapis.com/fcm/send/alice-web-endpoint-1'), 'unregister';
  assert (select count(*) from push_tokens) = 0, 'gone';
  assert not public.unregister_push_token('nope'), 'unknown token: false';
end $$;
rollback;

\echo 'push 2. prefs, mutes, outbox: own rows only; outbox and debug log closed'
begin;
update public.app_settings set device_verification_enforced = false, age_confirmation_required = false;
set local role authenticated;
select set_config('request.jwt.claims', :'alice', true);
do $$ begin
  assert (select count(*) from notification_prefs) = 1, 'alice sees her prefs row only';
  assert (select chat and join_requests and approvals and new_events and event_reminders and not food and not market
                 and preview_content and enabled from notification_prefs), 'defaults';
  update notification_prefs set preview_content = false, food = true;
  assert (select not preview_content and food from notification_prefs), 'updated';
  update notification_prefs set chat = false where user_id = '22222222-2222-2222-2222-222222222222';
  insert into bubble_mutes (user_id, bubble_id, until) values (auth.uid(), 'aaaaaaaa-0000-0000-0000-000000000001', now() + interval '8 hours');
  begin
    insert into bubble_mutes (user_id, bubble_id) values (auth.uid(), 'aaaaaaaa-0000-0000-0000-000000000003');
    assert false, 'cannot mute a bubble you are not in';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from notification_outbox; assert false, 'outbox closed';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from push_debug_log; assert false, 'debug log closed';
  exception when insufficient_privilege then null; end;
  begin perform public.claim_push_batch(10); assert false, 'claim is service-role only';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims', :'bob', true);
do $$ begin
  assert (select chat from notification_prefs) = true, 'alice could not change bob''s prefs';
  assert (select count(*) from bubble_mutes) = 0, 'bob sees no mutes of alice';
end $$;
rollback;

\echo 'push 3. device enforcement ON: unverified sessions read and register nothing'
begin;
update public.app_settings set device_verification_enforced = true, age_confirmation_required = false;
set local role authenticated;
select set_config('request.jwt.claims', :'alice', true);
do $$ begin
  assert (select count(*) from notification_prefs) = 0, 'prefs hidden';
  begin perform public.register_push_token('android', 'android-alice-0000000001'); assert false, 'must fail';
  exception when others then assert sqlerrm = 'session not verified', sqlerrm; end;
end $$;
rollback;

-- Fixture for the recipient cases: alice (ios, ro), bob (android), carol (android) have tokens.
\set fixture 'update public.app_settings set device_verification_enforced = false, age_confirmation_required = false; set local role authenticated; select set_config(''request.jwt.claims'', :''alice'', true); select public.register_push_token(''ios'', :tok_a, p_apns_env := ''sandbox'', p_locale := ''ro''); select set_config(''request.jwt.claims'', :''bob'', true); select public.register_push_token(''android'', :tok_b); select set_config(''request.jwt.claims'', :''carol'', true); select public.register_push_token(''android'', :tok_c); reset role;'

\echo 'push 4. chat: other members only; prefs, mutes, blocks, suspension, no device'
begin;
-- Vault entries as in seed.sql (created here if this database wasn't re-seeded).
select vault.create_secret('http://kong:8000/functions/v1/push-dispatch', 'push_dispatch_url')
 where not exists (select 1 from vault.secrets where name = 'push_dispatch_url');
select vault.create_secret('local-push-dispatch-secret-change-me', 'push_dispatch_secret')
 where not exists (select 1 from vault.secrets where name = 'push_dispatch_secret');
update public.app_settings set device_verification_enforced = false, age_confirmation_required = false;
:fixture
set local role authenticated;
select set_config('request.jwt.claims', :'bob', true);
insert into chat_messages (bubble_id, sender_id, content) values ('aaaaaaaa-0000-0000-0000-000000000001', auth.uid(), 'Pizza tonight?');
reset role;
do $$ begin
  assert (select array_agg(recipient_id) from notification_outbox where type = 'chat')
       = array['11111111-1111-1111-1111-111111111111']::uuid[], 'only alice (author bob excluded, carol not a member)';
  assert (select collapse_key = 'chat:aaaaaaaa-0000-0000-0000-000000000001' and (payload ->> 'count')::int = 1
            and actor_id = '22222222-2222-2222-2222-222222222222' from notification_outbox), 'row content';
  assert (select count(*) from net.http_request_queue where url like '%push-dispatch%') = 1, 'dispatcher woken once';
end $$;
-- Each filter, one at a time (delete the outbox in between).
delete from notification_outbox;
update notification_prefs set chat = false where user_id = '11111111-1111-1111-1111-111111111111';
insert into chat_messages (bubble_id, sender_id, content) values ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'pref off');
update notification_prefs set chat = true, enabled = false where user_id = '11111111-1111-1111-1111-111111111111';
insert into chat_messages (bubble_id, sender_id, content) values ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'master off');
update notification_prefs set enabled = true where user_id = '11111111-1111-1111-1111-111111111111';
insert into bubble_mutes (user_id, bubble_id, until) values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', now() + interval '1 hour');
insert into chat_messages (bubble_id, sender_id, content) values ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'muted');
insert into chat_messages (bubble_id, sender_id, content) values ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'other bubble not muted');
do $$ begin
  assert (select count(*) from notification_outbox) = 1
     and (select bubble_id from notification_outbox) = 'aaaaaaaa-0000-0000-0000-000000000002', 'pref, master switch and mute respected';
end $$;
delete from notification_outbox;
update bubble_mutes set until = now() - interval '1 minute';
insert into blocks (blocker_id, blocked_id) values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
insert into chat_messages (bubble_id, sender_id, content) values ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'alice blocked bob');
delete from blocks;
insert into blocks (blocker_id, blocked_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');
insert into chat_messages (bubble_id, sender_id, content) values ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'bob blocked alice');
delete from blocks;
update users set status = 'suspended', status_until = now() + interval '1 day' where id = '11111111-1111-1111-1111-111111111111';
insert into chat_messages (bubble_id, sender_id, content) values ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'alice suspended');
update users set status_until = now() - interval '1 second' where id = '11111111-1111-1111-1111-111111111111';
do $$ begin
  assert (select count(*) from notification_outbox) = 0, 'blocks (both ways) and suspension respected';
end $$;
insert into chat_messages (bubble_id, sender_id, content) values ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'suspension over, mute expired');
delete from push_tokens where user_id = '22222222-2222-2222-2222-222222222222';
insert into chat_messages (bubble_id, sender_id, content) values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'bob has no device');
do $$ begin
  assert (select count(*) from notification_outbox) = 1
     and (select recipient_id from notification_outbox) = '11111111-1111-1111-1111-111111111111', 'expired suspension/mute notify again; no device, no row';
end $$;
rollback;

\echo 'push 5. chat coalescing: one row per burst, then at most one push per 30 s'
begin;
:fixture
insert into chat_messages (bubble_id, sender_id, content)
select 'aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'burst ' || g from generate_series(1, 3) g;
do $$
declare v_last uuid;
begin
  select id into v_last from chat_messages where content = 'burst 3';
  assert (select count(*) from notification_outbox where recipient_id = '11111111-1111-1111-1111-111111111111') = 1, 'one row';
  assert (select (payload ->> 'count')::int = 3 and target_id = v_last from notification_outbox), 'count 3, newest message';
end $$;
-- The dispatcher claims it (service role); the next message waits for the 30 s window.
select public.claim_push_batch(10);
insert into chat_messages (bubble_id, sender_id, content) values ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'after claim 1');
insert into chat_messages (bubble_id, sender_id, content) values ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'after claim 2');
do $$
declare a notification_outbox; b notification_outbox;
begin
  select * into a from notification_outbox order by id limit 1;
  select * into b from notification_outbox order by id desc limit 1;
  assert (select count(*) from notification_outbox) = 2, 'second row for the next window';
  assert b.next_attempt_at = a.claimed_at + interval '30 seconds', 'deferred to 30 s after the last push';
  assert (b.payload ->> 'count')::int = 2 and b.collapse_key = a.collapse_key, 'merged, same collapse key';
end $$;
rollback;

\echo 'push 6. join request, approval, new event, food/market (opt-in)'
begin;
:fixture
set local role authenticated;
select set_config('request.jwt.claims', :'carol', true);
select public.request_to_join('CLIMB123');
reset role;
do $$ begin
  assert (select array_agg(recipient_id order by recipient_id) from notification_outbox where type = 'join_request')
       = array['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222']::uuid[], 'members of Climbing Crew';
  assert (select bool_and(actor_id = '33333333-3333-3333-3333-333333333333') from notification_outbox), 'actor is the requester';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', :'alice', true);
select public.approve_join_request((select id from join_requests where bubble_id = 'aaaaaaaa-0000-0000-0000-000000000002'));
select set_config('request.jwt.claims', :'bob', true);
select public.approve_join_request((select id from join_requests where bubble_id = 'aaaaaaaa-0000-0000-0000-000000000002'));
reset role;
do $$ begin
  assert (select array_agg(recipient_id) from notification_outbox where type = 'approval')
       = array['33333333-3333-3333-3333-333333333333']::uuid[], 'the admitted requester';
end $$;
delete from notification_outbox;
insert into events (bubble_id, creator_id, title, datetime) values
  ('aaaaaaaa-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'Climb', now() + interval '2 days');
insert into food_posts (bubble_id, user_id, image, description) values
  ('aaaaaaaa-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'https://x/y.jpg', 'Cake');
update notification_prefs set market = true where user_id = '22222222-2222-2222-2222-222222222222';
insert into market_items (bubble_id, owner_id, image, title) values
  ('aaaaaaaa-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'https://x/y.jpg', 'Rope');
do $$ begin
  assert (select array_agg(recipient_id order by recipient_id) from notification_outbox where type = 'new_event')
       = array['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222']::uuid[], 'event: members but the creator';
  assert (select count(*) from notification_outbox where type = 'food') = 0, 'food is off by default';
  assert (select array_agg(recipient_id) from notification_outbox where type = 'market')
       = array['22222222-2222-2222-2222-222222222222']::uuid[], 'market only for bob, who opted in';
end $$;
rollback;

\echo 'push 7. event reminders: RSVPed users, once, within the hour'
begin;
:fixture
insert into events (id, bubble_id, creator_id, title, datetime, rsvp_list) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Soon', now() + interval '40 minutes', '{11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222}'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Later', now() + interval '3 hours', '{22222222-2222-2222-2222-222222222222}');
delete from notification_outbox;
do $$ begin
  assert public.enqueue_event_reminders() = 2, 'first run: alice (creator, RSVPed) and bob';
  assert public.enqueue_event_reminders() = 0, 'second run: nothing (deduplicated)';
  assert (select count(*) from notification_outbox where type = 'event_reminder'
           and target_id = 'eeeeeeee-0000-0000-0000-000000000001') = 2, 'only the event within the hour';
end $$;
-- Moving the event re-arms its reminder.
update events set datetime = datetime + interval '10 minutes' where id = 'eeeeeeee-0000-0000-0000-000000000001';
do $$ begin
  assert public.enqueue_event_reminders() = 2, 'new start time: reminded again';
end $$;
rollback;

\echo 'push 8. claim/complete: content gone, retries with backoff, invalid tokens deleted'
begin;
:fixture
insert into chat_messages (id, bubble_id, sender_id, content) values
  ('cccccccc-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'to be deleted');
delete from chat_messages where id = 'cccccccc-1111-0000-0000-000000000001';
do $$ begin
  assert jsonb_array_length(public.claim_push_batch(10)) = 0, 'nothing to send';
  assert (select status || '/' || last_error from notification_outbox) = 'skipped/content_gone', 'deleted content is never pushed';
end $$;
delete from notification_outbox;
insert into chat_messages (bubble_id, sender_id, content) values ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'hello');
do $$
declare v jsonb; v_id bigint; v_tok uuid;
begin
  v := public.claim_push_batch(10);
  assert jsonb_array_length(v) = 1, 'claimed';
  assert v -> 0 ->> 'actor_name' = 'Bob' and v -> 0 -> 'data' ->> 'text' = 'hello' and v -> 0 ->> 'bubble_name' = 'Flatmates', 'rendering data';
  assert v -> 0 -> 'tokens' -> 0 ->> 'locale' = 'ro' and v -> 0 -> 'tokens' -> 0 ->> 'apns_env' = 'sandbox', 'token data';
  assert v::text !~ '@', 'no email address anywhere';
  assert jsonb_array_length(public.claim_push_batch(10)) = 0, 'leased: not claimed twice';
  v_id := (v -> 0 ->> 'id')::bigint;
  v_tok := (v -> 0 -> 'tokens' -> 0 ->> 'id')::uuid;
  perform public.complete_push_batch(jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'retry', 'error', 'ios:ServiceUnavailable',
                                                                          'retry_token_ids', jsonb_build_array(v_tok))));
  assert (select status = 'pending' and next_attempt_at between now() + interval '29 seconds' and now() + interval '31 seconds'
                 and token_ids = array[v_tok] from notification_outbox where id = v_id), 'retry in 30 s, failed token only';
  -- Attempts 2..5: backoff doubles; the 5th failure is final.
  for i in 2..5 loop
    update notification_outbox set next_attempt_at = now() where id = v_id;
    assert jsonb_array_length(public.claim_push_batch(10)) = 1, 'claimed again';
    perform public.complete_push_batch(jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'retry', 'error', 'x')));
  end loop;
  assert (select status = 'failed' and attempts = 5 from notification_outbox where id = v_id), 'gives up after 5 attempts';
  perform public.complete_push_batch('[]'::jsonb, array[v_tok]);
  assert not exists (select 1 from push_tokens where id = v_tok), 'invalid token deleted';
end $$;
rollback;

\echo 'push 9. tokens go away on sign-out, device revocation and account deletion'
begin;
update public.app_settings set device_verification_enforced = false, age_confirmation_required = false;
-- A real auth session for alice, so the token is tied to it.
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000a11c', '11111111-1111-1111-1111-111111111111', now(), now());
set local role authenticated;
select set_config('request.jwt.claims', :'alice', true);
select public.start_device_check('boolaa-test-device', 'test');
select public.register_push_token('android', 'android-alice-session-001', p_device_id := 'boolaa-test-device');
select public.register_push_token('android', 'android-alice-other-0001');
do $$ begin
  assert (select count(*) from push_tokens where session_id is not null) = 2, 'tied to the session';
  assert (select count(*) from push_tokens where device_hash is not null) = 1, 'linked to the trusted device';
end $$;
-- The same device registering a rotated token replaces the old one.
select public.register_push_token('android', 'android-alice-session-002', p_device_id := 'boolaa-test-device');
do $$ begin
  assert (select array_agg(token order by token) from push_tokens)
       = array['android-alice-other-0001', 'android-alice-session-002'], 'rotated token replaced';
end $$;
select public.revoke_device(public.device_hash_of('boolaa-test-device'));
do $$ begin
  assert (select array_agg(token) from push_tokens) = array['android-alice-other-0001'], 'revoking the device drops its token';
end $$;
reset role;
delete from auth.sessions where id = '00000000-0000-0000-0000-00000000a11c';  -- sign-out
do $$ begin
  assert (select count(*) from push_tokens where user_id = '11111111-1111-1111-1111-111111111111') = 0, 'sign-out drops the session''s tokens';
end $$;
:fixture
delete from auth.users where id = '33333333-3333-3333-3333-333333333333';  -- account deletion
do $$ begin
  assert (select count(*) from push_tokens where user_id = '33333333-3333-3333-3333-333333333333') = 0, 'account deletion drops tokens';
  assert (select count(*) from notification_prefs where user_id = '33333333-3333-3333-3333-333333333333') = 0, 'and prefs';
end $$;
rollback;

\echo 'push 10. a broken push pipeline never fails the user''s write'
begin;
:fixture
alter table public.notification_outbox rename to notification_outbox_broken;
set local role authenticated;
select set_config('request.jwt.claims', :'bob', true);
insert into chat_messages (bubble_id, sender_id, content) values ('aaaaaaaa-0000-0000-0000-000000000001', auth.uid(), 'still works');
insert into events (bubble_id, creator_id, title, datetime) values ('aaaaaaaa-0000-0000-0000-000000000001', auth.uid(), 'E', now() + interval '1 day');
reset role;
do $$ begin
  assert (select count(*) from chat_messages where content = 'still works') = 1, 'message saved';
end $$;
rollback;

\o
\echo 'push_rls.sql: all push checks passed'
