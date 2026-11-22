-- Chat improvements (docs/boolaa-spec.md, "Chat"): older pages, deleting your own message,
-- photos and unread counts with a last-read marker.
--
--  1. chat_messages: image_path (photo in the private `chat.images` bucket), deleted_at (soft
--     delete), keyset index (bubble_id, created_at, id), server-set created_at.
--  2. Soft delete through delete_chat_message(): the row stays as a "message deleted"
--     placeholder with its text and photo wiped, so members see it change live (an RLS-checked
--     UPDATE), pages and unread markers stay stable, and moderation keeps its context.
--     If the message has an open report, its text and photo path are first copied into
--     chat_message_evidence (admins only), so deleting can't destroy report evidence.
--     Clients can no longer hard-delete messages (chat_delete_own is dropped).
--  3. Storage bucket `chat.images`: PRIVATE. Members of the message's bubble (not blocked, verified
--     session) can read a photo while a live message references it; clients show signed URLs.
--     Uploads under `<uid>/`, owners read/delete their own folder (account deletion cleanup).
--  4. Moderation: the report snapshot shows chat photos and author-deleted evidence; resolving a
--     report on a chat message removes the photo (delete_content, or any action once the author
--     had deleted the message) through the existing admin cleanup path.
--  5. chat_reads + mark_chat_read() + chat_unread_counts().
--  6. Push: photo messages get a "sent a photo" text; author-deleted messages are never pushed.
--  7. chat_messages_page(): keyset pages (newest first) for "load older messages".

-- 1 -------------------------------------------------------------------------
alter table public.chat_messages
  add column image_path text,
  add column deleted_at timestamptz;

-- Text is optional with a photo (caption) and empty once deleted.
alter table public.chat_messages drop constraint chat_messages_content_check;
alter table public.chat_messages add constraint chat_messages_content_check check (
  char_length(content) <= 4000
  and (deleted_at is not null or char_length(content) >= 1 or image_path is not null));
-- A photo lives in the sender's own folder: <sender uid>/<file>.
alter table public.chat_messages add constraint chat_messages_image_path_check check (
  image_path is null or image_path ~ ('^' || sender_id::text || '/[A-Za-z0-9._-]{1,128}$'));
alter table public.chat_messages add constraint chat_messages_deleted_empty_check check (
  deleted_at is null or (content = '' and image_path is null));
-- One message per photo, so a photo's readers are exactly that message's readers.
create unique index chat_messages_image_path_key on public.chat_messages (image_path) where image_path is not null;

-- Keyset pagination: (created_at, id) descending within a bubble.
drop index if exists public.chat_messages_bubble_created_idx;
create index chat_messages_bubble_created_id_idx on public.chat_messages (bubble_id, created_at, id);

-- Clients can't backdate messages (which would break pages and unread counts) or insert
-- deleted ones. Writes without a user (seed, service role) keep their values.
create function public.chat_messages_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.created_at := now();
    new.deleted_at := null;
  end if;
  return new;
end;
$$;
create trigger chat_messages_before_insert before insert on public.chat_messages
  for each row execute function public.chat_messages_before_insert();

-- 3 (storage helpers first: the insert policy below uses one) -----------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat.images', 'chat.images', false, 5 * 1024 * 1024, array['image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- True when the caller uploaded this object (it exists in their folder of chat.images).
create function public.chat_image_uploaded(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from storage.objects
     where bucket_id = 'chat.images' and name = p_path
       and (storage.foldername(name))[1] = auth.uid()::text
  )
$$;
revoke execute on function public.chat_image_uploaded(text) from public, anon;
grant execute on function public.chat_image_uploaded(text) to authenticated;

-- True when a live (not deleted) message the caller can see references this photo:
-- same rules as chat_select (member of the bubble, verified session, no block either way).
create function public.can_read_chat_image(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_messages m
     where m.image_path = p_path and m.deleted_at is null
       and public.is_bubble_member(m.bubble_id)
       and not public.is_blocked_with(m.sender_id)
  )
$$;
revoke execute on function public.can_read_chat_image(text) from public, anon;
grant execute on function public.can_read_chat_image(text) to authenticated;

-- 2 -------------------------------------------------------------------------
-- Inserts: own, member, not deleted, and a photo must already be uploaded by the sender.
drop policy chat_insert on public.chat_messages;
create policy chat_insert on public.chat_messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_bubble_member(bubble_id) and deleted_at is null
              and (image_path is null or public.chat_image_uploaded(image_path)));
-- Deleting goes through delete_chat_message() (soft delete). No client UPDATE policy either.
drop policy chat_delete_own on public.chat_messages;

-- Text and photo path of an author-deleted message that had an open report. Admins only
-- (no client policies); gone with the message row.
create table public.chat_message_evidence (
  message_id  uuid primary key references public.chat_messages (id) on delete cascade,
  content     text not null,
  image_path  text,
  deleted_at  timestamptz not null default now()
);
alter table public.chat_message_evidence enable row level security;
revoke all on public.chat_message_evidence from anon, authenticated;

-- Soft-deletes the caller's own message. Returns {id, image_path}: the photo the client must
-- now remove from Storage (null when there is none, or when it is kept as report evidence).
create function public.delete_chat_message(p_message_id uuid)
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

  update chat_messages set content = '', image_path = null, deleted_at = now() where id = m.id;
  return jsonb_build_object('id', m.id, 'image_path', case when v_keep then null else m.image_path end);
end;
$$;
revoke execute on function public.delete_chat_message(uuid) from public, anon;
grant execute on function public.delete_chat_message(uuid) to authenticated;

-- 3 -------------------------------------------------------------------------
-- The restrictive "images: require verified session (...)" policies already cover every bucket.
create policy "chat images: owners upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat.images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "chat images: owners read" on storage.objects for select to authenticated
  using (bucket_id = 'chat.images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "chat images: owners delete" on storage.objects for delete to authenticated
  using (bucket_id = 'chat.images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "chat images: members read" on storage.objects for select to authenticated
  using (bucket_id = 'chat.images' and public.can_read_chat_image(name));

-- 4 -------------------------------------------------------------------------
-- Admins may read a chat photo that is (or was, as evidence) part of a reported message.
create function public.is_reported_chat_photo(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() and exists (
    select 1
      from reports r
      join chat_messages m on m.id = r.target_id
      left join chat_message_evidence e on e.message_id = m.id
     where r.target_type = 'chat_message'
       and (m.image_path = p_name or e.image_path = p_name)
  )
$$;
revoke execute on function public.is_reported_chat_photo(text) from public, anon;
grant execute on function public.is_reported_chat_photo(text) to authenticated;
create policy "chat images: admins read reported" on storage.objects for select to authenticated
  using (bucket_id = 'chat.images' and public.is_reported_chat_photo(name));

-- The admin view deletes the photo a resolution names (moderation_actions.details image_bucket /
-- image_path). Only admin_resolve_report writes those keys; chat photos are also named for
-- actions other than delete_content (author-deleted messages), so the action isn't checked.
create or replace function public.is_moderated_photo(p_bucket text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_bucket in ('food.images', 'market.images', 'chat.images')
     and public.is_admin()
     and exists (
       select 1 from moderation_actions m
        where m.details->>'image_bucket' = p_bucket
          and m.details->>'image_path' = p_name
     )
$$;

-- Snapshot: chat photos (path in the private bucket; the admin view signs it) and, for a
-- message its author deleted, the evidence copy.
create or replace function public.report_target_snapshot(p_target_type text, p_target_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  case p_target_type
    when 'chat_message' then
      select case when m.deleted_at is null
               then jsonb_build_object('text', nullif(m.content, ''), 'image_path', m.image_path)
               else jsonb_build_object('text', nullif(e.content, ''), 'image_path', e.image_path,
                                       'deleted_by_author', true, 'deleted_at', m.deleted_at)
             end
        into v
        from chat_messages m left join chat_message_evidence e on e.message_id = m.id
       where m.id = p_target_id;
      if v ? 'image_path' and v->>'image_path' is not null then
        v := v || '{"image_bucket": "chat.images"}'::jsonb;
      end if;
    when 'event' then
      select jsonb_build_object('title', title,
               'text', concat_ws(' · ', nullif(location, ''), nullif(description, ''), to_char(datetime at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"')))
        into v from events where id = p_target_id;
    when 'food_post' then
      select jsonb_build_object('text', description, 'image', image) into v from food_posts where id = p_target_id;
    when 'market_item' then
      select jsonb_build_object('title', title, 'text', description, 'image', image) into v from market_items where id = p_target_id;
    when 'shared_link' then
      select jsonb_build_object('title', title, 'url', url, 'text', array_to_string(tags, ', ')) into v
        from shared_links where id = p_target_id;
    when 'user' then
      select jsonb_build_object('title', name, 'image', avatar) into v from users where id = p_target_id;
    else v := null;
  end case;
  return coalesce(jsonb_strip_nulls(v) || '{"deleted": false}'::jsonb, '{"deleted": true}'::jsonb);
end;
$$;

-- Same wrapper as 20261122210000, plus chat photos:
--   * delete_content on a chat message names its photo (live or evidence) for removal;
--   * any action on a message its author already deleted names the evidence photo too (the
--     author wanted it gone; it was only kept for this report), and the evidence row is dropped
--     once no open report on the message remains.
create or replace function public.admin_resolve_report(p_report_id uuid, p_action text, p_note text default null, p_days int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r          public.reports;
  v_bucket   text;
  v_path     text;
  v_deleted  boolean := false;
  v_res      jsonb;
begin
  perform public.require_admin();
  select * into r from reports where id = p_report_id;
  if p_action = 'delete_content' and r.target_type = 'food_post' then
    v_bucket := 'food.images';
    select storage_path_from_url(v_bucket, image) into v_path from food_posts where id = r.target_id;
  elsif p_action = 'delete_content' and r.target_type = 'market_item' then
    v_bucket := 'market.images';
    select storage_path_from_url(v_bucket, image) into v_path from market_items where id = r.target_id;
  elsif r.target_type = 'chat_message' then
    v_bucket := 'chat.images';
    select m.deleted_at is not null, coalesce(m.image_path, e.image_path)
      into v_deleted, v_path
      from chat_messages m left join chat_message_evidence e on e.message_id = m.id
     where m.id = r.target_id;
    if not (p_action = 'delete_content' or coalesce(v_deleted, false)) then v_path := null; end if;
  end if;

  v_res := public.admin_resolve_report_core(p_report_id, p_action, p_note, p_days);

  if v_path is not null then
    update moderation_actions
       set details = details || jsonb_build_object('image_bucket', v_bucket, 'image_path', v_path)
     where report_id = p_report_id and action = p_action;
    v_res := v_res || jsonb_build_object('image_bucket', v_bucket, 'image_path', v_path);
  end if;

  if r.target_type = 'chat_message' and coalesce(v_deleted, false)
     and not exists (select 1 from reports
                      where target_type = 'chat_message' and target_id = r.target_id and status = 'open') then
    delete from chat_message_evidence where message_id = r.target_id;
  end if;
  return v_res;
end;
$$;

-- 5 -------------------------------------------------------------------------
-- Per user and bubble: everything up to last_read_at has been seen.
create table public.chat_reads (
  user_id               uuid not null references public.users (id) on delete cascade,
  bubble_id             uuid not null references public.bubbles (id) on delete cascade,
  last_read_at          timestamptz not null,
  last_read_message_id  uuid,
  updated_at            timestamptz not null default now(),
  primary key (user_id, bubble_id)
);
alter table public.chat_reads enable row level security;
create policy chat_reads_select_own on public.chat_reads for select to authenticated
  using (user_id = auth.uid());
create policy require_verified_session on public.chat_reads as restrictive for all to authenticated
  using ((select public.is_session_verified())) with check ((select public.is_session_verified()));
-- Writes go through mark_chat_read().
revoke insert, update, delete on public.chat_reads from anon, authenticated;

-- Marks the chat read up to (and including) p_message_id, the newest message the client shows.
-- Never moves the marker back. Returns the marker.
create function public.mark_chat_read(p_bubble_id uuid, p_message_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at  timestamptz;
  v_out timestamptz;
begin
  perform public.require_verified_session();
  if not public.is_bubble_member(p_bubble_id) then raise exception 'not a member of this bubble'; end if;
  select created_at into v_at from chat_messages where id = p_message_id and bubble_id = p_bubble_id;
  if v_at is null then raise exception 'message not found'; end if;

  insert into chat_reads as cr (user_id, bubble_id, last_read_at, last_read_message_id)
  values (auth.uid(), p_bubble_id, v_at, p_message_id)
  on conflict (user_id, bubble_id) do update
    set last_read_at = greatest(cr.last_read_at, excluded.last_read_at),
        last_read_message_id = case when excluded.last_read_at >= cr.last_read_at
                                    then excluded.last_read_message_id else cr.last_read_message_id end,
        updated_at = now()
  returning last_read_at into v_out;
  return v_out;
end;
$$;
revoke execute on function public.mark_chat_read(uuid, uuid) from public, anon;
grant execute on function public.mark_chat_read(uuid, uuid) to authenticated;

-- One row per approved membership: unread messages from others (capped at 100; clients show
-- "99+"), and the marker the "new messages" divider uses. Without a chat_reads row the marker is
-- the time the user joined, so a new member doesn't start with the bubble's whole history unread.
-- SECURITY INVOKER: chat_messages RLS applies, so blocked senders and unverified sessions count 0.
create function public.chat_unread_counts()
returns table (bubble_id uuid, unread_count int, last_read_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select bm.bubble_id,
         (select count(*)::int from (
            select 1 from public.chat_messages c
             where c.bubble_id = bm.bubble_id
               and c.created_at > coalesce(r.last_read_at, bm.created_at)
               and c.sender_id <> auth.uid()
               and c.deleted_at is null
             limit 100) x),
         coalesce(r.last_read_at, bm.created_at)
    from public.bubble_members bm
    left join public.chat_reads r on r.user_id = bm.user_id and r.bubble_id = bm.bubble_id
   where bm.user_id = auth.uid() and bm.approved
$$;
revoke execute on function public.chat_unread_counts() from public, anon;
grant execute on function public.chat_unread_counts() to authenticated;

-- 6 -------------------------------------------------------------------------
-- Same as 20261122200000 except the chat case (photo flag, deleted messages skipped).
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
          -- Photo messages may have no text, and a message deleted by its author is never pushed.
          select jsonb_build_object('text', content, 'photo', image_path is not null) into v_data
            from public.chat_messages where id = o.target_id and deleted_at is null;
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

-- 7 -------------------------------------------------------------------------
-- One page of a bubble's chat, newest first: the newest p_limit messages, or those just before
-- p_before_id (keyset on (created_at, id), so equal timestamps never skip or repeat a message and
-- clients don't need microsecond-exact timestamps). SECURITY INVOKER: chat_select RLS applies.
-- Embed the sender like a table: rpc('chat_messages_page', ...).select('*, sender:users!sender_id(...)').
create function public.chat_messages_page(p_bubble_id uuid, p_before_id uuid default null, p_limit int default 50)
returns setof public.chat_messages
language sql
stable
security invoker
set search_path = public
as $$
  select m.*
    from public.chat_messages m
   where m.bubble_id = p_bubble_id
     and (p_before_id is null
          or (m.created_at, m.id) < (select b.created_at, b.id from public.chat_messages b
                                       where b.id = p_before_id and b.bubble_id = p_bubble_id))
   order by m.created_at desc, m.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;
revoke execute on function public.chat_messages_page(uuid, uuid, int) from public, anon;
grant execute on function public.chat_messages_page(uuid, uuid, int) to authenticated;
