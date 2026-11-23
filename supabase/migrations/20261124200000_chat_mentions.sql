-- @mentions in chat (docs/boolaa-spec.md, "Mentions"; docs/push-notifications.md §3).
--
-- REPRESENTATION
--  1. The message text stays human text: a mention is written into `content` as "@" + the name the
--     sender picked ("@Ana Pop"), and chat_messages.mentions (jsonb array, default []) says where:
--       [{"user_id": "<uuid>", "start": <int>, "length": <int>}]
--     start / length count Unicode code points (what Postgres char_length / substr count; JS
--     Array.from, Swift unicodeScalars, Kotlin codePoint*), start is 0-based, and the span
--     content[start, start + length) begins with "@". Spans are stored sorted by start and never
--     overlap. Why text + spans and not a token like @[Ana](uuid) in the text: every existing reader
--     of `content` (search and its indexes, snippets, Home previews, push text, data export,
--     moderation snapshots, link detection, clients that don't know mentions yet) keeps working
--     unchanged and shows "@Ana Pop", while the uuid keeps the mention attached to the right person
--     through renames, leaving and account deletion. There is no message editing, so spans never
--     move after the insert.
--  2. Rendering (clients): a span is a mention chip, showing "@" + the person's CURRENT name, only
--     when its user is the reader or is in mention_candidates(bubble) (a current member, no block
--     either way). Otherwise the span's own text is shown as plain text (left the bubble, deleted
--     account, blocked, unknown): never a link to a non-member.
--
-- VALIDATION (BEFORE INSERT trigger chat_messages_mentions, every insert, with or without a user)
--  3. Rejected with SQLSTATE 22023 (a client bug; clients map them, see the spec):
--       'invalid mentions'   not an array, an entry that isn't {user_id: uuid, start: int,
--                            length: int}, a span outside the text, not starting with "@",
--                            shorter than 2 or longer than 101 code points, containing a line
--                            break, or overlapping another span;
--       'too many mentions'  more than 10 spans.
--  4. Dropped silently (the text stays, the span is just not a mention): the sender themself, a user
--     who isn't an approved member of the bubble at insert time, a user in a block relationship
--     with the sender either way. Dropping instead of refusing keeps the offline chat outbox
--     working: a message queued while someone was a member still sends after they left, and the
--     row read back by id (or the live echo) carries the mentions as stored.
--  5. Deleting a message (delete_chat_message) wipes its mentions with its text (check constraint).
--
-- READ
--  6. mention_candidates(p_bubble_id): the composer's list and the rendering rule in one RPC
--     (members except the caller, no block either way; SECURITY INVOKER, so RLS decides who is
--     visible). Clients can't work out "blocked me" on their own.
--  7. Realtime / pages / jump-to-message: `mentions` is a column of the row, so it arrives with
--     every INSERT / UPDATE and chat_messages_page / chat_messages_around rows. No new channel.
--
-- PUSH
--  8. New type chat_mention, pref notification_prefs.mentions (default on). A mention push depends
--     on `enabled` + `mentions` only, not on `chat`: chat off + mentions on = "only mentions".
--     Mutes, blocks, inactive accounts and membership apply as for every type. One push per
--     message per mentioned person (dedupe_key mention:<message id>); a person who gets the mention
--     push is left out of that message's regular chat push, so they get one notification. With
--     mentions off they fall back to the regular chat push (if chat is on).
--
-- SEARCH, EXPORT
--  9. search_bubble: the text as written already matches ("ana" finds "@Ana Pop"). A chat message
--     also matches when every query word starts a word of the CURRENT name of someone it mentions
--     who is a member the caller can see (so a renamed person's old mentions are found by the new
--     name). Same signature and rows. The handed-over food filter (20261124100000) is kept.
-- 10. export_my_data: the user's own messages carry their `mentions` (user ids and spans; the text
--     already holds the names as written). Messages by others that mention the user are other
--     members' messages and stay out, like before.

-- 1 -------------------------------------------------------------------------
alter table public.chat_messages
  add column mentions jsonb not null default '[]'::jsonb;

alter table public.chat_messages add constraint chat_messages_mentions_check check (
  jsonb_typeof(mentions) = 'array' and jsonb_array_length(mentions) <= 10);
alter table public.chat_messages add constraint chat_messages_deleted_mentions_check check (
  deleted_at is null or mentions = '[]'::jsonb);

comment on column public.chat_messages.mentions is
  'Mentions in content: [{user_id, start, length}], code-point offsets, sorted, each span starts with "@". Validated and filtered by trigger; [] once deleted.';

-- Containment lookups (search by a mentioned member's current name, push checks).
create index chat_messages_mentions_idx on public.chat_messages using gin (mentions jsonb_path_ops)
  where deleted_at is null and mentions <> '[]'::jsonb;

-- The distinct user ids of a mentions array.
create function public.chat_mention_user_ids(p_mentions jsonb)
returns uuid[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(array_agg(distinct (e ->> 'user_id')::uuid), '{}'::uuid[])
    from pg_catalog.jsonb_array_elements(coalesce(p_mentions, '[]'::jsonb)) as e
$$;
revoke execute on function public.chat_mention_user_ids(jsonb) from public, anon, authenticated;

-- 3, 4 ----------------------------------------------------------------------
create function public.chat_messages_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  e        jsonb;
  v_norm   jsonb := '[]'::jsonb;
  v_out    jsonb := '[]'::jsonb;
  v_uid    uuid;
  v_start  int;
  v_len    int;
  v_span   text;
  v_end    int := 0;
  v_chars  int := char_length(coalesce(new.content, ''));
begin
  if new.mentions is null then
    new.mentions := '[]'::jsonb;
  end if;
  if jsonb_typeof(new.mentions) <> 'array' then
    raise exception 'invalid mentions' using errcode = '22023';
  end if;
  if jsonb_array_length(new.mentions) = 0 then
    return new;
  end if;
  if jsonb_array_length(new.mentions) > 10 then
    raise exception 'too many mentions' using errcode = '22023';
  end if;

  -- Shape and span checks; normalise every entry to exactly {user_id, start, length}.
  for e in select value from jsonb_array_elements(new.mentions) loop
    if jsonb_typeof(e) <> 'object'
       or jsonb_typeof(e -> 'user_id') is distinct from 'string'
       or jsonb_typeof(e -> 'start') is distinct from 'number'
       or jsonb_typeof(e -> 'length') is distinct from 'number'
       or (e ->> 'start') !~ '^[0-9]{1,5}$'
       or (e ->> 'length') !~ '^[0-9]{1,3}$'
       or (e ->> 'user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid mentions' using errcode = '22023';
    end if;
    v_uid := (e ->> 'user_id')::uuid;
    v_start := (e ->> 'start')::int;
    v_len := (e ->> 'length')::int;
    if v_len < 2 or v_len > 101 or v_start + v_len > v_chars then
      raise exception 'invalid mentions' using errcode = '22023';
    end if;
    v_span := substr(new.content, v_start + 1, v_len);
    if left(v_span, 1) <> '@' or v_span ~ '[\n\r]' then
      raise exception 'invalid mentions' using errcode = '22023';
    end if;
    v_norm := v_norm || jsonb_build_array(jsonb_build_object('user_id', v_uid, 'start', v_start, 'length', v_len));
  end loop;

  -- Sorted, no overlap; keep only mentions of other current members with no block either way.
  for e in select value from jsonb_array_elements(v_norm) order by (value ->> 'start')::int loop
    v_start := (e ->> 'start')::int;
    if v_start < v_end then
      raise exception 'invalid mentions' using errcode = '22023';
    end if;
    v_end := v_start + (e ->> 'length')::int;
    v_uid := (e ->> 'user_id')::uuid;
    if v_uid <> new.sender_id
       and exists (select 1 from bubble_members m
                    where m.bubble_id = new.bubble_id and m.user_id = v_uid and m.approved)
       and not exists (select 1 from blocks b
                        where (b.blocker_id = new.sender_id and b.blocked_id = v_uid)
                           or (b.blocker_id = v_uid and b.blocked_id = new.sender_id)) then
      v_out := v_out || jsonb_build_array(e);
    end if;
  end loop;

  new.mentions := v_out;
  return new;
end;
$$;
revoke execute on function public.chat_messages_mentions() from public, anon, authenticated;
create trigger chat_messages_mentions before insert on public.chat_messages
  for each row execute function public.chat_messages_mentions();

-- 5 -------------------------------------------------------------------------
-- Same as 20261123120000_chat_improvements.sql, plus the mentions are wiped with the text.
create or replace function public.delete_chat_message(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m      public.chat_messages;
  v_keep boolean;
begin
  perform public.require_verified_session();
  select * into m from chat_messages where id = p_message_id for update;
  if not found or m.sender_id <> auth.uid() then raise exception 'message not found'; end if;
  if m.deleted_at is not null then
    return jsonb_build_object('id', m.id, 'image_path', null);
  end if;

  v_keep := exists (select 1 from reports
                     where target_type = 'chat_message' and target_id = m.id and status = 'open');
  if v_keep then
    insert into chat_message_evidence (message_id, content, image_path)
    values (m.id, m.content, m.image_path)
    on conflict (message_id) do nothing;
  end if;

  update chat_messages set content = '', image_path = null, mentions = '[]'::jsonb, deleted_at = now() where id = m.id;
  return jsonb_build_object('id', m.id, 'image_path', case when v_keep then null else m.image_path end);
end;
$$;

-- 6 -------------------------------------------------------------------------
-- rpc('mention_candidates', {p_bubble_id}): who can be mentioned in this bubble, and so which
-- mentions render as mentions. Approved members except the caller, no block either way, sorted by
-- folded name. SECURITY INVOKER: members, the verified-session gate and inactive accounts are RLS's;
-- a non-member gets no rows.
create function public.mention_candidates(p_bubble_id uuid)
returns table (user_id uuid, name text, avatar text)
language sql
stable
security invoker
set search_path = public
as $$
  select u.id, u.name, u.avatar
    from public.bubble_members bm
    join public.users u on u.id = bm.user_id
   where bm.bubble_id = p_bubble_id
     and bm.approved
     and bm.user_id <> auth.uid()
     and not public.is_blocked_with(bm.user_id)
   order by public.search_fold(u.name), u.id
$$;
revoke execute on function public.mention_candidates(uuid) from public, anon;
grant execute on function public.mention_candidates(uuid) to authenticated;

-- 8: push ---------------------------------------------------------------------
alter table public.notification_prefs
  add column mentions boolean not null default true;   -- someone @mentions me in a chat

alter table public.notification_outbox drop constraint notification_outbox_type_check;
alter table public.notification_outbox add constraint notification_outbox_type_check check (type in
  ('chat', 'chat_mention', 'join_request', 'approval', 'new_event', 'event_reminder', 'food', 'market',
   'item_request', 'item_request_withdrawn', 'item_picked', 'item_missed'));

-- Same as 20261124100000_requests_food_expiry.sql, plus chat_mention -> mentions.
create or replace function public.push_type_enabled(p_user_id uuid, p_type text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select np.enabled and case p_type
              when 'chat' then np.chat
              when 'chat_mention' then np.mentions
              when 'join_request' then np.join_requests
              when 'approval' then np.approvals
              when 'new_event' then np.new_events
              when 'event_reminder' then np.event_reminders
              when 'food' then np.food
              when 'market' then np.market
              when 'item_request' then np.item_requests
              when 'item_request_withdrawn' then np.item_requests
              when 'item_picked' then np.request_updates
              when 'item_missed' then np.request_updates
              else false end
       from public.notification_prefs np where np.user_id = p_user_id),
    p_type not in ('food', 'market'));
$$;

-- Same as 20261122200000_push_notifications.sql, except chat messages: the people a message
-- mentions get a chat_mention push (once per message) and are left out of its regular chat push
-- when that mention push passes their filters (mentions on, not muted, ...).
create or replace function public.enqueue_push_from_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mentioned uuid[];
  v_skip      uuid[] := '{}';
begin
  begin
    case tg_table_name
      when 'chat_messages' then
        v_mentioned := public.chat_mention_user_ids(new.mentions);
        if cardinality(v_mentioned) > 0 then
          perform public.push_enqueue('chat_mention', new.bubble_id, new.sender_id, new.id,
            v_mentioned, jsonb_build_object('message_id', new.id),
            'mention:' || new.id, 'mention:' || new.id);
          select coalesce(array_agg(u), '{}') into v_skip
            from unnest(v_mentioned) u
           where public.push_should_notify(u, 'chat_mention', new.bubble_id, new.sender_id);
        end if;
        perform public.push_enqueue('chat', new.bubble_id, new.sender_id, new.id,
          array(select m from unnest(public.bubble_member_ids(new.bubble_id)) m where not (m = any (v_skip))),
          jsonb_build_object('message_id', new.id),
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

-- Same as 20261124100000_requests_food_expiry.sql, plus chat_mention: sent only while the message
-- is not deleted and still mentions the recipient; same data as a chat push ({text, photo}).
create or replace function public.claim_push_batch(p_limit int default 100)
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
  v_req   public.item_requests;
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
    v_req := null;

    if not public.push_should_notify(o.recipient_id, o.type, o.bubble_id, o.actor_id) then
      v_skip := 'filtered';
    else
      case o.type
        when 'chat' then
          -- Photo messages may have no text, and a message deleted by its author is never pushed.
          select jsonb_build_object('text', content, 'photo', image_path is not null) into v_data
            from public.chat_messages where id = o.target_id and deleted_at is null;
        when 'chat_mention' then
          select jsonb_build_object('text', content, 'photo', image_path is not null) into v_data
            from public.chat_messages
           where id = o.target_id and deleted_at is null
             and mentions @> jsonb_build_array(jsonb_build_object('user_id', o.recipient_id));
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
          select jsonb_build_object('text', description) into v_data from public.food_posts
           where id = o.target_id and expires_at > now() and availability <> 'taken';
        when 'market' then
          select jsonb_build_object('title', title, 'status', status) into v_data
            from public.market_items where id = o.target_id;
        when 'item_request' then
          -- Only while the request is still open (not withdrawn) and the item still up.
          select * into v_req from public.item_requests
           where id = (o.payload ->> 'request_id')::uuid and status in ('pending', 'picked');
          if v_req.id is not null then
            v_data := public.item_push_data(v_req.item_kind, v_req.item_id, true)
                      || jsonb_build_object('note', v_req.note);
          end if;
        when 'item_picked' then
          -- Only while it is still this person's pick.
          select * into v_req from public.item_requests
           where id = (o.payload ->> 'request_id')::uuid and status = 'picked';
          if v_req.id is not null then
            v_data := public.item_push_data(v_req.item_kind, v_req.item_id, true);
          end if;
        when 'item_missed' then
          select * into v_req from public.item_requests
           where id = (o.payload ->> 'request_id')::uuid and status = 'missed';
          if v_req.id is not null then
            v_data := public.item_push_data(v_req.item_kind, v_req.item_id, false);
          end if;
        when 'item_request_withdrawn' then
          -- The request row is gone by design; the item must still be up.
          v_data := public.item_push_data(o.payload ->> 'kind', o.target_id, true);
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

-- 9: search -------------------------------------------------------------------
-- The query words exactly as search_bubble_core forms them (folded, cut at 100 characters, at
-- least 2 characters, letters and digits only, at most 8 words); null when there are none.
create function public.search_query_words(p_query text)
returns text[]
language plpgsql
immutable
parallel safe
set search_path = public
as $$
declare
  v_q text := btrim(regexp_replace(public.search_fold(left(coalesce(p_query, ''), 100)), '\s+', ' ', 'g'));
  v_words text[];
begin
  if char_length(v_q) < 2 then
    return null;
  end if;
  select array_agg(w) into v_words
    from (select w
            from regexp_split_to_table(btrim(regexp_replace(v_q, '[^[:alnum:]]+', ' ', 'g')), ' ') as w
           where w <> ''
           limit 8) s;
  return v_words;
end;
$$;
revoke execute on function public.search_query_words(text) from public, anon;
grant execute on function public.search_query_words(text) to authenticated;

-- Same signature and rows as before. The 20261124100000 wrapper (drops handed-over food) plus
-- chat messages that mention a member whose current name matches every query word (prefix match on
-- the folded name, like the full-text arm). Those rows rank below every text hit and are cut with
-- the rest at p_limit. SECURITY INVOKER: RLS decides, as in search_bubble_core.
create or replace function public.search_bubble(
  p_bubble_id uuid,
  p_query text,
  p_limit int default 30,
  p_kinds text[] default null
)
returns table (
  kind text,
  id uuid,
  title text,
  snippet text,
  author_id uuid,
  author_name text,
  created_at timestamptz,
  event_at timestamptz,
  rank real,
  matched_words text[]
)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_words text[] := public.search_query_words(p_query);
  v_tsq   tsquery;
begin
  if v_words is not null then
    v_tsq := to_tsquery('simple', array_to_string(array(select w || ':*' from unnest(v_words) as w), ' & '));
  end if;

  return query
  with core as (
    select s.*
      from public.search_bubble_core(p_bubble_id, p_query, p_limit, p_kinds) s
     where s.kind <> 'food_post'
        or exists (select 1 from public.food_posts f where f.id = s.id and f.availability <> 'taken')
  ),
  named as (
    select bm.user_id
      from public.bubble_members bm
      join public.users u on u.id = bm.user_id
     where v_tsq is not null
       and bm.bubble_id = p_bubble_id
       and bm.approved
       and not public.is_blocked_with(bm.user_id)
       and to_tsvector('simple'::regconfig, public.search_fold(u.name)) @@ v_tsq
  ),
  mention_hits as (
    select 'chat_message'::text as kind, m.id, null::text as title,
           public.search_snippet(array[m.content], v_words) as snippet,
           m.sender_id as author_id, au.name as author_name, m.created_at,
           null::timestamptz as event_at, 0.01::real as rank, v_words as matched_words
      from public.chat_messages m
      left join public.users au on au.id = m.sender_id
     where (p_kinds is null or cardinality(p_kinds) = 0 or 'chat_message' = any (p_kinds))
       and m.bubble_id = p_bubble_id
       and m.deleted_at is null
       and m.mentions <> '[]'::jsonb
       and exists (select 1 from named n
                    where m.mentions @> jsonb_build_array(jsonb_build_object('user_id', n.user_id)))
       and not exists (select 1 from core c where c.kind = 'chat_message' and c.id = m.id)
     order by m.created_at desc
     limit v_limit
  )
  select x.kind, x.id, x.title, x.snippet, x.author_id, x.author_name, x.created_at, x.event_at, x.rank, x.matched_words
    from (select * from core union all select * from mention_hits) x
   order by x.rank desc, x.created_at desc, x.id
   limit v_limit;
end;
$$;

-- 10: data export ---------------------------------------------------------------
-- Same as 20261124100000_requests_food_expiry.sql, plus chat_messages with their mentions
-- (otherwise the 20261123200000 section unchanged: a deleted message keeps only its metadata).
create or replace function public.export_my_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_doc jsonb;
begin
  v_doc := public.export_my_data_core();  -- raises the gate / rate-limit errors

  v_doc := v_doc || jsonb_build_object(
    'chat_messages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'bubble_id', m.bubble_id,
               'content', case when m.deleted_at is null then m.content end, 'photo_path', m.image_path,
               'mentions', m.mentions,
               'created_at', m.created_at, 'deleted_at', m.deleted_at)
             order by m.created_at, m.id)
        from public.chat_messages m where m.sender_id = v_uid), '[]'::jsonb),

    'food_posts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id, 'bubble_id', f.bubble_id, 'description', f.description, 'photo', f.image,
               'created_at', f.created_at, 'expires_at', f.expires_at, 'availability', f.availability,
               'handed_over_at', f.handed_over_at)
             order by f.created_at)
        from public.food_posts f where f.user_id = v_uid), '[]'::jsonb),

    'item_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'bubble_id', r.bubble_id, 'item_kind', r.item_kind, 'item_id', r.item_id,
               'item', case
                 when not (r.bubble_id in (select bm.bubble_id from public.bubble_members bm
                                            where bm.user_id = v_uid and bm.approved))
                      or public.is_blocked_with(r.owner_id) then null
                 when r.item_kind = 'market' then (select i.title from public.market_items i where i.id = r.item_id)
                 else (select f.description from public.food_posts f
                        where f.id = r.item_id and f.expires_at > now() and f.availability <> 'taken')
               end,
               'note', r.note, 'status', r.status, 'created_at', r.created_at,
               'status_changed_at', r.status_changed_at)
             order by r.created_at)
        from public.item_requests r where r.requester_id = v_uid), '[]'::jsonb),

    'requests_on_my_items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'bubble_id', r.bubble_id, 'item_kind', r.item_kind, 'item_id', r.item_id,
               'requester_id', r.requester_id, 'note', r.note, 'status', r.status,
               'created_at', r.created_at, 'status_changed_at', r.status_changed_at)
             order by r.created_at)
        from public.item_requests r
       where r.owner_id = v_uid and not public.is_blocked_with(r.requester_id)), '[]'::jsonb)
  );
  return v_doc;
end;
$$;
