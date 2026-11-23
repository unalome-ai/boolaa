-- Requests ("I want it") on food posts and marketplace items, the owner picking who gets it, and
-- food expiry. docs/boolaa-spec.md "Requests and picking", "Food expiry", "Marketplace availability".
--
-- FOOD EXPIRY
--  1. food_posts.expires_at (required). Clients send it (Today / Tomorrow / In 3 days / custom; the
--     default is Tomorrow, end of the day in the user's time zone). On a client insert, or a client
--     update that changes it, it must be in the future and at most 14 days ahead ('invalid expiry').
--     Old clients that don't send it get now() + 2 days. Existing rows: created_at + 2 days, but at
--     least now() + 1 day, so no post vanishes the moment this ships without its owner seeing why.
--  2. food_select hides expired posts from everyone, the owner included (RLS, so feeds, live
--     updates, search, Home and photo signing all follow). Nothing fires when a post expires:
--     clients also drop posts whose expires_at has passed, with a timer.
--
-- REQUESTS
--  3. food_posts.availability (available / reserved / taken, like market_items.availability) and
--     handed_over_at. Food availability is written only by the RPCs below (column grant).
--     A handed-over food post (taken) stays readable for an hour so members get the UPDATE live and
--     drop it (clients never render taken food), then the sweep deletes it.
--  4. item_requests: one row per (requester, item), an exclusive arc to food_posts / market_items
--     (cascades like reactions). status: pending -> picked (the owner chose you) -> received (handed
--     over to you) | missed (handed over to someone else). The winner is never stored on the item
--     row: only the owner and the requester can read a request (RLS), everyone else sees
--     request_count (pending + picked), a column on the item kept by trigger, which reaches every
--     member through the existing live feeds.
--  5. Writes only through RPCs: request_item, withdraw_item_request, pick_item_request, unpick_item,
--     hand_over_item. The item row is locked first in every RPC (FOR UPDATE), then the request, so
--     two picks, a pick and a withdrawal, or a request and a pick serialise; a partial unique index
--     allows one picked/received request per item whatever happens.
--  6. One rule ties request states to the item's availability, whoever changes it (an RPC or the
--     market owner's manual "Mark as"), in item_availability_changed():
--       -> available: every request is pending again (pick cleared, requests kept)
--       -> reserved:  a received request goes back to picked, missed ones to pending
--       -> taken:     the picked request becomes received, the pending ones missed
--  7. Cleanup: leaving / being removed from a bubble deletes your requests there and the requests on
--     your items there; a block (either direction) deletes the requests between the two people;
--     deleting the picked request (withdrawal, leave, block, account deletion) frees the item
--     (reserved -> available). Account, bubble and item deletion cascade.
--  8. Push (outbox + push-dispatch): item_request (owner), item_picked and item_missed (requester,
--     "missed" only at hand-over, never at pick time: a pick can be undone), item_request_withdrawn
--     (owner, when the picked person withdraws). Two new prefs: item_requests (owner side),
--     request_updates (requester side), both on by default. Mutes, blocks and inactive accounts are
--     respected as for every type.
--  9. pg_cron every 15 minutes: sweep_food_posts() deletes food expired for more than 24 hours and
--     food handed over more than an hour ago (posts with an open report are kept for moderation),
--     then deletes orphaned objects in food.images through the Storage API (same Vault secrets and
--     pg_net mechanism as sweep_bubble_images).
-- 10. search_bubble skips handed-over food (expired food is already hidden by RLS); export_my_data
--     adds the user's requests and the requests on their items; claim_push_batch renders the new
--     types; can_read_image refuses photos of expired food.

-- 1 -------------------------------------------------------------------------
alter table public.food_posts
  add column expires_at      timestamptz,
  add column availability    text not null default 'available'
    check (availability in ('available', 'reserved', 'taken')),
  add column handed_over_at  timestamptz,
  add column request_count   int not null default 0 check (request_count >= 0);

update public.food_posts
   set expires_at = greatest(created_at + interval '2 days', now() + interval '1 day');

alter table public.food_posts
  alter column expires_at set default (now() + interval '2 days'),
  alter column expires_at set not null;

create index food_posts_expires_idx on public.food_posts (expires_at);
create index food_posts_handed_over_idx on public.food_posts (handed_over_at) where handed_over_at is not null;

comment on column public.food_posts.expires_at is
  'Required. Client writes: in the future and at most 14 days ahead. Expired posts are hidden by RLS and swept after 24 h.';
comment on column public.food_posts.availability is
  'available | reserved | taken. Written only by the request RPCs. Taken (handed over) food is never rendered and is swept after 1 h.';
comment on column public.food_posts.request_count is
  'Open requests (pending + picked), kept by trigger. Who asked is visible only to the owner.';

alter table public.market_items
  add column request_count int not null default 0 check (request_count >= 0);
comment on column public.market_items.request_count is
  'Open requests (pending + picked), kept by trigger. Who asked is visible only to the owner.';

-- Clients may update only the editable food fields (like market_items since 20261123170000).
revoke update on public.food_posts from anon, authenticated;
grant update (image, description, expires_at) on public.food_posts to authenticated;

-- Client writes (any request with a user): fresh state on insert, expiry within limits, and
-- handed_over_at follows availability. Writes without a user (seed, service role, cron) keep values.
create function public.food_posts_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.availability := 'available';
      new.handed_over_at := null;
      new.request_count := 0;
    end if;
    if new.expires_at is null then
      new.expires_at := now() + interval '2 days';
    end if;
  elsif new.availability is distinct from old.availability then
    new.handed_over_at := case when new.availability = 'taken' then now() end;
  end if;
  if auth.uid() is not null
     and (tg_op = 'INSERT' or new.expires_at is distinct from old.expires_at)
     and (new.expires_at <= now() or new.expires_at > now() + interval '14 days') then
    raise exception 'invalid expiry' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function public.food_posts_guard() from public, anon, authenticated;
create trigger food_posts_guard
  before insert or update on public.food_posts
  for each row execute function public.food_posts_guard();

create function public.market_items_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.request_count := 0;
  end if;
  return new;
end;
$$;
revoke execute on function public.market_items_guard() from public, anon, authenticated;
create trigger market_items_guard
  before insert on public.market_items
  for each row execute function public.market_items_guard();

-- 2 -------------------------------------------------------------------------
drop policy food_select on public.food_posts;
create policy food_select on public.food_posts for select to authenticated
  using (public.is_bubble_member(bubble_id) and not public.is_blocked_with(user_id) and expires_at > now());

-- 4 -------------------------------------------------------------------------
create table public.item_requests (
  id                 uuid primary key default gen_random_uuid(),
  bubble_id          uuid not null references public.bubbles (id) on delete cascade,
  owner_id           uuid not null references public.users (id) on delete cascade,
  requester_id       uuid not null references public.users (id) on delete cascade,
  food_post_id       uuid references public.food_posts (id) on delete cascade,
  market_item_id     uuid references public.market_items (id) on delete cascade,
  item_kind          text generated always as (case when food_post_id is not null then 'food' else 'market' end) stored,
  item_id            uuid generated always as (coalesce(food_post_id, market_item_id)) stored,
  note               text check (note is null or char_length(note) between 1 and 200),
  status             text not null default 'pending' check (status in ('pending', 'picked', 'received', 'missed')),
  created_at         timestamptz not null default now(),
  status_changed_at  timestamptz not null default now(),
  constraint item_requests_one_item check (num_nonnulls(food_post_id, market_item_id) = 1),
  constraint item_requests_not_own check (requester_id <> owner_id),
  constraint item_requests_unique unique (requester_id, item_id)
);
-- At most one winner per item, whatever the interleaving.
create unique index item_requests_one_pick on public.item_requests (item_id) where status in ('picked', 'received');
create index item_requests_item_idx on public.item_requests (item_id);
create index item_requests_food_idx on public.item_requests (food_post_id) where food_post_id is not null;
create index item_requests_market_idx on public.item_requests (market_item_id) where market_item_id is not null;
create index item_requests_owner_idx on public.item_requests (owner_id);
create index item_requests_bubble_idx on public.item_requests (bubble_id);

alter table public.item_requests enable row level security;
revoke all on public.item_requests from anon, authenticated;
grant select on public.item_requests to authenticated;

-- A requester sees their own requests; the owner sees the requests on their items (never from
-- someone in a block relationship with them: blocks delete those rows anyway, see 7).
create policy item_requests_select on public.item_requests for select to authenticated
  using (public.is_bubble_member(bubble_id)
         and (requester_id = auth.uid()
              or (owner_id = auth.uid() and not public.is_blocked_with(requester_id))));
create policy require_verified_session on public.item_requests as restrictive for all to authenticated
  using ((select public.is_session_verified())) with check ((select public.is_session_verified()));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'item_requests'
  ) then
    alter publication supabase_realtime add table public.item_requests;
  end if;
end
$$;

-- Internal helpers ------------------------------------------------------------

-- Locks the item row (FOR UPDATE) and returns what the RPCs check. All nulls when it doesn't exist.
-- o_label: the market title, or the food description (may be null).
create function public.lock_request_item(
  p_kind text, p_item_id uuid,
  out o_bubble_id uuid, out o_owner_id uuid, out o_availability text, out o_expired boolean, out o_label text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind = 'food' then
    select f.bubble_id, f.user_id, f.availability, f.expires_at <= now(), f.description
      into o_bubble_id, o_owner_id, o_availability, o_expired, o_label
      from public.food_posts f where f.id = p_item_id for update;
  elsif p_kind = 'market' then
    select i.bubble_id, i.owner_id, i.availability, false, i.title
      into o_bubble_id, o_owner_id, o_availability, o_expired, o_label
      from public.market_items i where i.id = p_item_id for update;
  else
    raise exception 'invalid item kind';
  end if;
end;
$$;

create function public.set_item_availability(p_kind text, p_item_id uuid, p_availability text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind = 'food' then
    update public.food_posts set availability = p_availability
     where id = p_item_id and availability is distinct from p_availability;
  else
    update public.market_items set availability = p_availability
     where id = p_item_id and availability is distinct from p_availability;
  end if;
end;
$$;

create function public.refresh_item_request_count(p_kind text, p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v int;
begin
  select count(*) into v from public.item_requests
   where item_id = p_item_id and status in ('pending', 'picked');
  if p_kind = 'food' then
    update public.food_posts set request_count = v where id = p_item_id and request_count <> v;
  else
    update public.market_items set request_count = v where id = p_item_id and request_count <> v;
  end if;
end;
$$;

-- 6 -------------------------------------------------------------------------
create function public.item_availability_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.availability = 'available' then
    update public.item_requests set status = 'pending', status_changed_at = now()
     where item_id = new.id and status <> 'pending';
  elsif new.availability = 'reserved' then
    update public.item_requests
       set status = case status when 'received' then 'picked' else 'pending' end, status_changed_at = now()
     where item_id = new.id and status in ('received', 'missed');
  else
    update public.item_requests
       set status = case status when 'picked' then 'received' else 'missed' end, status_changed_at = now()
     where item_id = new.id and status in ('picked', 'pending');
  end if;
  return null;
end;
$$;
create trigger food_posts_availability_changed
  after update of availability on public.food_posts
  for each row when (old.availability is distinct from new.availability)
  execute function public.item_availability_changed();
create trigger market_items_availability_changed
  after update of availability on public.market_items
  for each row when (old.availability is distinct from new.availability)
  execute function public.item_availability_changed();

-- 4 + 7 + 8: counts, freeing the item when its pick goes, pushes. Never fails the write because of a push.
create function public.item_requests_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_item uuid;
begin
  if tg_op = 'DELETE' then
    v_kind := old.item_kind;
    v_item := old.item_id;
  else
    v_kind := new.item_kind;
    v_item := new.item_id;
  end if;
  perform public.refresh_item_request_count(v_kind, v_item);

  if tg_op = 'DELETE' then
    if old.status = 'picked' then
      if v_kind = 'food' then
        update public.food_posts set availability = 'available' where id = v_item and availability = 'reserved';
      else
        update public.market_items set availability = 'available' where id = v_item and availability = 'reserved';
      end if;
    end if;
    return null;
  end if;

  begin
    if tg_op = 'INSERT' then
      perform public.push_enqueue('item_request', new.bubble_id, new.requester_id, new.item_id,
        array[new.owner_id], jsonb_build_object('request_id', new.id, 'kind', new.item_kind),
        'item_request:' || new.item_id,
        -- one push per (item, requester), even if they withdraw and ask again
        'item_request:' || new.item_id || ':' || new.requester_id);
    elsif new.status is distinct from old.status then
      if new.status = 'picked' then
        perform public.push_enqueue('item_picked', new.bubble_id, new.owner_id, new.item_id,
          array[new.requester_id], jsonb_build_object('request_id', new.id, 'kind', new.item_kind),
          'item:' || new.item_id);
      elsif new.status = 'missed' then
        perform public.push_enqueue('item_missed', new.bubble_id, new.owner_id, new.item_id,
          array[new.requester_id], jsonb_build_object('request_id', new.id, 'kind', new.item_kind),
          'item:' || new.item_id, 'item_missed:' || new.id);
      end if;
    end if;
  exception when others then
    raise warning 'push not enqueued (item_requests): %', sqlerrm;
  end;
  return null;
end;
$$;
create trigger item_requests_changed
  after insert or delete or update of status on public.item_requests
  for each row execute function public.item_requests_changed();

-- 7 -------------------------------------------------------------------------
create function public.item_requests_on_member_removed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.item_requests
   where bubble_id = old.bubble_id and (requester_id = old.user_id or owner_id = old.user_id);
  return null;
end;
$$;
create trigger item_requests_on_member_removed
  after delete on public.bubble_members
  for each row execute function public.item_requests_on_member_removed();

create function public.item_requests_on_block()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.item_requests
   where (requester_id = new.blocker_id and owner_id = new.blocked_id)
      or (requester_id = new.blocked_id and owner_id = new.blocker_id);
  return null;
end;
$$;
create trigger item_requests_on_block
  after insert on public.blocks
  for each row execute function public.item_requests_on_block();

-- 5: RPCs ---------------------------------------------------------------------

-- Ask for an item. p_kind 'food' | 'market'. p_note optional, trimmed, at most 200 characters.
-- Returns the new request row. Errors: invalid item kind, request note too long, item not found,
-- cannot request own item, already requested, item not available (+ the session errors).
create function public.request_item(p_kind text, p_item_id uuid, p_note text default null)
returns public.item_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  it     record;
  v_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '\s+', ' ', 'g')), '');
  r      public.item_requests;
begin
  perform public.require_verified_session();
  if p_kind is null or p_kind not in ('food', 'market') then raise exception 'invalid item kind'; end if;
  if char_length(v_note) > 200 then raise exception 'request note too long'; end if;

  select * into it from public.lock_request_item(p_kind, p_item_id);
  if it.o_bubble_id is null or not public.is_bubble_member(it.o_bubble_id)
     or public.is_blocked_with(it.o_owner_id) then
    raise exception 'item not found';
  end if;
  if it.o_owner_id = auth.uid() then raise exception 'cannot request own item'; end if;
  if exists (select 1 from public.item_requests where requester_id = auth.uid() and item_id = p_item_id) then
    raise exception 'already requested';
  end if;
  -- Still available, not expired, and its owner is still in the bubble.
  if it.o_expired or it.o_availability <> 'available' or public.bubble_role(it.o_bubble_id, it.o_owner_id) is null then
    raise exception 'item not available';
  end if;

  insert into public.item_requests (bubble_id, owner_id, requester_id, food_post_id, market_item_id, note)
  values (it.o_bubble_id, it.o_owner_id, auth.uid(),
          case when p_kind = 'food' then p_item_id end,
          case when p_kind = 'market' then p_item_id end,
          v_note)
  on conflict on constraint item_requests_unique do nothing
  returning * into r;
  if r.id is null then raise exception 'already requested'; end if;
  return r;
end;
$$;

-- The requester takes their request back, while it is pending or picked (before the hand-over).
-- Withdrawing the picked request frees the item and tells the owner. Returns false when the caller
-- has no such request (already gone: idempotent). Error: request already decided.
create function public.withdraw_item_request(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.item_requests;
begin
  perform public.require_verified_session();
  select * into r from public.item_requests where id = p_request_id and requester_id = auth.uid();
  if not found then return false; end if;
  perform public.lock_request_item(r.item_kind, r.item_id);
  select * into r from public.item_requests where id = p_request_id and requester_id = auth.uid() for update;
  if not found then return false; end if;
  if r.status in ('received', 'missed') then raise exception 'request already decided'; end if;

  delete from public.item_requests where id = r.id;
  if r.status = 'picked' then
    begin
      perform public.push_enqueue('item_request_withdrawn', r.bubble_id, r.requester_id, r.item_id,
        array[r.owner_id], jsonb_build_object('request_id', r.id, 'kind', r.item_kind),
        'item_request:' || r.item_id);
    exception when others then
      raise warning 'push not enqueued (item_request_withdrawn): %', sqlerrm;
    end;
  end if;
  return true;
end;
$$;

-- The owner picks who gets it: that request becomes `picked` (any previous pick goes back to
-- pending) and the item `reserved`. Picking the current pick again is a no-op. Returns the picked
-- row. Errors: item request gone (unknown, not on your item, withdrawn), item not found,
-- item not available (taken or expired).
create function public.pick_item_request(p_request_id uuid)
returns public.item_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  r  public.item_requests;
  it record;
begin
  perform public.require_verified_session();
  select * into r from public.item_requests where id = p_request_id and owner_id = auth.uid();
  if not found then raise exception 'item request gone'; end if;
  select * into it from public.lock_request_item(r.item_kind, r.item_id);
  if it.o_bubble_id is null or not public.is_bubble_member(it.o_bubble_id) then raise exception 'item not found'; end if;
  select * into r from public.item_requests where id = p_request_id and owner_id = auth.uid() for update;
  if not found or public.is_blocked_with(r.requester_id) then raise exception 'item request gone'; end if;
  if it.o_expired or it.o_availability = 'taken' then raise exception 'item not available'; end if;
  if r.status = 'picked' then return r; end if;

  update public.item_requests set status = 'pending', status_changed_at = now()
   where item_id = r.item_id and status = 'picked';
  update public.item_requests set status = 'picked', status_changed_at = now()
   where id = r.id
  returning * into r;
  perform public.set_item_availability(r.item_kind, r.item_id, 'reserved');
  return r;
end;
$$;

-- Undo the pick: the item goes back to available and every request to pending (requests are kept).
-- Also clears a manual "reserved" on a market item. No-op when already available.
-- Errors: invalid item kind, item not found, not your item, item not available (taken or expired).
create function public.unpick_item(p_kind text, p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  it record;
begin
  perform public.require_verified_session();
  select * into it from public.lock_request_item(p_kind, p_item_id);
  if it.o_bubble_id is null or not public.is_bubble_member(it.o_bubble_id) then raise exception 'item not found'; end if;
  if it.o_owner_id <> auth.uid() then raise exception 'not your item'; end if;
  if it.o_expired or it.o_availability = 'taken' then raise exception 'item not available'; end if;
  perform public.set_item_availability(p_kind, p_item_id, 'available');
end;
$$;

-- The owner handed it to the picked person: the item becomes taken (food: disappears for everyone),
-- the pick `received`, every other request `missed` (they get "Someone else got it").
-- Returns the winner's request row. Errors: invalid item kind, item not found, not your item,
-- item not available (taken or expired), nothing picked.
create function public.hand_over_item(p_kind text, p_item_id uuid)
returns public.item_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  it record;
  r  public.item_requests;
begin
  perform public.require_verified_session();
  select * into it from public.lock_request_item(p_kind, p_item_id);
  if it.o_bubble_id is null or not public.is_bubble_member(it.o_bubble_id) then raise exception 'item not found'; end if;
  if it.o_owner_id <> auth.uid() then raise exception 'not your item'; end if;
  if it.o_expired or it.o_availability = 'taken' then raise exception 'item not available'; end if;
  select * into r from public.item_requests where item_id = p_item_id and status = 'picked' for update;
  if not found then raise exception 'nothing picked'; end if;

  perform public.set_item_availability(p_kind, p_item_id, 'taken');
  select * into r from public.item_requests where id = r.id;
  return r;
end;
$$;

revoke execute on function
  public.lock_request_item(text, uuid), public.set_item_availability(text, uuid, text),
  public.refresh_item_request_count(text, uuid), public.item_availability_changed(),
  public.item_requests_changed(), public.item_requests_on_member_removed(), public.item_requests_on_block()
  from public, anon, authenticated;
revoke execute on function
  public.request_item(text, uuid, text), public.withdraw_item_request(uuid), public.pick_item_request(uuid),
  public.unpick_item(text, uuid), public.hand_over_item(text, uuid)
  from public, anon;
grant execute on function
  public.request_item(text, uuid, text), public.withdraw_item_request(uuid), public.pick_item_request(uuid),
  public.unpick_item(text, uuid), public.hand_over_item(text, uuid)
  to authenticated;

-- 8: push ---------------------------------------------------------------------
alter table public.notification_prefs
  add column item_requests   boolean not null default true,   -- someone asks for / withdraws from my item
  add column request_updates boolean not null default true;   -- my request was picked / someone else got it

alter table public.notification_outbox drop constraint notification_outbox_type_check;
alter table public.notification_outbox add constraint notification_outbox_type_check check (type in
  ('chat', 'join_request', 'approval', 'new_event', 'event_reminder', 'food', 'market',
   'item_request', 'item_request_withdrawn', 'item_picked', 'item_missed'));

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

-- What a request push shows about its item: {kind, item} (item = market title or food description,
-- may be null), or null when the item is gone (or, with p_live, expired or handed over).
create function public.item_push_data(p_kind text, p_item_id uuid, p_live boolean)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case p_kind
    when 'food' then (select jsonb_build_object('kind', 'food', 'item', f.description)
                        from public.food_posts f
                       where f.id = p_item_id
                         and (not p_live or (f.expires_at > now() and f.availability <> 'taken')))
    when 'market' then (select jsonb_build_object('kind', 'market', 'item', i.title)
                          from public.market_items i
                         where i.id = p_item_id and (not p_live or i.availability <> 'taken'))
  end
$$;
revoke execute on function public.item_push_data(text, uuid, boolean) from public, anon, authenticated;

-- Same as 20261123120000_chat_improvements.sql, plus: new food posts that expired or were handed
-- over before the push went out are skipped, and the four request types.
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

-- 9: cleanup ------------------------------------------------------------------

-- Objects in food.images that no food post points at, oldest first, older than p_grace (covers an
-- upload whose insert is still in flight). Includes photos of swept, deleted and edited posts.
create function public.food_image_orphans(p_limit int default 100, p_grace interval default interval '1 hour')
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  with refs as (
    select public.storage_path_from_url('food.images', f.image) as p from public.food_posts f
  )
  select o.name
    from storage.objects o
   where o.bucket_id = 'food.images'
     and o.created_at < now() - p_grace
     and not exists (select 1 from refs where refs.p = o.name)
   order by o.created_at
   limit p_limit;
$$;
revoke execute on function public.food_image_orphans(int, interval) from public, anon, authenticated;
grant execute on function public.food_image_orphans(int, interval) to service_role;

-- Food rows the sweep deletes: expired for more than p_expired_grace, or handed over more than
-- p_taken_grace ago. Posts with an open report stay until it is handled (moderation reads them).
create function public.food_posts_due_for_sweep(
  p_expired_grace interval default interval '24 hours',
  p_taken_grace interval default interval '1 hour',
  p_limit int default 500
)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select f.id
    from public.food_posts f
   where (f.expires_at < now() - p_expired_grace
          or (f.availability = 'taken' and f.handed_over_at < now() - p_taken_grace))
     and not exists (select 1 from public.reports r
                      where r.target_type = 'food_post' and r.target_id = f.id and r.status = 'open')
   order by f.expires_at
   limit p_limit;
$$;
revoke execute on function public.food_posts_due_for_sweep(interval, interval, int) from public, anon, authenticated;
grant execute on function public.food_posts_due_for_sweep(interval, interval, int) to service_role;

-- pg_cron every 15 minutes. Deletes the due rows (their requests and reactions cascade; members get
-- the DELETE live), then asks the Storage API to delete up to 100 orphaned food photos (pg_net,
-- fire-and-forget; anything missed is still an orphan on the next run). Returns
-- {deleted_posts, photos_requested}. URL and key from Vault unless given (tests pass them).
-- Without the Vault secrets rows are still deleted and photos wait for them.
create function public.sweep_food_posts(
  p_url text default null,
  p_key text default null,
  p_photo_grace interval default interval '1 hour',
  p_expired_grace interval default interval '24 hours',
  p_taken_grace interval default interval '1 hour'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url     text := p_url;
  v_key     text := p_key;
  v_deleted int;
  v_paths   text[];
begin
  delete from public.food_posts
   where id in (select public.food_posts_due_for_sweep(p_expired_grace, p_taken_grace, 500));
  get diagnostics v_deleted = row_count;

  if v_url is null then
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'storage_sweep_url' limit 1;
  end if;
  if v_key is null then
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'storage_sweep_key' limit 1;
  end if;
  if v_url is not null and v_key is not null then
    select array_agg(n) into v_paths from public.food_image_orphans(100, p_photo_grace) as n;
    if v_paths is not null then
      perform net.http_delete(
        url := rtrim(v_url, '/') || '/storage/v1/object/food.images',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || v_key,
          'apikey', v_key,
          'Content-Type', 'application/json'),
        body := jsonb_build_object('prefixes', to_jsonb(v_paths)),
        timeout_milliseconds := 10000
      );
    end if;
  end if;
  return jsonb_build_object('deleted_posts', v_deleted, 'photos_requested', coalesce(array_length(v_paths, 1), 0));
end;
$$;
revoke execute on function public.sweep_food_posts(text, text, interval, interval, interval) from public, anon, authenticated;
grant execute on function public.sweep_food_posts(text, text, interval, interval, interval) to service_role;

select cron.schedule('food-posts-sweep', '*/15 * * * *', 'select public.sweep_food_posts()');

-- 10 ------------------------------------------------------------------------

-- Photos: same as 20261123210000_private_photos.sql, except that a member can't sign the photo of
-- an expired food post (the row is hidden too). Admins keep reading photos of reported posts.
create or replace function public.can_read_image(p_bucket text, p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_folder uuid := public.storage_folder_uuid(p_name);
begin
  if v_folder is null or auth.uid() is null or p_name like '%..%' then
    return false;
  end if;
  case p_bucket
    when 'avatars' then
      return public.shares_bubble_with(v_folder) or public.is_admin();
    when 'food.images' then
      return exists (
        select 1 from food_posts f
         where f.user_id = v_folder
           and public.storage_path_from_url('food.images', f.image) = p_name
           and ((public.is_bubble_member(f.bubble_id) and not public.is_blocked_with(f.user_id) and f.expires_at > now())
                or (public.is_admin() and exists (
                      select 1 from reports r where r.target_type = 'food_post' and r.target_id = f.id))));
    when 'market.images' then
      return exists (
        select 1 from market_items i
         where i.owner_id = v_folder
           and public.storage_path_from_url('market.images', i.image) = p_name
           and ((public.is_bubble_member(i.bubble_id) and not public.is_blocked_with(i.owner_id))
                or (public.is_admin() and exists (
                      select 1 from reports r where r.target_type = 'market_item' and r.target_id = i.id))));
    when 'bubble.images' then
      return public.is_bubble_member(v_folder)
          or (public.is_session_verified() and exists (
                select 1 from bubbles b
                 where b.id = v_folder
                   and public.storage_path_from_url('bubble.images', b.logo) = p_name
                   and (exists (select 1 from join_requests jr where jr.bubble_id = b.id and jr.user_id = auth.uid())
                        or exists (select 1 from invite_preview_grants g
                                    where g.bubble_id = b.id and g.user_id = auth.uid()
                                      and g.at > now() - interval '1 hour'))));
    when 'link.previews' then
      return exists (
        select 1 from shared_links l
         where l.id = v_folder and l.preview_image_path = p_name
           and public.is_bubble_member(l.bubble_id) and not public.is_blocked_with(l.user_id));
    else
      return false;
  end case;
end;
$$;

-- Search: the 20261123180000 function, renamed to search_bubble_core, plus a filter for handed-over
-- food (still readable for an hour so members get the UPDATE, but never shown). Same signature and
-- rows; still SECURITY INVOKER (RLS decides, which already hides expired food).
alter function public.search_bubble(uuid, text, int, text[]) rename to search_bubble_core;
revoke execute on function public.search_bubble_core(uuid, text, int, text[]) from public, anon, authenticated;

create function public.search_bubble(
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
language sql
stable
security invoker
set search_path = public
as $$
  select s.*
    from public.search_bubble_core(p_bubble_id, p_query, p_limit, p_kinds) s
   where s.kind <> 'food_post'
      or exists (select 1 from public.food_posts f where f.id = s.id and f.availability <> 'taken')
$$;
revoke execute on function public.search_bubble(uuid, text, int, text[]) from public, anon;
grant execute on function public.search_bubble(uuid, text, int, text[]) to authenticated;
-- The wrapper runs as the caller, who needs to execute the core too.
grant execute on function public.search_bubble_core(uuid, text, int, text[]) to authenticated;

-- Data export: the 20261123200000 function, renamed to export_my_data_core (same gate, rate limit
-- and document), plus food expiry / availability and the requests:
--   item_requests         the user's own requests (note, status, times); the item's label only
--                         while the user can still see the item (member, no block, food not expired
--                         or handed over), like rsvps.
--   requests_on_my_items  requests others made on the user's items: requester id, note, status,
--                         times. The owner sees exactly this in the app (requests from people they
--                         are in a block relationship with are deleted, and skipped here anyway).
alter function public.export_my_data() rename to export_my_data_core;
revoke execute on function public.export_my_data_core() from public, anon, authenticated;

create function public.export_my_data()
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
revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
