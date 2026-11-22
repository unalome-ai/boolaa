-- Boolaa schema: private, invite-only "bubbles" (small groups) with chat,
-- events, food circle, marketplace and shared links.
-- Shared contract for apps/boolaa-ios (SwiftUI) and apps/boolaa-web (Next.js).

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.users (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null default '',
  avatar      text,
  created_at  timestamptz not null default now()
);

create table public.bubbles (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 1 and 60),
  description  text,
  logo         text,
  max_size     int  not null default 12 check (max_size between 2 and 150),
  invite_code  text not null unique default upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8)),
  created_by   uuid references public.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

create table public.bubble_members (
  user_id     uuid not null references public.users (id) on delete cascade,
  bubble_id   uuid not null references public.bubbles (id) on delete cascade,
  approved    boolean not null default false,
  role        text not null default 'member' check (role in ('owner', 'member')),
  created_at  timestamptz not null default now(),
  primary key (user_id, bubble_id)
);

-- A pending request to join a bubble. Approved once a majority of the
-- current approved members have approved it (see approve_join_request).
create table public.join_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete cascade,
  bubble_id     uuid not null references public.bubbles (id) on delete cascade,
  approver_ids  uuid[] not null default '{}',
  created_at    timestamptz not null default now(),
  unique (user_id, bubble_id)
);

create table public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  bubble_id   uuid not null references public.bubbles (id) on delete cascade,
  sender_id   uuid not null references public.users (id) on delete cascade,
  content     text not null check (char_length(content) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index chat_messages_bubble_created_idx on public.chat_messages (bubble_id, created_at);

create table public.events (
  id           uuid primary key default gen_random_uuid(),
  bubble_id    uuid not null references public.bubbles (id) on delete cascade,
  creator_id   uuid not null references public.users (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 120),
  description  text,
  datetime     timestamptz not null,
  location     text,
  rsvp_list    uuid[] not null default '{}',
  created_at   timestamptz not null default now()
);
create index events_bubble_datetime_idx on public.events (bubble_id, datetime);

create table public.food_posts (
  id           uuid primary key default gen_random_uuid(),
  bubble_id    uuid not null references public.bubbles (id) on delete cascade,
  user_id      uuid not null references public.users (id) on delete cascade,
  image        text not null,
  description  text,
  created_at   timestamptz not null default now()
);
create index food_posts_bubble_created_idx on public.food_posts (bubble_id, created_at desc);

create table public.market_items (
  id           uuid primary key default gen_random_uuid(),
  bubble_id    uuid not null references public.bubbles (id) on delete cascade,
  owner_id     uuid not null references public.users (id) on delete cascade,
  image        text not null,
  title        text not null check (char_length(title) between 1 and 120),
  description  text,
  status       text not null default 'free' check (status in ('free', 'trade')),
  created_at   timestamptz not null default now()
);
create index market_items_bubble_created_idx on public.market_items (bubble_id, created_at desc);

create table public.shared_links (
  id          uuid primary key default gen_random_uuid(),
  bubble_id   uuid not null references public.bubbles (id) on delete cascade,
  user_id     uuid not null references public.users (id) on delete cascade,
  url         text not null check (url ~* '^https?://'),
  title       text,
  tags        text[] not null default '{}',
  created_at  timestamptz not null default now()
);
create index shared_links_bubble_created_idx on public.shared_links (bubble_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Profile row for every auth user (name comes from sign-up metadata)
-- ---------------------------------------------------------------------------

create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, name, avatar)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''),
             nullif(new.raw_user_meta_data ->> 'full_name', ''),
             split_part(coalesce(new.email, ''), '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Membership helpers (security definer to avoid RLS recursion)
-- ---------------------------------------------------------------------------

create function public.is_bubble_member(p_bubble_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.bubble_members
    where bubble_id = p_bubble_id and user_id = auth.uid() and approved
  );
$$;

create function public.shares_bubble_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id = auth.uid()
      or exists (
        select 1
        from public.bubble_members me
        join public.bubble_members them on them.bubble_id = me.bubble_id
        where me.user_id = auth.uid() and me.approved
          and them.user_id = p_user_id
      )
      or exists (  -- requesters are visible to members of the bubble they asked to join
        select 1
        from public.join_requests jr
        join public.bubble_members me on me.bubble_id = jr.bubble_id
        where jr.user_id = p_user_id and me.user_id = auth.uid() and me.approved
      );
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.users          enable row level security;
alter table public.bubbles        enable row level security;
alter table public.bubble_members enable row level security;
alter table public.join_requests  enable row level security;
alter table public.chat_messages  enable row level security;
alter table public.events         enable row level security;
alter table public.food_posts     enable row level security;
alter table public.market_items   enable row level security;
alter table public.shared_links   enable row level security;

-- users
create policy users_select on public.users for select to authenticated
  using (public.shares_bubble_with(id));
create policy users_update_self on public.users for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- bubbles: members see their bubbles; writes go through RPCs, owners may edit
create policy bubbles_select on public.bubbles for select to authenticated
  using (public.is_bubble_member(id)
         or exists (select 1 from public.join_requests jr
                    where jr.bubble_id = bubbles.id and jr.user_id = auth.uid()));
create policy bubbles_update_owner on public.bubbles for update to authenticated
  using (exists (select 1 from public.bubble_members m
                 where m.bubble_id = bubbles.id and m.user_id = auth.uid() and m.role = 'owner'));

-- bubble_members: see your own rows and the members of your bubbles; leave via delete
create policy bubble_members_select on public.bubble_members for select to authenticated
  using (user_id = auth.uid() or public.is_bubble_member(bubble_id));
create policy bubble_members_delete_self on public.bubble_members for delete to authenticated
  using (user_id = auth.uid());

-- join_requests: requester and bubble members can see; requester can cancel
create policy join_requests_select on public.join_requests for select to authenticated
  using (user_id = auth.uid() or public.is_bubble_member(bubble_id));
create policy join_requests_delete_self on public.join_requests for delete to authenticated
  using (user_id = auth.uid());

-- Bubble content: members read; authors write their own rows.
create policy chat_select on public.chat_messages for select to authenticated
  using (public.is_bubble_member(bubble_id));
create policy chat_insert on public.chat_messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_bubble_member(bubble_id));
create policy chat_delete_own on public.chat_messages for delete to authenticated
  using (sender_id = auth.uid());

create policy events_select on public.events for select to authenticated
  using (public.is_bubble_member(bubble_id));
create policy events_insert on public.events for insert to authenticated
  with check (creator_id = auth.uid() and public.is_bubble_member(bubble_id));
create policy events_update_own on public.events for update to authenticated
  using (creator_id = auth.uid()) with check (creator_id = auth.uid());
create policy events_delete_own on public.events for delete to authenticated
  using (creator_id = auth.uid());

create policy food_select on public.food_posts for select to authenticated
  using (public.is_bubble_member(bubble_id));
create policy food_insert on public.food_posts for insert to authenticated
  with check (user_id = auth.uid() and public.is_bubble_member(bubble_id));
create policy food_update_own on public.food_posts for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy food_delete_own on public.food_posts for delete to authenticated
  using (user_id = auth.uid());

create policy market_select on public.market_items for select to authenticated
  using (public.is_bubble_member(bubble_id));
create policy market_insert on public.market_items for insert to authenticated
  with check (owner_id = auth.uid() and public.is_bubble_member(bubble_id));
create policy market_update_own on public.market_items for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy market_delete_own on public.market_items for delete to authenticated
  using (owner_id = auth.uid());

create policy links_select on public.shared_links for select to authenticated
  using (public.is_bubble_member(bubble_id));
create policy links_insert on public.shared_links for insert to authenticated
  with check (user_id = auth.uid() and public.is_bubble_member(bubble_id));
create policy links_update_own on public.shared_links for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy links_delete_own on public.shared_links for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- RPCs (the only way to create bubbles and change membership)
-- ---------------------------------------------------------------------------

-- Create a bubble; caller becomes its approved owner.
create function public.create_bubble(p_name text, p_description text default null, p_max_size int default 12)
returns public.bubbles
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bubbles;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.bubbles (name, description, max_size, created_by)
  values (trim(p_name), nullif(trim(p_description), ''), coalesce(p_max_size, 12), auth.uid())
  returning * into b;
  insert into public.bubble_members (user_id, bubble_id, approved, role)
  values (auth.uid(), b.id, true, 'owner');
  return b;
end;
$$;

-- Ask to join a bubble by its invite code. Creates (or re-uses) a pending
-- join request that existing members then vote on.
create function public.request_to_join(p_invite_code text)
returns public.join_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  b  public.bubbles;
  jr public.join_requests;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
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

-- Approve a pending request. Once approvals reach a strict majority of the
-- approved members, the requester becomes a member and the request is removed.
-- Returns true when the requester was admitted.
create function public.approve_join_request(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  jr        public.join_requests;
  b         public.bubbles;
  members   int;
  approvals int;
begin
  select * into jr from public.join_requests where id = p_request_id for update;
  if not found then raise exception 'request not found'; end if;
  if not public.is_bubble_member(jr.bubble_id) then raise exception 'not a member of this bubble'; end if;

  update public.join_requests
     set approver_ids = array(select distinct unnest(approver_ids || auth.uid()))
   where id = jr.id
   returning * into jr;

  select * into b from public.bubbles where id = jr.bubble_id;
  select count(*) into members from public.bubble_members where bubble_id = jr.bubble_id and approved;
  approvals := coalesce(array_length(jr.approver_ids, 1), 0);

  if approvals * 2 > members then
    if members >= b.max_size then raise exception 'bubble is full'; end if;
    insert into public.bubble_members (user_id, bubble_id, approved, role)
    values (jr.user_id, jr.bubble_id, true, 'member')
    on conflict (user_id, bubble_id) do update set approved = true;
    delete from public.join_requests where id = jr.id;
    return true;
  end if;
  return false;
end;
$$;

-- Any member may decline a pending request.
create function public.reject_join_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  jr public.join_requests;
begin
  select * into jr from public.join_requests where id = p_request_id;
  if not found then return; end if;
  if not public.is_bubble_member(jr.bubble_id) then raise exception 'not a member of this bubble'; end if;
  delete from public.join_requests where id = p_request_id;
end;
$$;

-- Toggle the caller's RSVP on an event in one of their bubbles.
create function public.toggle_rsvp(p_event_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.events;
begin
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

revoke execute on function public.create_bubble(text, text, int)   from anon;
revoke execute on function public.request_to_join(text)            from anon;
revoke execute on function public.approve_join_request(uuid)       from anon;
revoke execute on function public.reject_join_request(uuid)        from anon;
revoke execute on function public.toggle_rsvp(uuid)                from anon;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.chat_messages;

-- ---------------------------------------------------------------------------
-- Storage: public-read image buckets; uploads go under "<auth.uid()>/..."
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('food.images', 'food.images', true),
       ('market.images', 'market.images', true),
       ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "images: owners upload" on storage.objects for insert to authenticated
  with check (bucket_id in ('food.images', 'market.images', 'avatars')
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy "images: owners update" on storage.objects for update to authenticated
  using (bucket_id in ('food.images', 'market.images', 'avatars')
         and (storage.foldername(name))[1] = auth.uid()::text);
create policy "images: owners delete" on storage.objects for delete to authenticated
  using (bucket_id in ('food.images', 'market.images', 'avatars')
         and (storage.foldername(name))[1] = auth.uid()::text);
