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
