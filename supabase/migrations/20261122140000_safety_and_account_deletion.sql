-- App Store requirements:
--  * Guideline 5.1.1(v): in-app account deletion   -> delete_my_account()
--  * Guideline 1.2 (user-generated content): report objectionable content,
--    block abusive users                              -> reports, blocks
-- Blocking is two-way and enforced by RLS, so blocked users' content also
-- disappears from realtime feeds (realtime applies SELECT policies to inserts).

-- ---------------------------------------------------------------------------
-- Blocks
-- ---------------------------------------------------------------------------
create table public.blocks (
  blocker_id  uuid not null references public.users (id) on delete cascade,
  blocked_id  uuid not null references public.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.blocks enable row level security;

create policy blocks_select_own on public.blocks for select to authenticated
  using (blocker_id = auth.uid());
create policy blocks_insert_own on public.blocks for insert to authenticated
  with check (blocker_id = auth.uid());
create policy blocks_delete_own on public.blocks for delete to authenticated
  using (blocker_id = auth.uid());

-- True when the caller and p_user_id have blocked each other in either direction.
create function public.is_blocked_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = auth.uid() and blocked_id = p_user_id)
       or (blocker_id = p_user_id and blocked_id = auth.uid())
  );
$$;

-- Content policies: same as before, plus hide authors in a block relationship.
drop policy chat_select   on public.chat_messages;
drop policy events_select on public.events;
drop policy food_select   on public.food_posts;
drop policy market_select on public.market_items;
drop policy links_select  on public.shared_links;

create policy chat_select on public.chat_messages for select to authenticated
  using (public.is_bubble_member(bubble_id) and not public.is_blocked_with(sender_id));
create policy events_select on public.events for select to authenticated
  using (public.is_bubble_member(bubble_id) and not public.is_blocked_with(creator_id));
create policy food_select on public.food_posts for select to authenticated
  using (public.is_bubble_member(bubble_id) and not public.is_blocked_with(user_id));
create policy market_select on public.market_items for select to authenticated
  using (public.is_bubble_member(bubble_id) and not public.is_blocked_with(owner_id));
create policy links_select on public.shared_links for select to authenticated
  using (public.is_bubble_member(bubble_id) and not public.is_blocked_with(user_id));

-- ---------------------------------------------------------------------------
-- Reports (moderation queue; readable only by the reporter and service role)
-- ---------------------------------------------------------------------------
create table public.reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid references public.users (id) on delete set null,
  bubble_id    uuid references public.bubbles (id) on delete set null,
  target_type  text not null check (target_type in
                 ('user', 'chat_message', 'event', 'food_post', 'market_item', 'shared_link')),
  target_id    uuid not null,
  reported_user_id uuid references public.users (id) on delete set null,
  reason       text not null check (reason in
                 ('spam', 'harassment', 'hate', 'sexual', 'violence', 'self_harm', 'other')),
  details      text check (char_length(details) <= 1000),
  status       text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at   timestamptz not null default now()
);
create index reports_open_idx on public.reports (status, created_at);
alter table public.reports enable row level security;

create policy reports_select_own on public.reports for select to authenticated
  using (reporter_id = auth.uid());
-- Inserts go through report_content() so the server resolves bubble/author.

-- Report a piece of content (or a user). Resolves the author and bubble on the
-- server so clients cannot forge them; the reporter must be able to see it.
create function public.report_content(p_target_type text, p_target_id uuid, p_reason text, p_details text default null)
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
  if auth.uid() is null then raise exception 'not authenticated'; end if;

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
revoke execute on function public.report_content(text, uuid, text, text) from anon;

-- ---------------------------------------------------------------------------
-- Account deletion
-- ---------------------------------------------------------------------------
-- Deletes the caller's auth user. Cascades remove their profile, memberships
-- (the after-delete trigger hands ownership on / deletes empty bubbles),
-- requests and all content they authored. Clients must delete the user's
-- storage objects (<uid>/... in avatars, food.images, market.images) first:
-- Supabase forbids deleting storage objects with SQL.
create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke execute on function public.delete_my_account() from anon;
