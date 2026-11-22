-- Data export (GDPR Art. 15 right of access, Art. 20 portability): "Download my data".
-- docs/boolaa-spec.md "Data export", docs/auth-security.md "Flow: download my data".
--
--  1. data_export_requests: one row per export, for the rate limit (1 per user per hour). No client access.
--  2. export_my_data(): security definer, assembles one JSON document about auth.uid() only.
--     Gate: a device-checked session (like delete_my_account) AND a `sensitive_action` code
--     verified in this same session within the last 10 minutes, ALWAYS (not behind
--     device_verification_enforced: the export is a new feature, every client sends the code,
--     and a full copy of someone's data is exactly what a stolen session would want).
--     Raises 'not authenticated', 'session not verified', 'reauthentication required',
--     'export rate limited' (DETAIL = seconds until the next export is allowed).
--  3. Author indexes, so the export (and account deletion's cascade) doesn't scan whole tables.
--
-- The Edge Function `data-export` calls this RPC with the user's JWT, adds a time-limited signed
-- URL (7 days) for each private chat photo and the public URL for public-bucket photos, and
-- returns the file. What is left out, and why, is listed in the document itself ("not_included").

-- 1 -------------------------------------------------------------------------
create table public.data_export_requests (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index data_export_requests_user_created_idx on public.data_export_requests (user_id, created_at desc);
alter table public.data_export_requests enable row level security;
revoke all on public.data_export_requests from anon, authenticated;

-- 3 -------------------------------------------------------------------------
create index if not exists chat_messages_sender_idx on public.chat_messages (sender_id);
create index if not exists events_creator_idx on public.events (creator_id);
create index if not exists food_posts_user_idx on public.food_posts (user_id);
create index if not exists market_items_owner_idx on public.market_items (owner_id);
create index if not exists shared_links_user_idx on public.shared_links (user_id);
create index if not exists reports_reporter_idx on public.reports (reporter_id);

-- 2 -------------------------------------------------------------------------
create or replace function public.export_my_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_session  uuid := public.current_session_id();
  v_last     timestamptz;
  v_member   uuid[];   -- bubbles the user is an approved member of right now
  v_doc      jsonb;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  -- Device check only (like delete_my_account): the right of access doesn't depend on the age
  -- confirmation or on a suspension, so neither is required here.
  if not public.is_device_verified() then
    raise exception 'session not verified' using errcode = '42501';
  end if;
  if v_session is null or not exists (
    select 1 from public.email_challenges
     where user_id = v_uid
       and purpose = 'sensitive_action'
       and session_id = v_session
       and consumed_at > now() - interval '10 minutes'
  ) then
    raise exception 'reauthentication required' using errcode = '42501';
  end if;

  -- Rate limit: one export per user per rolling hour (serialised per user).
  perform pg_advisory_xact_lock(hashtext('data_export:' || v_uid::text));
  select max(created_at) into v_last from public.data_export_requests where user_id = v_uid;
  if v_last is not null and v_last > now() - interval '1 hour' then
    raise exception 'export rate limited'
      using errcode = 'P0001',
            detail = greatest(1, ceil(extract(epoch from (v_last + interval '1 hour' - now()))))::int::text;
  end if;
  delete from public.data_export_requests where created_at < now() - interval '1 year';
  insert into public.data_export_requests (user_id) values (v_uid);

  select coalesce(array_agg(bubble_id), '{}') into v_member
    from public.bubble_members where user_id = v_uid and approved;

  v_doc := jsonb_build_object(
    'format', 'boolaa-data-export',
    'version', 1,
    'generated_at', now(),
    'user_id', v_uid,

    'profile', (
      select jsonb_build_object(
        'id', u.id, 'name', u.name, 'avatar', u.avatar, 'created_at', u.created_at,
        'status', u.status, 'status_reason', u.status_reason, 'status_until', u.status_until,
        'status_changed_at', u.status_changed_at)
        from public.users u where u.id = v_uid),

    'consent', (
      select jsonb_build_object('age_confirmed_at', u.age_confirmed_at, 'terms_version', u.terms_version)
        from public.users u where u.id = v_uid),

    -- Auth account: no password hash, no confirmation / recovery / reauthentication / email
    -- change tokens, no refresh tokens.
    'account', (
      select jsonb_build_object(
        'email', a.email,
        'email_confirmed_at', a.email_confirmed_at,
        'pending_email_change', nullif(a.email_change, ''),
        'phone', nullif(a.phone, ''),
        'created_at', a.created_at,
        'updated_at', a.updated_at,
        'last_sign_in_at', a.last_sign_in_at,
        'banned_until', a.banned_until,
        'sign_in_providers', coalesce(a.raw_app_meta_data -> 'providers', '[]'::jsonb),
        'metadata', coalesce(a.raw_user_meta_data, '{}'::jsonb))
        from auth.users a where a.id = v_uid),

    'sign_in_identities', coalesce((
      select jsonb_agg(jsonb_build_object(
               'provider', i.provider, 'email', i.email, 'created_at', i.created_at,
               'last_sign_in_at', i.last_sign_in_at, 'identity_data', i.identity_data)
             order by i.created_at)
        from auth.identities i where i.user_id = v_uid), '[]'::jsonb),

    -- Active sessions (no session ids or refresh tokens).
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'created_at', s.created_at, 'refreshed_at', coalesce(s.refreshed_at, s.updated_at),
               'user_agent', s.user_agent, 'ip', host(s.ip), 'this_session', s.id = v_session)
             order by s.created_at)
        from auth.sessions s where s.user_id = v_uid), '[]'::jsonb),

    -- The account's own entries in Auth's audit log (last 90 days, newest 500).
    'sign_in_history', coalesce((
      select jsonb_agg(jsonb_build_object('at', l.created_at, 'action', l.payload ->> 'action', 'ip', nullif(l.ip_address, ''))
             order by l.created_at desc)
        from (select * from auth.audit_log_entries
               where payload ->> 'actor_id' = v_uid::text and created_at > now() - interval '90 days'
               order by created_at desc limit 500) l), '[]'::jsonb),

    -- Trusted devices: the stored hash of the device id is shortened to an 8-character hint.
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object(
               'label', d.label, 'device_hash_hint', left(d.device_hash, 8),
               'created_at', d.created_at, 'last_seen_at', d.last_seen_at)
             order by d.last_seen_at desc)
        from public.trusted_devices d where d.user_id = v_uid), '[]'::jsonb),

    -- Emailed codes (device / sensitive action): when, not the code or its hash.
    'security_codes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'purpose', c.purpose, 'created_at', c.created_at, 'expires_at', c.expires_at,
               'used_at', c.consumed_at, 'attempts', c.attempts)
             order by c.created_at desc)
        from public.email_challenges c where c.user_id = v_uid), '[]'::jsonb),

    'password_reset_grants', coalesce((
      select jsonb_agg(g.granted_at order by g.granted_at desc)
        from public.auth_recovery_grants g where g.user_id = v_uid), '[]'::jsonb),

    -- Push tokens are redacted to their last 4 characters; web subscriptions to the push
    -- service's host; the encryption keys (p256dh, auth) are left out.
    'push_tokens', coalesce((
      select jsonb_agg(jsonb_build_object(
               'platform', p.platform,
               'token_hint', case when p.platform = 'web'
                                  then substring(p.endpoint from '^https?://([^/:]+)')
                                  else '…' || right(p.token, 4) end,
               'apns_environment', p.apns_env, 'device_hash_hint', left(p.device_hash, 8),
               'locale', p.locale, 'app_version', p.app_version,
               'created_at', p.created_at, 'last_seen_at', p.last_seen_at)
             order by p.created_at)
        from public.push_tokens p where p.user_id = v_uid), '[]'::jsonb),

    'notification_preferences', (
      select to_jsonb(n) - 'user_id' from public.notification_prefs n where n.user_id = v_uid),

    'muted_bubbles', coalesce((
      select jsonb_agg(jsonb_build_object('bubble_id', m.bubble_id, 'until', m.until, 'created_at', m.created_at)
             order by m.created_at)
        from public.bubble_mutes m where m.user_id = v_uid), '[]'::jsonb),

    -- Notifications queued for the user: type and delivery only (the payload quotes other
    -- members' content and names).
    'notifications', coalesce((
      select jsonb_agg(jsonb_build_object(
               'type', o.type, 'bubble_id', o.bubble_id, 'created_at', o.created_at,
               'status', o.status, 'sent_at', o.sent_at)
             order by o.created_at desc)
        from public.notification_outbox o where o.recipient_id = v_uid), '[]'::jsonb),

    -- Memberships. Bubble name and photo only (the bubble's own record), for every membership row.
    'bubble_memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
               'bubble_id', bm.bubble_id, 'bubble_name', b.name, 'bubble_photo', b.logo,
               'role', bm.role, 'approved', bm.approved, 'joined_at', bm.created_at,
               'created_by_you', b.created_by = v_uid)
             order by bm.created_at)
        from public.bubble_members bm join public.bubbles b on b.id = bm.bubble_id
       where bm.user_id = v_uid), '[]'::jsonb),

    -- The user's own requests (approvals as a count: who voted is the voters' business).
    'join_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'bubble_id', r.bubble_id, 'bubble_name', b.name,
               'approvals', cardinality(r.approver_ids), 'created_at', r.created_at)
             order by r.created_at)
        from public.join_requests r join public.bubbles b on b.id = r.bubble_id
       where r.user_id = v_uid), '[]'::jsonb),

    -- Votes the user cast on other people's open requests (not who asked).
    'join_request_approvals', coalesce((
      select jsonb_agg(jsonb_build_object('request_id', r.id, 'bubble_id', r.bubble_id) order by r.created_at)
        from public.join_requests r where v_uid = any (r.approver_ids)), '[]'::jsonb),

    'chat_read_markers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'bubble_id', cr.bubble_id, 'last_read_at', cr.last_read_at,
               'last_read_message_id', cr.last_read_message_id)
             order by cr.bubble_id)
        from public.chat_reads cr where cr.user_id = v_uid), '[]'::jsonb),

    -- Every message the user wrote. A deleted message keeps only its metadata: its text and photo
    -- were wiped when it was deleted.
    'chat_messages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'bubble_id', m.bubble_id,
               'content', case when m.deleted_at is null then m.content end, 'photo_path', m.image_path,
               'created_at', m.created_at, 'deleted_at', m.deleted_at)
             order by m.created_at, m.id)
        from public.chat_messages m where m.sender_id = v_uid), '[]'::jsonb),

    -- Events the user created; the RSVP list as a count plus whether the user is going.
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'bubble_id', e.bubble_id, 'title', e.title, 'description', e.description,
               'datetime', e.datetime, 'location', e.location, 'created_at', e.created_at,
               'rsvp_count', cardinality(e.rsvp_list), 'you_are_going', v_uid = any (e.rsvp_list))
             order by e.datetime)
        from public.events e where e.creator_id = v_uid), '[]'::jsonb),

    -- Events (by others) the user said they're going to. The title is the other member's content:
    -- shown only while the user can still see the event (approved member, no block either way).
    'rsvps', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event_id', e.id, 'bubble_id', e.bubble_id, 'datetime', e.datetime,
               'title', case when e.bubble_id = any (v_member) and not public.is_blocked_with(e.creator_id)
                             then e.title end)
             order by e.datetime)
        from public.events e where v_uid = any (e.rsvp_list) and e.creator_id <> v_uid), '[]'::jsonb),

    'food_posts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id, 'bubble_id', f.bubble_id, 'description', f.description, 'photo', f.image,
               'created_at', f.created_at)
             order by f.created_at)
        from public.food_posts f where f.user_id = v_uid), '[]'::jsonb),

    'market_items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', mi.id, 'bubble_id', mi.bubble_id, 'title', mi.title, 'description', mi.description,
               'photo', mi.image, 'status', mi.status, 'availability', mi.availability,
               'created_at', mi.created_at)
             order by mi.created_at)
        from public.market_items mi where mi.owner_id = v_uid), '[]'::jsonb),

    'shared_links', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'bubble_id', l.bubble_id, 'url', l.url, 'title', l.title, 'tags', l.tags,
               'created_at', l.created_at)
             order by l.created_at)
        from public.shared_links l where l.user_id = v_uid), '[]'::jsonb),

    -- Reactions the user gave (what they reacted to by type and id, not the content).
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'bubble_id', x.bubble_id, 'reaction', x.reaction,
               'target_type', x.target_type, 'target_id', x.target_id, 'created_at', x.created_at)
             order by x.created_at)
        from public.reactions x where x.user_id = v_uid), '[]'::jsonb),

    -- Reports the user filed, with their outcome; the moderator's internal note is left out.
    'reports_filed', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'bubble_id', r.bubble_id, 'target_type', r.target_type, 'target_id', r.target_id,
               'reported_user_id', r.reported_user_id, 'reason', r.reason, 'details', r.details,
               'status', r.status, 'created_at', r.created_at, 'handled_at', r.handled_at)
             order by r.created_at)
        from public.reports r where r.reporter_id = v_uid), '[]'::jsonb),

    -- People the user blocked (ids; never who blocked the user).
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object('blocked_user_id', bl.blocked_id, 'created_at', bl.created_at)
             order by bl.created_at)
        from public.blocks bl where bl.blocker_id = v_uid), '[]'::jsonb),

    'invite_code_failures', coalesce((
      select jsonb_agg(f.at order by f.at desc)
        from public.invite_lookup_failures f where f.user_id = v_uid), '[]'::jsonb),

    'moderator', jsonb_build_object('is_moderator', exists (select 1 from public.admins a where a.user_id = v_uid)),

    'previous_exports', coalesce((
      select jsonb_agg(d.created_at order by d.created_at desc)
        from public.data_export_requests d where d.user_id = v_uid), '[]'::jsonb),

    -- Photos the user uploaded: everything in their own folder of the per-user buckets
    -- (bubble photos belong to the bubble; link previews are made by the server).
    'files', coalesce((
      select jsonb_agg(jsonb_build_object(
               'bucket', o.bucket_id, 'path', o.name,
               'size', (o.metadata ->> 'size')::bigint, 'content_type', o.metadata ->> 'mimetype',
               'created_at', o.created_at)
             order by o.bucket_id, o.created_at)
        from storage.objects o
       where o.bucket_id in ('avatars', 'food.images', 'market.images', 'chat.images')
         and (storage.foldername(o.name))[1] = v_uid::text), '[]'::jsonb),

    'not_included', jsonb_build_array(
      'Other members'' messages, posts, names and photos, and content in bubbles you are not in.',
      'Who blocked you, and reports other people filed about you: they contain the reporters'' identity and words (GDPR Art. 15(4)). Your account status above shows any action taken. Ask privacy@boolaa.ro for the moderation records about you, with other people''s details removed.',
      'Copies of a message kept as evidence for an open report, and moderators'' internal notes.',
      'Passwords (only a hash is stored), sign-in, refresh and confirmation tokens, emailed codes and their hashes, device ids (only a hint of their hash is shown), push encryption keys.',
      'Bubble photos (they belong to the bubble) and link preview images (made by the server from public pages).',
      'Server logs kept for security and operations (for example request logs), which are short-lived. Ask privacy@boolaa.ro if you need them.'
    )
  );

  return v_doc;
end;
$$;
revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
