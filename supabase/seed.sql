-- Local dev seed (applied by `supabase db reset`). NOT for production.
-- Logins: alice@boolaa.test / bob@boolaa.test / carol@boolaa.test, password: password123

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change, email_change_token_new)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
   'alice@boolaa.test', crypt('password123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"name":"Alice"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated',
   'bob@boolaa.test', crypt('password123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"name":"Bob"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated',
   'carol@boolaa.test', crypt('password123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"name":"Carol"}', now(), now(), '', '', '', '');

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u where u.email like '%@boolaa.test';

-- Two bubbles: Alice owns "Flatmates" (Bob is a member); Bob owns "Climbing Crew".
insert into public.bubbles (id, name, description, max_size, invite_code, created_by) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Flatmates', 'Our shared flat on Rose St.', 8, 'FLAT2026', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Climbing Crew', 'Tuesday bouldering', 12, 'CLIMB123', '22222222-2222-2222-2222-222222222222');

insert into public.bubble_members (user_id, bubble_id, approved, role) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', true, 'owner'),
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001', true, 'member'),
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000002', true, 'owner'),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', true, 'member');

-- Carol has asked to join Flatmates (pending approval).
insert into public.join_requests (user_id, bubble_id) values
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.chat_messages (bubble_id, sender_id, content, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Who took the last oat milk? 🥛', now() - interval '2 hours'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Guilty. Buying more today.', now() - interval '1 hour'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Same time Tuesday?', now() - interval '30 minutes');

insert into public.events (bubble_id, creator_id, title, description, datetime, location, rsvp_list) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Flat dinner', 'Potluck, bring a dish', now() + interval '3 days', 'Kitchen', '{11111111-1111-1111-1111-111111111111}'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Bouldering session', null, now() + interval '5 days', 'The Climbing Hangar', '{}');

insert into public.food_posts (bubble_id, user_id, image, description) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800', 'Leftover salad in the fridge, help yourselves');

insert into public.market_items (bubble_id, owner_id, image, title, description, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800', 'Old sofa', 'Comfy, needs a new home', 'free');

insert into public.shared_links (bubble_id, user_id, url, title, tags) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'https://www.bbcgoodfood.com/recipes/collection/budget-recipes', 'Budget recipes', '{food,cheap}');

-- Device verification (docs/auth-security.md): the device id "boolaa-test-device"
-- is pre-trusted for alice, bob and carol, so client test suites that send it to
-- start_device_check pass straight through without an emailed code.
insert into public.trusted_devices (user_id, device_hash, label)
select u.id, encode(extensions.digest('boolaa-test-device', 'sha256'), 'hex'), 'Seeded test device'
from auth.users u where u.email in ('alice@boolaa.test', 'bob@boolaa.test', 'carol@boolaa.test');

-- Moderation alerts (docs/moderation.md): local function URL and shared secret.
-- The secret must equal REPORT_ALERT_SECRET in supabase/functions/.env.
select vault.create_secret('http://kong:8000/functions/v1/report-alert', 'report_alert_url');
select vault.create_secret('local-report-alert-secret-change-me', 'report_alert_secret');

-- Moderation (docs/moderation.md). mod@boolaa.test is an admin (public.admins) and belongs to
-- no bubble. Dave and Erin share "Book Club"; Erin has reported one of Dave's messages (21 h
-- ago, so the admin queue shows it as close to the 24 h limit) and Dave's profile.
-- Logins: mod@ / dave@ / erin@boolaa.test, password: password123.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change, email_change_token_new)
values
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated',
   'mod@boolaa.test', crypt('password123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"name":"Moderator","age_confirmed":"true"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated',
   'dave@boolaa.test', crypt('password123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"name":"Dave","age_confirmed":"true"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '66666666-6666-6666-6666-666666666666', 'authenticated', 'authenticated',
   'erin@boolaa.test', crypt('password123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"name":"Erin","age_confirmed":"true"}', now(), now(), '', '', '', '');

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u where u.email in ('mod@boolaa.test', 'dave@boolaa.test', 'erin@boolaa.test');

insert into public.admins (user_id) values ('44444444-4444-4444-4444-444444444444');

insert into public.trusted_devices (user_id, device_hash, label)
select u.id, encode(extensions.digest('boolaa-test-device', 'sha256'), 'hex'), 'Seeded test device'
from auth.users u where u.email in ('mod@boolaa.test', 'dave@boolaa.test', 'erin@boolaa.test');

insert into public.bubbles (id, name, description, max_size, invite_code, created_by) values
  ('aaaaaaaa-0000-0000-0000-000000000003', 'Book Club', 'One book a month', 12, 'BOOK2026', '66666666-6666-6666-6666-666666666666');
insert into public.bubble_members (user_id, bubble_id, approved, role) values
  ('66666666-6666-6666-6666-666666666666', 'aaaaaaaa-0000-0000-0000-000000000003', true, 'owner'),
  ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-0000-0000-0000-000000000003', true, 'member');

insert into public.chat_messages (id, bubble_id, sender_id, content, created_at) values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003', '66666666-6666-6666-6666-666666666666', 'Next pick: The Left Hand of Darkness?', now() - interval '23 hours'),
  ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555555', 'Boring. Pick something else.', now() - interval '22 hours 30 minutes'),
  ('cccccccc-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000003', '66666666-6666-6666-6666-666666666666', 'Happy to vote on it.', now() - interval '22 hours'),
  ('cccccccc-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555555', 'Nobody cares what you think, Erin. Leave the group.', now() - interval '21 hours 30 minutes'),
  ('cccccccc-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000003', '66666666-6666-6666-6666-666666666666', 'That is not ok.', now() - interval '21 hours 20 minutes'),
  ('cccccccc-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555555', 'Whatever.', now() - interval '21 hours 10 minutes');

-- alert_sent_at is set so the seed doesn't email the moderation inbox.
insert into public.reports (id, reporter_id, bubble_id, target_type, target_id, reported_user_id, reason, details, created_at, alert_sent_at) values
  ('dddddddd-0000-0000-0000-000000000001', '66666666-6666-6666-6666-666666666666', 'aaaaaaaa-0000-0000-0000-000000000003',
   'chat_message', 'cccccccc-0000-0000-0000-000000000004', '55555555-5555-5555-5555-555555555555', 'harassment',
   'He keeps telling me to leave.', now() - interval '21 hours', now()),
  ('dddddddd-0000-0000-0000-000000000002', '66666666-6666-6666-6666-666666666666', 'aaaaaaaa-0000-0000-0000-000000000003',
   'user', '55555555-5555-5555-5555-555555555555', '55555555-5555-5555-5555-555555555555', 'harassment',
   null, now() - interval '2 hours', now());

-- Push notifications (docs/push-notifications.md): local dispatcher URL and shared secret.
-- The secret must equal PUSH_DISPATCH_SECRET in supabase/functions/.env. The seed registers
-- no push tokens, so nothing above was queued.
select vault.create_secret('http://kong:8000/functions/v1/push-dispatch', 'push_dispatch_url');
select vault.create_secret('local-push-dispatch-secret-change-me', 'push_dispatch_secret');
