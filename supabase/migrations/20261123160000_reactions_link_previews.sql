-- Reactions on messages and posts, and link previews for shared links (TODO P2).
-- docs/boolaa-spec.md, "Reactions" and "Link previews".
--
-- REACTIONS
--  1. public.reactions: one row per (user, target, reaction). One table with an "exclusive arc":
--     a nullable foreign key per target table (chat_messages, events, food_posts, market_items,
--     shared_links) and a check that exactly one is set. Why not a bare polymorphic
--     (target_type, target_id) pair: real foreign keys give ON DELETE CASCADE for free (author
--     deletes, admin "Delete content", account deletion, bubble deletion), and one table keeps a
--     single RLS policy, a single RPC and a single realtime subscription per screen. Why not one
--     table per target type: five copies of the same policy, RPC and subscription.
--     target_type / target_id are generated columns, so clients read one shape.
--  2. Fixed set of six reactions, stored as keys (not emoji code points, which differ by
--     variation selector across platforms): like 👍, love ❤️, laugh 😂, wow 😮, sad 😢, thanks 🙏.
--  3. Writes only through toggle_reaction(). Reads: members of the bubble, verified session, and
--     neither the reactor nor the target's author in a block relationship with the reader
--     (target_owner_id is copied from the target on insert; authors never change).
--  4. Soft-deleting a chat message removes its reactions.
--  5. Realtime: in supabase_realtime. INSERT filtered by bubble_id (RLS-checked). DELETE events
--     carry only the primary key and skip RLS, so the key is a random uuid that says nothing;
--     clients keep the rows they loaded and remove deletes by id.
--
-- LINK PREVIEWS
--  6. shared_links.preview_*: status, title, description, site name, image path. Only the
--     service role writes them (a BEFORE trigger resets them on client writes).
--  7. A new link (or a changed URL) is marked `pending` and an AFTER trigger asks the
--     `link-preview` Edge Function to fetch it (pg_net, fire-and-forget, like report-alert).
--     The function claims the row (claim_link_preview), fetches the page through its SSRF guard
--     and stores the result (store_link_preview), only if the URL is still the same.
--     Throttle: at most 30 preview fetches per user per hour; beyond that the link stays plain.
--  8. Images are copied (re-encoded JPEG, max 1200 px, metadata stripped) into the public bucket
--     `link.previews` so clients never load third-party image hosts (no IP leak / tracking).
--     Orphans (deleted links, changed URLs) are swept hourly like bubble photos.
--  9. retry_link_previews() every 10 minutes re-queues lost calls; after a day a link gives up (failed).

-- 1 -------------------------------------------------------------------------
create table public.reactions (
  id               uuid primary key default gen_random_uuid(),
  bubble_id        uuid not null references public.bubbles (id) on delete cascade,
  user_id          uuid not null references public.users (id) on delete cascade,
  reaction         text not null check (reaction in ('like', 'love', 'laugh', 'wow', 'sad', 'thanks')),
  message_id       uuid references public.chat_messages (id) on delete cascade,
  event_id         uuid references public.events (id) on delete cascade,
  food_post_id     uuid references public.food_posts (id) on delete cascade,
  market_item_id   uuid references public.market_items (id) on delete cascade,
  link_id          uuid references public.shared_links (id) on delete cascade,
  target_owner_id  uuid not null,
  target_type      text generated always as (
    case
      when message_id is not null then 'chat_message'
      when event_id is not null then 'event'
      when food_post_id is not null then 'food_post'
      when market_item_id is not null then 'market_item'
      else 'shared_link'
    end) stored,
  target_id        uuid generated always as (
    coalesce(message_id, event_id, food_post_id, market_item_id, link_id)) stored,
  created_at       timestamptz not null default now(),
  constraint reactions_one_target check (num_nonnulls(message_id, event_id, food_post_id, market_item_id, link_id) = 1),
  constraint reactions_unique unique (user_id, target_id, reaction)
);
create index reactions_bubble_target_idx on public.reactions (bubble_id, target_type, target_id);
create index reactions_message_idx on public.reactions (message_id) where message_id is not null;
create index reactions_event_idx   on public.reactions (event_id) where event_id is not null;
create index reactions_food_idx    on public.reactions (food_post_id) where food_post_id is not null;
create index reactions_market_idx  on public.reactions (market_item_id) where market_item_id is not null;
create index reactions_link_idx    on public.reactions (link_id) where link_id is not null;

alter table public.reactions enable row level security;
revoke all on public.reactions from anon, authenticated;
grant select on public.reactions to authenticated;

-- 3 -------------------------------------------------------------------------
create policy reactions_select on public.reactions for select to authenticated
  using (public.is_bubble_member(bubble_id)
         and not public.is_blocked_with(user_id)
         and not public.is_blocked_with(target_owner_id));
create policy require_verified_session on public.reactions as restrictive for all to authenticated
  using ((select public.is_session_verified())) with check ((select public.is_session_verified()));

-- Adds the caller's reaction to a target, or removes it if it is already there.
-- Returns {id, reacted, reaction, target_type, target_id}: `reacted` is the new state, `id` the
-- row that was added or removed (clients merge by id). Raises `invalid reaction` and
-- `reaction target not found` (unknown, other bubble, blocked author, deleted message).
create function public.toggle_reaction(p_target_type text, p_target_id uuid, p_reaction text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bubble  uuid;
  v_owner   uuid;
  v_deleted timestamptz;
  v_id      uuid;
begin
  perform public.require_verified_session();
  if p_reaction is null or p_reaction not in ('like', 'love', 'laugh', 'wow', 'sad', 'thanks') then
    raise exception 'invalid reaction';
  end if;

  case p_target_type
    when 'chat_message' then select bubble_id, sender_id, deleted_at into v_bubble, v_owner, v_deleted from chat_messages where id = p_target_id;
    when 'event'        then select bubble_id, creator_id into v_bubble, v_owner from events where id = p_target_id;
    when 'food_post'    then select bubble_id, user_id into v_bubble, v_owner from food_posts where id = p_target_id;
    when 'market_item'  then select bubble_id, owner_id into v_bubble, v_owner from market_items where id = p_target_id;
    when 'shared_link'  then select bubble_id, user_id into v_bubble, v_owner from shared_links where id = p_target_id;
    else raise exception 'invalid reaction';
  end case;
  if v_bubble is null or v_deleted is not null
     or not public.is_bubble_member(v_bubble) or public.is_blocked_with(v_owner) then
    raise exception 'reaction target not found';
  end if;

  delete from reactions
   where user_id = auth.uid() and target_id = p_target_id and reaction = p_reaction
  returning id into v_id;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'reacted', false, 'reaction', p_reaction,
                              'target_type', p_target_type, 'target_id', p_target_id);
  end if;

  insert into reactions (bubble_id, user_id, reaction, target_owner_id,
                         message_id, event_id, food_post_id, market_item_id, link_id)
  values (v_bubble, auth.uid(), p_reaction, v_owner,
          case when p_target_type = 'chat_message' then p_target_id end,
          case when p_target_type = 'event'        then p_target_id end,
          case when p_target_type = 'food_post'    then p_target_id end,
          case when p_target_type = 'market_item'  then p_target_id end,
          case when p_target_type = 'shared_link'  then p_target_id end)
  on conflict on constraint reactions_unique do nothing
  returning id into v_id;
  if v_id is null then  -- a concurrent toggle inserted it first
    select id into v_id from reactions where user_id = auth.uid() and target_id = p_target_id and reaction = p_reaction;
  end if;
  return jsonb_build_object('id', v_id, 'reacted', true, 'reaction', p_reaction,
                            'target_type', p_target_type, 'target_id', p_target_id);
end;
$$;
revoke execute on function public.toggle_reaction(text, uuid, text) from public, anon;
grant execute on function public.toggle_reaction(text, uuid, text) to authenticated;

-- 4 -------------------------------------------------------------------------
create function public.chat_message_soft_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.reactions where message_id = new.id;
  return null;
end;
$$;
revoke execute on function public.chat_message_soft_deleted() from public, anon, authenticated;
create trigger chat_message_soft_deleted
  after update of deleted_at on public.chat_messages
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.chat_message_soft_deleted();

-- 5 -------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reactions'
  ) then
    alter publication supabase_realtime add table public.reactions;
  end if;
end
$$;

-- 6 -------------------------------------------------------------------------
alter table public.shared_links
  add column preview_status        text not null default 'none'
    check (preview_status in ('none', 'pending', 'fetching', 'ready', 'failed')),
  add column preview_title         text check (char_length(preview_title) <= 200),
  add column preview_description   text check (char_length(preview_description) <= 300),
  add column preview_site_name     text check (char_length(preview_site_name) <= 80),
  add column preview_image_path    text check (preview_image_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'),
  add column preview_requested_at  timestamptz,
  add column preview_claimed_at    timestamptz,
  add column preview_fetched_at    timestamptz;
create index shared_links_preview_requests_idx on public.shared_links (user_id, preview_requested_at)
  where preview_requested_at is not null;

-- Clients (any request with a user) never write preview columns. A new link, or a changed URL,
-- starts over as `pending` (or `none` above the throttle). The service role and security definer
-- functions called by it have no auth.uid() and keep their values.
create function public.shared_links_preview_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.url is not distinct from old.url then
    new.preview_status       := old.preview_status;
    new.preview_title        := old.preview_title;
    new.preview_description  := old.preview_description;
    new.preview_site_name    := old.preview_site_name;
    new.preview_image_path   := old.preview_image_path;
    new.preview_requested_at := old.preview_requested_at;
    new.preview_claimed_at   := old.preview_claimed_at;
    new.preview_fetched_at   := old.preview_fetched_at;
    return new;
  end if;
  new.preview_title := null;
  new.preview_description := null;
  new.preview_site_name := null;
  new.preview_image_path := null;
  new.preview_claimed_at := null;
  new.preview_fetched_at := null;
  if (select count(*) from public.shared_links
       where user_id = new.user_id and preview_requested_at > now() - interval '1 hour') >= 30 then
    new.preview_status := 'none';
    new.preview_requested_at := null;
  else
    new.preview_status := 'pending';
    new.preview_requested_at := now();
  end if;
  return new;
end;
$$;
revoke execute on function public.shared_links_preview_guard() from public, anon, authenticated;
create trigger shared_links_preview_guard
  before insert or update on public.shared_links
  for each row execute function public.shared_links_preview_guard();

-- 7 -------------------------------------------------------------------------
-- Vault: link_preview_url (the function URL) and, optionally, link_preview_secret (sent as
-- x-link-preview-secret; the function requires it when LINK_PREVIEW_SECRET is set).
-- Without the URL nothing is queued and links stay plain.
create function public.notify_link_preview()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url    text;
  v_secret text;
begin
  if new.preview_status <> 'pending'
     or (tg_op = 'UPDATE' and new.url is not distinct from old.url) then
    return null;
  end if;
  begin
    select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'link_preview_url'    limit 1;
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'link_preview_secret' limit 1;
    if v_url is not null then
      perform net.http_post(
        url     := v_url,
        body    := jsonb_build_object('link_id', new.id),
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'x-link-preview-secret', coalesce(v_secret, '')),
        timeout_milliseconds := 20000);
    end if;
  exception when others then
    -- Never let the preview break sharing the link.
    raise warning 'link preview not queued: %', sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.notify_link_preview() from public, anon, authenticated;
create trigger shared_links_notify_preview
  after insert or update of url on public.shared_links
  for each row execute function public.notify_link_preview();

-- The function claims a link before fetching: pending -> fetching (or a claim older than two
-- minutes, from a crashed run). Returns the URL to fetch, or no row. Each URL is fetched once,
-- so calling the function with a link id can't make it fetch anything the trigger wouldn't.
create function public.claim_link_preview(p_link_id uuid)
returns table (url text, bubble_id uuid)
language sql
security definer
set search_path = public
as $$
  update public.shared_links l
     set preview_status = 'fetching', preview_claimed_at = now()
   where l.id = p_link_id
     and (l.preview_status = 'pending'
          or (l.preview_status = 'fetching' and l.preview_claimed_at < now() - interval '2 minutes'))
  returning l.url, l.bubble_id;
$$;
revoke execute on function public.claim_link_preview(uuid) from public, anon, authenticated;
grant execute on function public.claim_link_preview(uuid) to service_role;

-- Stores the result if the link still has the claimed URL. Returns false otherwise (deleted or
-- edited meanwhile); the function then removes the image it uploaded.
create function public.store_link_preview(
  p_link_id uuid,
  p_url text,
  p_status text,
  p_title text default null,
  p_description text default null,
  p_site_name text default null,
  p_image_path text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('ready', 'failed') then raise exception 'invalid preview status'; end if;
  update public.shared_links
     set preview_status      = p_status,
         preview_title       = left(nullif(p_title, ''), 200),
         preview_description = left(nullif(p_description, ''), 300),
         preview_site_name   = left(nullif(p_site_name, ''), 80),
         preview_image_path  = p_image_path,
         preview_fetched_at  = now()
   where id = p_link_id and url = p_url and preview_status = 'fetching';
  return found;
end;
$$;
revoke execute on function public.store_link_preview(uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.store_link_preview(uuid, text, text, text, text, text, text) to service_role;

-- 8 -------------------------------------------------------------------------
-- Public bucket: paths are <link id>/<random uuid>.jpg, written only by the service role (no client
-- policies). The images are copies of public web images, re-encoded without metadata.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('link.previews', 'link.previews', true, 1024 * 1024, array['image/jpeg'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create function public.link_preview_orphans(p_limit int default 100, p_grace interval default interval '1 hour')
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'link.previews'
     and o.created_at < now() - p_grace
     and not exists (select 1 from public.shared_links l where l.preview_image_path = o.name)
   order by o.created_at
   limit p_limit;
$$;
revoke execute on function public.link_preview_orphans(int, interval) from public, anon, authenticated;
grant execute on function public.link_preview_orphans(int, interval) to service_role;

-- Same mechanism and Vault secrets as sweep_bubble_images (storage_sweep_url / storage_sweep_key).
create function public.sweep_link_preview_images(
  p_url text default null,
  p_key text default null,
  p_grace interval default interval '1 hour'
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url   text := p_url;
  v_key   text := p_key;
  v_paths text[];
begin
  if v_url is null then
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'storage_sweep_url' limit 1;
  end if;
  if v_key is null then
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'storage_sweep_key' limit 1;
  end if;
  if v_url is null or v_key is null then
    return 0;
  end if;

  select array_agg(n) into v_paths from public.link_preview_orphans(100, p_grace) as n;
  if v_paths is null then
    return 0;
  end if;

  perform net.http_delete(
    url := rtrim(v_url, '/') || '/storage/v1/object/link.previews',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'apikey', v_key,
      'Content-Type', 'application/json'),
    body := jsonb_build_object('prefixes', to_jsonb(v_paths)),
    timeout_milliseconds := 10000
  );
  return array_length(v_paths, 1);
end;
$$;
revoke execute on function public.sweep_link_preview_images(text, text, interval) from public, anon, authenticated;
grant execute on function public.sweep_link_preview_images(text, text, interval) to service_role;

select cron.schedule('link-previews-sweep', '47 * * * *', 'select public.sweep_link_preview_images()');

-- A call that never arrived (function down, pg_net error) would leave a link `pending` for good.
-- Every 10 minutes: re-queue up to 50 links waiting for more than 2 minutes (or claimed by a
-- run that died), and give up (`failed`) after a day, so clients stop showing "Loading preview…".
create function public.retry_link_previews()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url    text;
  v_secret text;
  v_n      int := 0;
  r        record;
begin
  update public.shared_links set preview_status = 'failed', preview_fetched_at = now()
   where preview_status in ('pending', 'fetching') and preview_requested_at < now() - interval '1 day';

  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'link_preview_url'    limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'link_preview_secret' limit 1;
  if v_url is null then
    return 0;
  end if;
  for r in
    select id from public.shared_links
     where (preview_status = 'pending' and preview_requested_at < now() - interval '2 minutes')
        or (preview_status = 'fetching' and preview_claimed_at < now() - interval '2 minutes')
     order by preview_requested_at
     limit 50
  loop
    perform net.http_post(
      url     := v_url,
      body    := jsonb_build_object('link_id', r.id),
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'x-link-preview-secret', coalesce(v_secret, '')),
      timeout_milliseconds := 20000);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.retry_link_previews() from public, anon, authenticated;
grant execute on function public.retry_link_previews() to service_role;

select cron.schedule('link-previews-retry', '*/10 * * * *', 'select public.retry_link_previews()');
