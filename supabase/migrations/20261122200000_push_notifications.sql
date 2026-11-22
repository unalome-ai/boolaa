-- Push notifications (APNs, FCM, Web Push). Contract and setup: docs/push-notifications.md.
--
--  1. push_tokens: one row per device registration. Writes only through
--     register_push_token / unregister_push_token. A token is deleted with its
--     auth session (sign-out), its trusted device (revoke_device) and its user.
--  2. notification_prefs (master switch, per type, preview_content) and bubble_mutes.
--  3. notification_outbox: AFTER INSERT/UPDATE triggers enqueue one row per recipient,
--     filtered by push_should_notify() (author, prefs, mutes, blocks, inactive accounts).
--     Chat is coalesced: at most one push per bubble per recipient every 30 s.
--     Triggers never fail the user's write.
--  4. pg_net wakes the push-dispatch Edge Function (URL + shared secret in Vault);
--     pg_cron sends event reminders (1 h before, once), retries and deferred chat.
--  5. claim_push_batch / complete_push_batch: service-role RPCs used by push-dispatch.
--  6. push_debug_log: what PUSH_DRY_RUN=1 would have sent (local testing only).
--
-- Vault (production setup in docs/push-notifications.md):
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/push-dispatch', 'push_dispatch_url');
--   select vault.create_secret('<random secret>', 'push_dispatch_secret');
-- If either is missing, nothing is called (the outbox still fills and is sent once they exist).

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- 1 -------------------------------------------------------------------------
-- token: APNs device token (hex), FCM registration token, or for web the
-- subscription endpoint (also stored in `endpoint`, with the p256dh/auth keys).
create table public.push_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete cascade,
  platform      text not null check (platform in ('ios', 'android', 'web')),
  token         text not null check (char_length(token) between 16 and 4096),
  endpoint      text check (char_length(endpoint) <= 2048),
  p256dh        text check (p256dh ~ '^[A-Za-z0-9_-]{86,88}={0,2}$'),
  auth          text check (auth ~ '^[A-Za-z0-9_-]{22,24}={0,2}$'),
  apns_env      text check (apns_env in ('sandbox', 'production')),
  device_hash   text check (device_hash ~ '^[0-9a-f]{64}$'),
  -- The session that registered the token: signing out deletes the session, and the token with it.
  session_id    uuid references auth.sessions (id) on delete cascade,
  locale        text check (locale in ('en', 'ro', 'fr', 'es', 'it')),
  app_version   text check (char_length(app_version) <= 32),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (platform, token),
  check (platform <> 'web' or (endpoint = token and p256dh is not null and auth is not null)),
  check (platform = 'web' or (endpoint is null and p256dh is null and auth is null)),
  check ((platform = 'ios') = (apns_env is not null)),
  -- Revoking a trusted device (revoke_device) stops pushes to it.
  foreign key (user_id, device_hash) references public.trusted_devices (user_id, device_hash) on delete cascade
);
create index push_tokens_user_idx on public.push_tokens (user_id);
create index push_tokens_session_idx on public.push_tokens (session_id);

alter table public.push_tokens enable row level security;
revoke all on public.push_tokens from anon, authenticated;
grant select, delete on public.push_tokens to authenticated;
create policy push_tokens_select_own on public.push_tokens for select to authenticated
  using (user_id = auth.uid());
create policy push_tokens_delete_own on public.push_tokens for delete to authenticated
  using (user_id = auth.uid());

-- 2 -------------------------------------------------------------------------
-- No row = the defaults below (rows are created for every user anyway).
create table public.notification_prefs (
  user_id          uuid primary key references public.users (id) on delete cascade,
  enabled          boolean not null default true,   -- master switch
  chat             boolean not null default true,
  join_requests    boolean not null default true,   -- someone asks to join one of my bubbles
  approvals        boolean not null default true,   -- my own request was approved
  new_events       boolean not null default true,
  event_reminders  boolean not null default true,   -- 1 h before events I RSVPed to
  food             boolean not null default false,
  market           boolean not null default false,
  preview_content  boolean not null default true,   -- off: no names, no message text
  updated_at       timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;
revoke all on public.notification_prefs from anon, authenticated;
grant select, insert, update on public.notification_prefs to authenticated;
create policy notification_prefs_select_own on public.notification_prefs for select to authenticated
  using (user_id = auth.uid());
create policy notification_prefs_insert_own on public.notification_prefs for insert to authenticated
  with check (user_id = auth.uid());
create policy notification_prefs_update_own on public.notification_prefs for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

insert into public.notification_prefs (user_id) select id from public.users on conflict do nothing;

create function public.create_notification_prefs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_prefs (user_id) values (new.id) on conflict do nothing;
  return null;
end;
$$;
revoke execute on function public.create_notification_prefs() from public, anon, authenticated;
create trigger on_user_created_notification_prefs
  after insert on public.users
  for each row execute function public.create_notification_prefs();

create function public.touch_notification_prefs()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger on_notification_prefs_updated
  before update on public.notification_prefs
  for each row execute function public.touch_notification_prefs();

-- until null = muted until unmuted.
create table public.bubble_mutes (
  user_id     uuid not null references public.users (id) on delete cascade,
  bubble_id   uuid not null references public.bubbles (id) on delete cascade,
  until       timestamptz,
  created_at  timestamptz not null default now(),
  primary key (user_id, bubble_id)
);
alter table public.bubble_mutes enable row level security;
revoke all on public.bubble_mutes from anon, authenticated;
grant select, insert, update, delete on public.bubble_mutes to authenticated;
create policy bubble_mutes_select_own on public.bubble_mutes for select to authenticated
  using (user_id = auth.uid());
create policy bubble_mutes_insert_own on public.bubble_mutes for insert to authenticated
  with check (user_id = auth.uid() and public.is_bubble_member(bubble_id));
create policy bubble_mutes_update_own on public.bubble_mutes for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_bubble_member(bubble_id));
create policy bubble_mutes_delete_own on public.bubble_mutes for delete to authenticated
  using (user_id = auth.uid());

-- 3 -------------------------------------------------------------------------
create table public.notification_outbox (
  id               bigint generated always as identity primary key,
  recipient_id     uuid not null references public.users (id) on delete cascade,
  type             text not null check (type in
                     ('chat', 'join_request', 'approval', 'new_event', 'event_reminder', 'food', 'market')),
  bubble_id        uuid references public.bubbles (id) on delete cascade,
  actor_id         uuid references public.users (id) on delete set null,
  target_id        uuid,
  -- References only (message_id, count, ...): the text is read at send time, so content
  -- deleted in the meantime is never pushed.
  payload          jsonb not null default '{}'::jsonb,
  collapse_key     text,
  dedupe_key       text,
  status           text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  created_at       timestamptz not null default now(),
  next_attempt_at  timestamptz not null default now(),
  claimed_at       timestamptz,
  claimed_until    timestamptz,
  sent_at          timestamptz,
  attempts         int not null default 0,
  last_error       text,
  token_ids        uuid[]   -- null = all the recipient's tokens; set to the failed ones on a retry
);
create index notification_outbox_due_idx on public.notification_outbox (next_attempt_at) where status = 'pending';
create index notification_outbox_recipient_idx on public.notification_outbox (recipient_id, bubble_id, type, id desc);
create unique index notification_outbox_dedupe_idx on public.notification_outbox (recipient_id, dedupe_key)
  where dedupe_key is not null;
create index notification_outbox_created_idx on public.notification_outbox (created_at);
alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from anon, authenticated;
-- No policies: only the service role and security definer functions use it.

-- 6 -------------------------------------------------------------------------
create table public.push_debug_log (
  id            bigint generated always as identity primary key,
  outbox_id     bigint,
  provider      text not null,
  token         text not null,
  title         text,
  body          text,
  collapse_key  text,
  request       jsonb,
  simulated     text,
  created_at    timestamptz not null default now()
);
alter table public.push_debug_log enable row level security;
revoke all on public.push_debug_log from anon, authenticated;

-- Same restrictive verified-session policy as every other client-visible table
-- (20261122160000_device_verification.sql).
do $$
declare t text;
begin
  foreach t in array array['push_tokens', 'notification_prefs', 'bubble_mutes', 'notification_outbox', 'push_debug_log']
  loop
    execute format(
      'create policy require_verified_session on public.%I as restrictive for all to authenticated
         using ((select public.is_session_verified())) with check ((select public.is_session_verified()))', t);
  end loop;
end $$;

-- Recipient filter, used at enqueue time and again when the dispatcher claims the row.
create function public.push_type_enabled(p_user_id uuid, p_type text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select np.enabled and case p_type
              when 'chat' then np.chat
              when 'join_request' then np.join_requests
              when 'approval' then np.approvals
              when 'new_event' then np.new_events
              when 'event_reminder' then np.event_reminders
              when 'food' then np.food
              when 'market' then np.market
              else false end
       from public.notification_prefs np where np.user_id = p_user_id),
    p_type not in ('food', 'market'));
$$;

create function public.push_should_notify(p_recipient uuid, p_type text, p_bubble_id uuid, p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_recipient is not null
    -- never the author (a reminder goes to everyone who RSVPed, the creator included)
    and (p_type = 'event_reminder' or p_recipient is distinct from p_actor)
    -- active account (docs/moderation.md: banned, or suspended until a future date)
    and exists (select 1 from public.users u
                 where u.id = p_recipient
                   and not (u.status = 'banned'
                            or (u.status = 'suspended' and (u.status_until is null or u.status_until > now()))))
    and public.push_type_enabled(p_recipient, p_type)
    -- still in the bubble (the requester of an approval just became a member too)
    and (p_bubble_id is null or exists (select 1 from public.bubble_members m
                                         where m.bubble_id = p_bubble_id and m.user_id = p_recipient and m.approved))
    -- bubble muted (an approval is about the recipient's own request, never muted)
    and (p_type = 'approval' or p_bubble_id is null or not exists (
          select 1 from public.bubble_mutes bm
           where bm.user_id = p_recipient and bm.bubble_id = p_bubble_id
             and (bm.until is null or bm.until > now())))
    -- blocks, both ways
    and (p_actor is null or p_actor = p_recipient or not exists (
          select 1 from public.blocks b
           where (b.blocker_id = p_recipient and b.blocked_id = p_actor)
              or (b.blocker_id = p_actor and b.blocked_id = p_recipient)));
$$;

-- Queues one HTTP call to push-dispatch per transaction (fire-and-forget, after commit).
create function public.push_kick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url    text;
  v_secret text;
begin
  if current_setting('boolaa.push_kicked', true) = 'on' then return; end if;
  begin
    select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'push_dispatch_url'    limit 1;
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_dispatch_secret' limit 1;
    if v_url is not null and v_secret is not null then
      perform net.http_post(
        url     := v_url,
        body    := '{}'::jsonb,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-dispatch-secret', v_secret),
        timeout_milliseconds := 30000);
      perform set_config('boolaa.push_kicked', 'on', true);
    end if;
  exception when others then
    raise warning 'push dispatch not queued: %', sqlerrm;
  end;
end;
$$;

-- Enqueue one notification per recipient that passes push_should_notify and has a
-- device. Chat is coalesced. Returns the number of rows inserted or merged.
create function public.push_enqueue(
  p_type text, p_bubble_id uuid, p_actor uuid, p_target_id uuid, p_recipients uuid[],
  p_payload jsonb default '{}'::jsonb, p_collapse_key text default null, p_dedupe_key text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r        uuid;
  v_n      int := 0;
  v_due    boolean := false;
  v_id     bigint;
  v_last   timestamptz;
  v_at     timestamptz;
begin
  for r in
    select distinct u from unnest(p_recipients) u
     where public.push_should_notify(u, p_type, p_bubble_id, p_actor)
       and exists (select 1 from public.push_tokens t where t.user_id = u)
     order by 1  -- same lock order in every transaction: concurrent senders can't deadlock
  loop
    if p_type = 'chat' then
      -- One chat enqueue at a time per (recipient, bubble), until this transaction ends.
      perform pg_advisory_xact_lock(hashtext('push_chat:' || r::text || ':' || p_bubble_id::text));
      -- Merge into this recipient's not-yet-dispatched chat row for the bubble (newest
      -- message wins, count adds up). If the dispatcher is claiming it right now, wait for
      -- the claim to commit: the row then no longer qualifies and the throttle below sees it.
      select id, next_attempt_at into v_id, v_at from public.notification_outbox
       where recipient_id = r and bubble_id = p_bubble_id and type = 'chat'
         and status = 'pending' and claimed_at is null
       order by id desc limit 1
       for update;
      if found then
        update public.notification_outbox
           set actor_id = p_actor, target_id = p_target_id,
               payload = payload || p_payload
                         || jsonb_build_object('count', coalesce((payload ->> 'count')::int, 1) + 1)
         where id = v_id;
        v_n := v_n + 1;
        -- A dispatcher that ran while this transaction held the row skipped it (SKIP LOCKED):
        -- wake it again after commit.
        v_due := v_due or v_at <= now();
        continue;
      end if;
      -- Throttle: at most one push per 30 s per bubble per recipient.
      select max(claimed_at) into v_last from public.notification_outbox
       where recipient_id = r and bubble_id = p_bubble_id and type = 'chat'
         and claimed_at > now() - interval '30 seconds';
      v_at := greatest(now(), coalesce(v_last + interval '30 seconds', now()));
      insert into public.notification_outbox
        (recipient_id, type, bubble_id, actor_id, target_id, payload, collapse_key, next_attempt_at)
      values (r, p_type, p_bubble_id, p_actor, p_target_id, p_payload || '{"count": 1}'::jsonb, p_collapse_key, v_at);
      v_n := v_n + 1;
      v_due := v_due or v_at <= now();
    else
      insert into public.notification_outbox
        (recipient_id, type, bubble_id, actor_id, target_id, payload, collapse_key, dedupe_key)
      values (r, p_type, p_bubble_id, p_actor, p_target_id, p_payload, p_collapse_key, p_dedupe_key)
      on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing;
      if found then
        v_n := v_n + 1;
        v_due := true;
      end if;
    end if;
  end loop;

  if v_due then perform public.push_kick(); end if;
  return v_n;
end;
$$;

create function public.bubble_member_ids(p_bubble_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(user_id), '{}') from public.bubble_members where bubble_id = p_bubble_id and approved;
$$;

-- One trigger function for every source table. Never fails the user's write.
create function public.enqueue_push_from_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    case tg_table_name
      when 'chat_messages' then
        perform public.push_enqueue('chat', new.bubble_id, new.sender_id, new.id,
          public.bubble_member_ids(new.bubble_id), jsonb_build_object('message_id', new.id),
          'chat:' || new.bubble_id);
      when 'join_requests' then
        perform public.push_enqueue('join_request', new.bubble_id, new.user_id, new.id,
          public.bubble_member_ids(new.bubble_id), jsonb_build_object('request_id', new.id),
          'join:' || new.bubble_id);
      when 'bubble_members' then
        -- Requester admitted (inserted approved by try_admit_join_request, or flipped to approved).
        if new.approved and new.role = 'member'
           and (tg_op = 'INSERT' or not coalesce(old.approved, false)) then
          perform public.push_enqueue('approval', new.bubble_id, null, new.bubble_id,
            array[new.user_id], '{}'::jsonb, 'approval:' || new.bubble_id);
        end if;
      when 'events' then
        perform public.push_enqueue('new_event', new.bubble_id, new.creator_id, new.id,
          public.bubble_member_ids(new.bubble_id), jsonb_build_object('event_id', new.id),
          'event:' || new.id);
      when 'food_posts' then
        perform public.push_enqueue('food', new.bubble_id, new.user_id, new.id,
          public.bubble_member_ids(new.bubble_id), jsonb_build_object('post_id', new.id),
          'food:' || new.bubble_id);
      when 'market_items' then
        perform public.push_enqueue('market', new.bubble_id, new.owner_id, new.id,
          public.bubble_member_ids(new.bubble_id), jsonb_build_object('item_id', new.id),
          'market:' || new.bubble_id);
      else null;
    end case;
  exception when others then
    raise warning 'push not enqueued (%): %', tg_table_name, sqlerrm;
  end;
  return null;
end;
$$;

create trigger push_on_chat_message  after insert on public.chat_messages  for each row execute function public.enqueue_push_from_trigger();
create trigger push_on_join_request  after insert on public.join_requests  for each row execute function public.enqueue_push_from_trigger();
create trigger push_on_member_admitted after insert or update of approved on public.bubble_members
  for each row execute function public.enqueue_push_from_trigger();
create trigger push_on_event         after insert on public.events         for each row execute function public.enqueue_push_from_trigger();
create trigger push_on_food_post     after insert on public.food_posts     for each row execute function public.enqueue_push_from_trigger();
create trigger push_on_market_item   after insert on public.market_items   for each row execute function public.enqueue_push_from_trigger();

-- 4 -------------------------------------------------------------------------
-- pg_cron, every 5 minutes: remind everyone who RSVPed to an event starting within the
-- next hour. Once per (event, user, start time): moving the event re-arms its reminder.
create function public.enqueue_event_reminders()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  e   record;
  v_n int := 0;
begin
  for e in
    select id, bubble_id, creator_id, datetime, rsvp_list from public.events
     where datetime > now() and datetime <= now() + interval '1 hour' and cardinality(rsvp_list) > 0
  loop
    begin
      v_n := v_n + public.push_enqueue('event_reminder', e.bubble_id, e.creator_id, e.id, e.rsvp_list,
        jsonb_build_object('event_id', e.id, 'starts_at', e.datetime), 'reminder:' || e.id,
        'reminder:' || e.id || ':' || extract(epoch from e.datetime)::bigint);
    exception when others then
      raise warning 'reminder for event % not enqueued: %', e.id, sqlerrm;
    end;
  end loop;
  return v_n;
end;
$$;

-- pg_cron, every 30 seconds: wake the dispatcher for deferred chat pushes and retries.
create function public.push_kick_if_due()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.notification_outbox
              where status = 'pending' and next_attempt_at <= now()
                and (claimed_until is null or claimed_until < now())) then
    perform public.push_kick();
    return true;
  end if;
  return false;
end;
$$;

-- pg_cron, daily: drop old outbox rows and dry-run logs; give up on rows stuck past 5 attempts.
create function public.prune_push_outbox()
returns void
language sql
security definer
set search_path = public
as $$
  update public.notification_outbox
     set status = 'failed', last_error = coalesce(last_error, 'lease expired after the last attempt')
   where status = 'pending' and attempts >= 5 and claimed_until < now();
  delete from public.notification_outbox where created_at < now() - interval '7 days' and status <> 'pending';
  delete from public.push_debug_log where created_at < now() - interval '2 days';
$$;

select cron.schedule('push-event-reminders', '*/5 * * * *', 'select public.enqueue_event_reminders()');
select cron.schedule('push-dispatch-due', '30 seconds', 'select public.push_kick_if_due()');
select cron.schedule('push-outbox-prune', '17 3 * * *', 'select public.prune_push_outbox()');

-- 5 -------------------------------------------------------------------------
-- Claims due rows (FOR UPDATE SKIP LOCKED, 2-minute lease, attempts + 1), re-checks the
-- recipient filter and that the content still exists, and returns what push-dispatch
-- needs to render and send. Rows that no longer qualify are marked 'skipped'.
-- Never returns email addresses.
create function public.claim_push_batch(p_limit int default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o       public.notification_outbox;
  v_items jsonb := '[]'::jsonb;
  v_data  jsonb;
  v_tok   jsonb;
  v_skip  text;
begin
  for o in
    with due as (
      select id from public.notification_outbox
       where status = 'pending' and next_attempt_at <= now() and attempts < 5
         and (claimed_until is null or claimed_until < now())
       order by next_attempt_at, id
       limit least(greatest(coalesce(p_limit, 100), 1), 500)
       for update skip locked)
    update public.notification_outbox x
       set claimed_at = now(), claimed_until = now() + interval '2 minutes', attempts = x.attempts + 1
      from due where x.id = due.id
    returning x.*
  loop
    v_skip := null;
    v_data := null;

    if not public.push_should_notify(o.recipient_id, o.type, o.bubble_id, o.actor_id) then
      v_skip := 'filtered';
    else
      case o.type
        when 'chat' then
          select jsonb_build_object('text', content) into v_data from public.chat_messages where id = o.target_id;
        when 'join_request' then
          select jsonb_build_object() into v_data from public.join_requests where id = o.target_id;
        when 'approval' then
          v_data := '{}'::jsonb;
        when 'new_event' then
          select jsonb_build_object('title', title, 'location', location, 'starts_at', datetime) into v_data
            from public.events where id = o.target_id;
        when 'event_reminder' then
          select jsonb_build_object('title', title, 'location', location, 'starts_at', datetime) into v_data
            from public.events
           where id = o.target_id and datetime > now() and o.recipient_id = any(rsvp_list);
        when 'food' then
          select jsonb_build_object('text', description) into v_data from public.food_posts where id = o.target_id;
        when 'market' then
          select jsonb_build_object('title', title, 'status', status) into v_data
            from public.market_items where id = o.target_id;
        else null;
      end case;
      if v_data is null then v_skip := 'content_gone'; end if;
    end if;

    if v_skip is null then
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', t.id, 'platform', t.platform, 'token', t.token, 'endpoint', t.endpoint,
               'p256dh', t.p256dh, 'auth', t.auth, 'apns_env', t.apns_env, 'locale', t.locale)
             order by t.created_at), '[]'::jsonb)
        into v_tok
        from public.push_tokens t
       where t.user_id = o.recipient_id and (o.token_ids is null or t.id = any(o.token_ids));
      if jsonb_array_length(v_tok) = 0 then v_skip := 'no_tokens'; end if;
    end if;

    if v_skip is not null then
      update public.notification_outbox
         set status = 'skipped', last_error = v_skip, claimed_until = null
       where id = o.id;
      continue;
    end if;

    v_items := v_items || jsonb_build_object(
      'id', o.id,
      'type', o.type,
      'bubble_id', o.bubble_id,
      'target_id', o.target_id,
      'collapse_key', o.collapse_key,
      'attempts', o.attempts,
      'count', coalesce((o.payload ->> 'count')::int, 1),
      'bubble_name', (select name from public.bubbles where id = o.bubble_id),
      'actor_name', (select name from public.users where id = o.actor_id),
      'preview_content', coalesce((select preview_content from public.notification_prefs
                                    where user_id = o.recipient_id), true),
      'user_locale', (select raw_user_meta_data ->> 'locale' from auth.users where id = o.recipient_id),
      'data', v_data,
      'tokens', v_tok);
  end loop;
  return v_items;
end;
$$;

-- p_results: [{id, status: 'sent'|'retry'|'failed', error?, retry_token_ids?, retry_after_seconds?}]
-- p_invalid_token_ids: tokens the providers reported as gone (deleted).
-- A retry backs off 30 s, 1, 2, 4 min (or the provider's Retry-After); the 5th failure is final.
create function public.complete_push_batch(p_results jsonb, p_invalid_token_ids uuid[] default '{}')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
begin
  if coalesce(cardinality(p_invalid_token_ids), 0) > 0 then
    delete from public.push_tokens where id = any(p_invalid_token_ids);
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    if r ->> 'status' = 'sent' then
      update public.notification_outbox
         set status = 'sent', sent_at = now(), claimed_until = null, last_error = r ->> 'error'
       where id = (r ->> 'id')::bigint;
    elsif r ->> 'status' = 'retry' then
      update public.notification_outbox
         set status = case when attempts >= 5 then 'failed' else 'pending' end,
             next_attempt_at = now() + greatest(
               make_interval(secs => least(30 * power(2, greatest(attempts - 1, 0)), 3600)),
               make_interval(secs => least(coalesce((r ->> 'retry_after_seconds')::int, 0), 3600))),
             claimed_until = null,
             last_error = left(r ->> 'error', 500),
             token_ids = case when jsonb_typeof(r -> 'retry_token_ids') = 'array'
                              then array(select jsonb_array_elements_text(r -> 'retry_token_ids'))::uuid[]
                              else token_ids end
       where id = (r ->> 'id')::bigint;
    else
      update public.notification_outbox
         set status = 'failed', claimed_until = null, last_error = left(r ->> 'error', 500)
       where id = (r ->> 'id')::bigint;
    end if;
  end loop;
end;
$$;

-- Client RPCs -----------------------------------------------------------------

-- Register (or refresh) this device's push token for the caller. Called on every app
-- start / sign-in once the device check passed, and whenever the OS hands out a new token.
-- A token registered by another user before (shared device) moves to the caller.
--   ios:     p_token = APNs device token (hex), p_apns_env = 'sandbox' | 'production'
--   android: p_token = FCM registration token
--   web:     p_endpoint, p_p256dh, p_auth from PushSubscription.toJSON() (p_token may be null)
-- p_device_id = the same device id sent to start_device_check (links the trusted device).
create function public.register_push_token(
  p_platform    text,
  p_token       text default null,
  p_endpoint    text default null,
  p_p256dh      text default null,
  p_auth        text default null,
  p_apns_env    text default null,
  p_device_id   text default null,
  p_locale      text default null,
  p_app_version text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_token  text := nullif(trim(p_token), '');
  v_hash   text;
  v_sid    uuid := public.current_session_id();
  v_locale text := lower(left(nullif(trim(p_locale), ''), 2));
  v_id     uuid;
begin
  perform public.require_verified_session();

  if p_platform = 'ios' then
    if v_token is null or v_token !~ '^[0-9A-Fa-f]{64,200}$' then raise exception 'invalid push token'; end if;
    v_token := lower(v_token);
    if coalesce(p_apns_env, '') not in ('sandbox', 'production') then raise exception 'invalid apns env'; end if;
  elsif p_platform = 'android' then
    if v_token is null or char_length(v_token) not between 16 and 4096 or v_token !~ '^[A-Za-z0-9_:.-]+$' then raise exception 'invalid push token'; end if;
  elsif p_platform = 'web' then
    -- Only real push services: the dispatcher POSTs to this URL.
    if p_endpoint is null or char_length(p_endpoint) > 2048 or p_endpoint !~
         '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com|push\.services\.mozilla\.com)/' then
      raise exception 'invalid push endpoint';
    end if;
    if p_p256dh is null or p_auth is null
       or p_p256dh !~ '^[A-Za-z0-9_-]{86,88}={0,2}$' or p_auth !~ '^[A-Za-z0-9_-]{22,24}={0,2}$' then
      raise exception 'invalid push keys';
    end if;
    v_token := p_endpoint;
  else
    raise exception 'invalid platform';
  end if;

  if v_locale is not null and v_locale not in ('en', 'ro', 'fr', 'es', 'it') then v_locale := null; end if;
  if p_device_id is not null and char_length(p_device_id) between 16 and 512 then
    v_hash := public.device_hash_of(p_device_id);
    if not exists (select 1 from public.trusted_devices where user_id = v_uid and device_hash = v_hash) then
      v_hash := null;
    end if;
  end if;
  if v_sid is not null and not exists (select 1 from auth.sessions where id = v_sid and user_id = v_uid) then
    v_sid := null;
  end if;

  -- One token per device and platform: a rotated token replaces the old one.
  if v_hash is not null then
    delete from public.push_tokens
     where user_id = v_uid and device_hash = v_hash and platform = p_platform and token <> v_token;
  end if;

  insert into public.push_tokens as t
    (user_id, platform, token, endpoint, p256dh, auth, apns_env, device_hash, session_id, locale, app_version)
  values (v_uid, p_platform, v_token,
          case when p_platform = 'web' then v_token end,
          case when p_platform = 'web' then p_p256dh end,
          case when p_platform = 'web' then p_auth end,
          case when p_platform = 'ios' then p_apns_env end,
          v_hash, v_sid, v_locale, nullif(left(trim(p_app_version), 32), ''))
  on conflict (platform, token) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        apns_env = excluded.apns_env,
        device_hash = excluded.device_hash,
        session_id = excluded.session_id,
        locale = excluded.locale,
        app_version = excluded.app_version,
        created_at = case when t.user_id = excluded.user_id then t.created_at else now() end,
        last_seen_at = now()
  returning id into v_id;

  -- At most 20 devices per user: the least recently seen go first.
  delete from public.push_tokens
   where user_id = v_uid
     and id in (select id from public.push_tokens where user_id = v_uid
                 order by last_seen_at desc, created_at desc offset 20);
  return v_id;
end;
$$;

-- Remove this device's token (call before signing out; signing out also deletes it on
-- the server through the session). Works for suspended accounts too. For web, pass the
-- subscription endpoint.
create function public.unregister_push_token(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.push_tokens
   where user_id = auth.uid() and token in (trim(p_token), lower(trim(p_token)));
  return found;
end;
$$;

revoke execute on function
  public.push_type_enabled(uuid, text), public.push_should_notify(uuid, text, uuid, uuid), public.push_kick(),
  public.push_enqueue(text, uuid, uuid, uuid, uuid[], jsonb, text, text), public.bubble_member_ids(uuid),
  public.enqueue_push_from_trigger(), public.enqueue_event_reminders(), public.push_kick_if_due(),
  public.prune_push_outbox(), public.claim_push_batch(int), public.complete_push_batch(jsonb, uuid[])
  from public, anon, authenticated;
grant execute on function public.claim_push_batch(int), public.complete_push_batch(jsonb, uuid[]) to service_role;
revoke execute on function public.register_push_token(text, text, text, text, text, text, text, text, text),
  public.unregister_push_token(text) from public, anon;
grant execute on function public.register_push_token(text, text, text, text, text, text, text, text, text),
  public.unregister_push_token(text) to authenticated;
