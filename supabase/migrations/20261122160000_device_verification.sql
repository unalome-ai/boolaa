-- Device verification (emailed code at sign-in on a new device), re-confirmation
-- of sensitive actions, and server-side age confirmation (16+).
-- Contract and rollout: docs/auth-security.md.
--
--  1. app_settings: single-row feature flags. Both flags default to OFF, so this
--     migration changes nothing for existing clients until a later one-line update.
--  2. trusted_devices / verified_sessions / email_challenges (RLS on, no client policies).
--  3. is_session_verified(): enforcement off, OR session verified by code, OR the
--     JWT `amr` shows an email-proven session.
--  4. Enforcement: is_bubble_member / shares_bubble_with, a RESTRICTIVE policy on every
--     client-visible table and on storage.objects, and an explicit check in every RPC.
--  5. RPCs: start_device_check, list_my_devices, revoke_device; service-role-only helpers
--     used by the `device-code` Edge Function.
--  6. delete_my_account() now needs a fresh `sensitive_action` code.
--  7. users.age_confirmed_at / terms_version + before-user-created auth hook.

-- 1 -------------------------------------------------------------------------
create table public.app_settings (
  id                            boolean primary key default true check (id),
  device_verification_enforced  boolean not null default false,
  age_confirmation_required     boolean not null default false,
  updated_at                    timestamptz not null default now()
);
insert into public.app_settings (id) values (true);
alter table public.app_settings enable row level security;
-- No policies: only the service role / security definer functions read it.

-- Age confirmation (16+), set at sign-up or by confirm_age(); see section 7.
alter table public.users
  add column age_confirmed_at timestamptz,
  add column terms_version    text check (char_length(terms_version) <= 32);

-- 2 -------------------------------------------------------------------------
-- device_hash = lowercase hex sha256 of the client's device secret (never stored).
create table public.trusted_devices (
  user_id       uuid not null references auth.users (id) on delete cascade,
  device_hash   text not null check (device_hash ~ '^[0-9a-f]{64}$'),
  label         text check (char_length(label) <= 120),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (user_id, device_hash)
);

-- session_id = auth.jwt()->>'session_id' (= auth.sessions.id, stable across refreshes).
-- Rows disappear with the session (sign-out, expiry) through the cascade.
create table public.verified_sessions (
  session_id  uuid primary key references auth.sessions (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index verified_sessions_user_idx on public.verified_sessions (user_id);

-- One row per code sent. code_hash = hex HMAC-SHA256 keyed with the Edge Function
-- secret DEVICE_CODE_SECRET; the plaintext code is never stored.
-- session_id: the session that asked for the code. A `sensitive_action` proof only
-- authorises that same session.
create table public.email_challenges (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  purpose      text not null check (purpose in ('device', 'sensitive_action')),
  device_hash  text check (device_hash ~ '^[0-9a-f]{64}$'),
  session_id   uuid,
  code_hash    text not null,
  expires_at   timestamptz not null,
  attempts     int not null default 0,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now(),
  check (purpose <> 'device' or device_hash is not null)
);
create index email_challenges_user_created_idx on public.email_challenges (user_id, created_at desc);
create index email_challenges_created_idx on public.email_challenges (created_at);

alter table public.trusted_devices   enable row level security;
alter table public.verified_sessions enable row level security;
alter table public.email_challenges  enable row level security;
-- No policies on purpose: clients use the RPCs below; the Edge Function uses the service role.
revoke all on public.app_settings, public.trusted_devices, public.verified_sessions, public.email_challenges
  from anon, authenticated;

-- 3 -------------------------------------------------------------------------
-- The JWT `amr` methods that count as a verified session (single list; see
-- docs/auth-security.md). Measured on the local GoTrue v2.186: every email OTP and
-- email link flow (signup confirmation, magic link, recovery, invite) emits "otp".
-- "magiclink", "recovery", "invite", "email/signup", "email_change" are the names
-- other GoTrue versions use for the same flows. Sign in with Apple / Google
-- (signInWithIdToken or OAuth redirect) is expected to emit "oauth" (GoTrue's
-- models.OAuth; not measurable locally without provider credentials); "id_token"
-- is listed defensively. NOT included: "password", "anonymous", "token_refresh"
-- (and "otp" would also cover phone OTP if SMS sign-in is ever enabled).
create function public.verified_amr_methods()
returns text[]
language sql
immutable
as $$
  select array['otp', 'magiclink', 'recovery', 'invite', 'email/signup', 'email_change',
               'oauth', 'id_token']::text[];
$$;

create function public.is_amr_proven_session()
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from jsonb_array_elements(
           case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) a
    where a ->> 'method' = any (public.verified_amr_methods())
  );
$$;

create function public.current_session_id()
returns uuid
language sql
stable
set search_path = public
as $$
  select nullif(auth.jwt() ->> 'session_id', '')::uuid;
$$;

-- Device part only: enforcement off, or the session passed the device check
-- (code, trusted device, or an email/OAuth-proven sign-in).
create function public.is_device_verified()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
         not coalesce((select device_verification_enforced from public.app_settings where id), false)
      or exists (select 1 from public.verified_sessions
                  where session_id = public.current_session_id() and user_id = auth.uid())
      or public.is_amr_proven_session()
  );
$$;

-- True when the caller's account has confirmed the age requirement, or it isn't enforced.
create function public.is_age_confirmed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not coalesce((select age_confirmation_required from public.app_settings where id), false)
      or exists (select 1 from public.users where id = auth.uid() and age_confirmed_at is not null);
$$;

-- Used by every RLS policy and RPC: device verified AND age confirmed.
create function public.is_session_verified()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_device_verified() and public.is_age_confirmed();
$$;

-- Raised by every RPC when the session still needs its device code.
create function public.require_verified_session()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_device_verified() then
    raise exception 'session not verified' using errcode = '42501';
  end if;
  if not public.is_age_confirmed() then
    raise exception 'age confirmation required' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public.is_amr_proven_session(), public.current_session_id(),
  public.is_device_verified(), public.is_age_confirmed(), public.is_session_verified(),
  public.require_verified_session() from public, anon;
grant execute on function public.is_amr_proven_session(), public.current_session_id(),
  public.is_device_verified(), public.is_age_confirmed(), public.is_session_verified(),
  public.require_verified_session() to authenticated, service_role;

-- 4 -------------------------------------------------------------------------
create or replace function public.is_bubble_member(p_bubble_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_session_verified() and exists (
    select 1 from public.bubble_members
    where bubble_id = p_bubble_id and user_id = auth.uid() and approved
  );
$$;

create or replace function public.shares_bubble_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_session_verified() and (
         p_user_id = auth.uid()
      or exists (
        select 1
        from public.bubble_members me
        join public.bubble_members them on them.bubble_id = me.bubble_id
        where me.user_id = auth.uid() and me.approved
          and them.user_id = p_user_id
      )
      or exists (
        select 1
        from public.join_requests jr
        join public.bubble_members me on me.bubble_id = jr.bubble_id
        where jr.user_id = p_user_id and me.user_id = auth.uid() and me.approved
      ));
$$;

-- A RESTRICTIVE policy is ANDed with every permissive policy of the table, so it
-- also covers the own-row policies (users, blocks, reports, bubble_members,
-- join_requests, and update/delete-own on content) without rewriting each one.
-- Realtime postgres_changes evaluates these with the subscriber's JWT too.
do $$
declare t text;
begin
  foreach t in array array['users', 'bubbles', 'bubble_members', 'join_requests', 'chat_messages',
                           'events', 'food_posts', 'market_items', 'shared_links', 'blocks', 'reports']
  loop
    execute format(
      'create policy require_verified_session on public.%I as restrictive for all to authenticated
         using ((select public.is_session_verified())) with check ((select public.is_session_verified()))', t);
  end loop;
end $$;

create policy "images: require verified session" on storage.objects as restrictive for all to authenticated
  using ((select public.is_session_verified())) with check ((select public.is_session_verified()));

-- Same RPC bodies as before, plus the verified-session check.
create or replace function public.create_bubble(p_name text, p_description text default null, p_max_size int default 12)
returns public.bubbles
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bubbles;
begin
  perform public.require_verified_session();
  insert into public.bubbles (name, description, max_size, created_by)
  values (trim(p_name), nullif(trim(p_description), ''), coalesce(p_max_size, 12), auth.uid())
  returning * into b;
  insert into public.bubble_members (user_id, bubble_id, approved, role)
  values (auth.uid(), b.id, true, 'owner');
  return b;
end;
$$;

create or replace function public.request_to_join(p_invite_code text)
returns public.join_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  b  public.bubbles;
  jr public.join_requests;
begin
  perform public.require_verified_session();
  select * into b from public.bubbles where invite_code = upper(trim(p_invite_code));
  if not found then raise exception 'invalid invite code'; end if;
  if exists (select 1 from public.bubble_members where bubble_id = b.id and user_id = auth.uid() and approved) then
    raise exception 'already a member';
  end if;
  if (select count(*) from public.bubble_members where bubble_id = b.id and approved) >= b.max_size then
    raise exception 'bubble is full';
  end if;
  insert into public.join_requests (user_id, bubble_id)
  values (auth.uid(), b.id)
  on conflict (user_id, bubble_id) do update set user_id = excluded.user_id
  returning * into jr;
  return jr;
end;
$$;

create or replace function public.approve_join_request(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  jr public.join_requests;
begin
  perform public.require_verified_session();
  select * into jr from public.join_requests where id = p_request_id for update;
  if not found then raise exception 'request not found'; end if;
  if not public.is_bubble_member(jr.bubble_id) then raise exception 'not a member of this bubble'; end if;

  update public.join_requests
     set approver_ids = array(select distinct unnest(approver_ids || auth.uid()))
   where id = jr.id;

  return public.try_admit_join_request(jr.id);
end;
$$;

create or replace function public.reject_join_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  jr public.join_requests;
begin
  perform public.require_verified_session();
  select * into jr from public.join_requests where id = p_request_id;
  if not found then return; end if;
  if not public.is_bubble_member(jr.bubble_id) then raise exception 'not a member of this bubble'; end if;
  delete from public.join_requests where id = p_request_id;
end;
$$;

create or replace function public.toggle_rsvp(p_event_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.events;
begin
  perform public.require_verified_session();
  select * into e from public.events where id = p_event_id for update;
  if not found or not public.is_bubble_member(e.bubble_id) then raise exception 'event not found'; end if;
  update public.events
     set rsvp_list = case when auth.uid() = any(rsvp_list)
                          then array_remove(rsvp_list, auth.uid())
                          else rsvp_list || auth.uid() end
   where id = p_event_id
   returning rsvp_list into e.rsvp_list;
  return e.rsvp_list;
end;
$$;

create or replace function public.remove_member(p_bubble_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_verified_session();
  if not exists (select 1 from public.bubble_members
                  where bubble_id = p_bubble_id and user_id = auth.uid() and approved and role = 'owner') then
    raise exception 'only the owner can remove members';
  end if;
  if p_user_id = auth.uid() then raise exception 'use leave to remove yourself'; end if;
  delete from public.bubble_members where bubble_id = p_bubble_id and user_id = p_user_id;
  if not found then raise exception 'member not found'; end if;
end;
$$;

create or replace function public.report_content(p_target_type text, p_target_id uuid, p_reason text, p_details text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bubble uuid;
  v_author uuid;
  v_id     uuid;
begin
  perform public.require_verified_session();

  case p_target_type
    when 'chat_message' then select bubble_id, sender_id  into v_bubble, v_author from chat_messages where id = p_target_id;
    when 'event'        then select bubble_id, creator_id into v_bubble, v_author from events        where id = p_target_id;
    when 'food_post'    then select bubble_id, user_id    into v_bubble, v_author from food_posts    where id = p_target_id;
    when 'market_item'  then select bubble_id, owner_id   into v_bubble, v_author from market_items  where id = p_target_id;
    when 'shared_link'  then select bubble_id, user_id    into v_bubble, v_author from shared_links  where id = p_target_id;
    when 'user'         then v_author := p_target_id;
    else raise exception 'invalid report target';
  end case;

  if v_author is null then raise exception 'report target not found'; end if;
  if v_author = auth.uid() then raise exception 'cannot report yourself'; end if;
  if p_target_type = 'user' then
    if not public.shares_bubble_with(v_author) then raise exception 'report target not found'; end if;
  elsif not public.is_bubble_member(v_bubble) then
    raise exception 'report target not found';
  end if;

  insert into public.reports (reporter_id, bubble_id, target_type, target_id, reported_user_id, reason, details)
  values (auth.uid(), v_bubble, p_target_type, p_target_id, v_author, p_reason, nullif(trim(p_details), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- 5 -------------------------------------------------------------------------
-- Internal: trust a device for a user, keeping at most 10 (least recently seen go first).
create function public.trust_device(p_user_id uuid, p_device_hash text, p_label text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.trusted_devices (user_id, device_hash, label)
  values (p_user_id, p_device_hash, nullif(left(trim(p_label), 120), ''))
  on conflict (user_id, device_hash) do update
    set last_seen_at = now(),
        label = coalesce(nullif(left(trim(excluded.label), 120), ''), public.trusted_devices.label);

  delete from public.trusted_devices
   where user_id = p_user_id
     and device_hash in (select device_hash from public.trusted_devices
                          where user_id = p_user_id
                          order by last_seen_at desc, created_at desc
                          offset 10);
end;
$$;

create function public.mark_session_verified(p_user_id uuid, p_session_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.verified_sessions (session_id, user_id)
  select p_session_id, p_user_id
   where p_session_id is not null
     and exists (select 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_user_id)
  on conflict (session_id) do nothing;
$$;

create function public.device_hash_of(p_device_id text)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(extensions.digest(convert_to(p_device_id, 'UTF8'), 'sha256'), 'hex');
$$;

-- Called by every client right after sign-in AND whenever it restores a session.
-- Returns {"status":"verified"|"code_required", "needs_age_confirmation": bool}. Never sends email:
-- on code_required the client calls the device-code Edge Function (action "send").
-- Deliberately independent of app_settings.device_verification_enforced, so devices
-- get trusted before enforcement is switched on.
create function public.start_device_check(p_device_id text, p_label text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_sid  uuid := public.current_session_id();
  v_hash text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_device_id is null or char_length(p_device_id) not between 16 and 512 then
    raise exception 'invalid device id';
  end if;
  v_hash := public.device_hash_of(p_device_id);

  if exists (select 1 from public.trusted_devices where user_id = v_uid and device_hash = v_hash)
     or public.is_amr_proven_session()
     or exists (select 1 from public.verified_sessions where session_id = v_sid and user_id = v_uid) then
    -- Known device, or this session already proved the mailbox: (re)trust and verify.
    perform public.trust_device(v_uid, v_hash, p_label);
    perform public.mark_session_verified(v_uid, v_sid);
    return jsonb_build_object('status', 'verified',
                              'needs_age_confirmation', not public.is_age_confirmed());
  end if;

  return jsonb_build_object('status', 'code_required',
                            'needs_age_confirmation', not public.is_age_confirmed());
end;
$$;

-- "Your devices". device_hash identifies the row; a client marks its own row by
-- comparing with sha256(its device id).
create function public.list_my_devices()
returns table (device_hash text, label text, created_at timestamptz, last_seen_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_verified_session();
  return query
    select d.device_hash, d.label, d.created_at, d.last_seen_at
      from public.trusted_devices d
     where d.user_id = auth.uid()
     order by d.last_seen_at desc;
end;
$$;

-- Untrust a device. Also drops every verified session of the user except the
-- caller's, so other signed-in devices must pass start_device_check again
-- (still-trusted devices pass straight through; the revoked one needs a code).
create function public.revoke_device(p_device_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found boolean;
begin
  perform public.require_verified_session();
  delete from public.trusted_devices where user_id = auth.uid() and device_hash = lower(p_device_hash);
  v_found := found;
  delete from public.verified_sessions
   where user_id = auth.uid() and session_id is distinct from public.current_session_id();
  return v_found;
end;
$$;

revoke execute on function public.start_device_check(text, text), public.list_my_devices(),
  public.revoke_device(text) from public, anon;
grant execute on function public.start_device_check(text, text), public.list_my_devices(),
  public.revoke_device(text) to authenticated;

-- Service-role helpers used by the device-code Edge Function --------------------

-- Records a new code. Enforces 5 sends per user per rolling hour (all purposes),
-- supersedes older open codes of the same purpose and prunes old rows.
create function public.issue_email_challenge(
  p_user_id uuid, p_session_id uuid, p_purpose text, p_device_hash text, p_code_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id      uuid;
  v_expires timestamptz := now() + interval '10 minutes';
begin
  -- Serialise sends per user so the hourly cap can't be raced.
  perform pg_advisory_xact_lock(hashtext('email_challenge:' || p_user_id::text));

  delete from public.email_challenges where created_at < now() - interval '1 day';

  if (select count(*) from public.email_challenges
       where user_id = p_user_id and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'rate_limited';
  end if;

  update public.email_challenges
     set expires_at = least(expires_at, now())
   where user_id = p_user_id and purpose = p_purpose and consumed_at is null and expires_at > now();

  insert into public.email_challenges (user_id, purpose, device_hash, session_id, code_hash, expires_at)
  values (p_user_id, p_purpose, p_device_hash, p_session_id, p_code_hash, v_expires)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'expires_at', v_expires);
end;
$$;

-- Spends one attempt on the newest code of this purpose (and device) and returns
-- its hash for the constant-time comparison done in the Edge Function.
create function public.attempt_email_challenge(
  p_user_id uuid, p_session_id uuid, p_purpose text, p_device_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.email_challenges;
begin
  select * into c
    from public.email_challenges
   where user_id = p_user_id and purpose = p_purpose
     and (p_purpose <> 'device' or device_hash = p_device_hash)
     and (p_purpose <> 'sensitive_action' or session_id = p_session_id)
   order by created_at desc
   limit 1
   for update;

  if not found or c.consumed_at is not null then raise exception 'no_active_code'; end if;
  if c.attempts >= 5 then raise exception 'too_many_attempts'; end if;
  if c.expires_at <= now() then raise exception 'code_expired'; end if;

  update public.email_challenges set attempts = attempts + 1 where id = c.id;
  return jsonb_build_object('id', c.id, 'code_hash', c.code_hash, 'attempts_left', 4 - c.attempts);
end;
$$;

-- Marks a code as used. For a device code: trust the device and verify the session.
create function public.complete_email_challenge(p_challenge_id uuid, p_session_id uuid, p_label text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.email_challenges;
begin
  update public.email_challenges
     set consumed_at = now()
   where id = p_challenge_id and consumed_at is null and expires_at > now()
  returning * into c;
  if not found then raise exception 'no_active_code'; end if;

  if c.purpose = 'device' then
    perform public.trust_device(c.user_id, c.device_hash, p_label);
    perform public.mark_session_verified(c.user_id, p_session_id);
  end if;
  return jsonb_build_object('status', 'verified', 'purpose', c.purpose);
end;
$$;

revoke execute on function public.trust_device(uuid, text, text), public.mark_session_verified(uuid, uuid),
  public.issue_email_challenge(uuid, uuid, text, text, text),
  public.attempt_email_challenge(uuid, uuid, text, text),
  public.complete_email_challenge(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.issue_email_challenge(uuid, uuid, text, text, text),
  public.attempt_email_challenge(uuid, uuid, text, text),
  public.complete_email_challenge(uuid, uuid, text) to service_role;

-- 6 -------------------------------------------------------------------------
-- Needs a `sensitive_action` code verified in this same session in the last 10
-- minutes (device-code function, purpose "sensitive_action") once enforcement is on.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  -- Device check only: an account that hasn't confirmed its age may still delete itself.
  if not public.is_device_verified() then
    raise exception 'session not verified' using errcode = '42501';
  end if;
  -- Behind the same rollout flag, so today's clients (which don't send a code)
  -- keep working until device_verification_enforced is switched on.
  if coalesce((select device_verification_enforced from public.app_settings where id), false)
     and not exists (
    select 1 from public.email_challenges
     where user_id = auth.uid()
       and purpose = 'sensitive_action'
       and session_id = public.current_session_id()
       and consumed_at > now() - interval '10 minutes'
  ) then
    raise exception 'reauthentication required' using errcode = '42501';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke execute on function public.delete_my_account() from public, anon;

-- 7 -------------------------------------------------------------------------
-- Clients may update only their name and avatar (age/terms are set at sign-up).
revoke update on public.users from anon, authenticated;
grant update (name, avatar) on public.users to authenticated;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, name, avatar, age_confirmed_at, terms_version)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''),
             nullif(new.raw_user_meta_data ->> 'full_name', ''),
             split_part(coalesce(new.email, ''), '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url',
    case when new.raw_user_meta_data ->> 'age_confirmed' = 'true' then now() end,
    nullif(left(new.raw_user_meta_data ->> 'terms_version', 32), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Auth hook "before user created" (configured in config.toml / the dashboard).
-- When app_settings.age_confirmation_required is on, email sign-ups must carry
-- user_metadata.age_confirmed = true, else GoTrue answers 400 with the message
-- 'age confirmation required' (a raise in the auth.users trigger would surface as an
-- opaque 500 "Database error saving new user", hence a hook).
-- Measured on GoTrue v2.186: the payload does not tell admin-created users (invites,
-- dashboard) from self sign-ups, and signInWithOtp sign-ups skip this hook. So this
-- is the friendly first line only; the real gate is is_age_confirmed() in every
-- policy/RPC, which an account without age_confirmed_at can only pass via
-- confirm_age(). Admin tooling sets user_metadata.age_confirmation_deferred = true
-- (a client could too, but would just land on the confirm_age screen).
create function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_meta jsonb := coalesce(event -> 'user' -> 'user_metadata', event -> 'user' -> 'raw_user_meta_data', '{}'::jsonb);
begin
  -- Only email/password self sign-ups carry the checkbox. OAuth (Apple/Google) accounts
  -- confirm afterwards with confirm_age(); admin-created users (invites) likewise.
  if coalesce((select age_confirmation_required from public.app_settings where id), false)
     and coalesce(event -> 'user' -> 'app_metadata' ->> 'provider', 'email') = 'email'
     and coalesce(v_meta ->> 'age_confirmation_deferred', '') <> 'true'
     and coalesce(v_meta ->> 'age_confirmed', '') <> 'true' then
    return jsonb_build_object('error', jsonb_build_object('http_code', 400, 'message', 'age confirmation required'));
  end if;
  return '{}'::jsonb;
end;
$$;
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;

-- One-time "I'm 16 or older + accept the Terms" for accounts created without the
-- sign-up checkbox (Apple/Google, invites, accounts older than this migration).
-- Allowed before the age is confirmed; still needs the device check.
create function public.confirm_age(p_terms_version text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at timestamptz;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_device_verified() then
    raise exception 'session not verified' using errcode = '42501';
  end if;
  if p_terms_version is null or char_length(trim(p_terms_version)) not between 1 and 32 then
    raise exception 'invalid terms version';
  end if;
  update public.users
     set age_confirmed_at = coalesce(age_confirmed_at, now()),
         terms_version = trim(p_terms_version)
   where id = auth.uid()
  returning age_confirmed_at into v_at;
  return v_at;
end;
$$;
revoke execute on function public.confirm_age(text) from public, anon;
grant execute on function public.confirm_age(text) to authenticated;
