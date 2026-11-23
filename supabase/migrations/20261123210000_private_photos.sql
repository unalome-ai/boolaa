-- Private photos (docs/boolaa-spec.md, "Images"): every photo bucket is now PRIVATE, like
-- `chat.images` (20261123120000_chat_improvements.sql). Before, anyone holding a URL could open a
-- photo without an account. Now Storage serves an object only to a signed-in, verified caller the
-- policies below allow, and clients show short-lived signed URLs (createSignedUrls, batched per
-- list, cached per storage path).
--
--  1. Buckets avatars, food.images, market.images, bubble.images, link.previews: public = false.
--     The /storage/v1/object/public/... URL of any object now answers 400/404.
--     Row columns are unchanged: users.avatar, food_posts.image, market_items.image and
--     bubbles.logo keep the `/storage/v1/object/public/<bucket>/<path>` form as the object's
--     identifier (check_bubble_logo, storage_path_from_url, moderation cleanup and the sweeps keep
--     working); clients derive the path from it and sign it. shared_links.preview_image_path was
--     already a path. Existing objects keep their paths, so nothing moves.
--  2. can_read_image(bucket, name): the one read rule for these buckets (plus the existing owner,
--     manager and moderation policies):
--       avatars        the owner (existing policy), anyone shares_bubble_with() the owner (same
--                      rule as reading the users row: shared approved bubble, or a join request
--                      to a bubble the caller is in), and admins (the admin users list and
--                      profile reports show avatars).
--       food.images    an approved member of the post's bubble, not blocked either way with the
--       market.images  author (same rule as the row), while a post / item by the folder's owner
--                      references the object. Admins: photos of reported posts / items.
--       bubble.images  an approved member of the bubble (folder = bubble id). The bubble's CURRENT
--                      cover only: a caller with a join request to it (bubble-approval screen), or
--                      one who opened a valid invite preview in the last hour (see 3).
--       link.previews  an approved member of the link's bubble (folder = link id), not blocked
--                      with the link's poster, while the link references the object.
--     Deleting the referencing row (or replacing the photo) cuts access at once; a signed URL
--     already handed out lasts until it expires (1 hour).
--  3. Invite preview: get_invite_preview() records (caller, bubble) in invite_preview_grants when a
--     non-member opens a valid code. That lets the caller sign the cover for one hour, and only
--     the current cover: no Edge Function, the same client signing path as every other photo.
--     Codes stay throttled by require_invite_lookup_allowed().
-- The restrictive "images: require verified session (...)" policies still apply to all of this.
-- The anon role has no select policy on storage.objects, so it reads nothing.

-- 1 -------------------------------------------------------------------------
update storage.buckets set public = false
 where id in ('avatars', 'food.images', 'market.images', 'bubble.images', 'link.previews');

-- 3 (table first: can_read_image reads it) -----------------------------------
create table public.invite_preview_grants (
  user_id    uuid not null references auth.users (id) on delete cascade,
  bubble_id  uuid not null references public.bubbles (id) on delete cascade,
  at         timestamptz not null default now(),
  constraint invite_preview_grants_pkey primary key (user_id, bubble_id)
);
alter table public.invite_preview_grants enable row level security;
revoke all on public.invite_preview_grants from anon, authenticated;

-- 2 -------------------------------------------------------------------------
-- The first folder of an object name as a uuid, or null.
create function public.storage_folder_uuid(p_name text)
returns uuid
language sql
immutable
set search_path = public
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(p_name, '/', 1)::uuid
  end
$$;

create function public.can_read_image(p_bucket text, p_name text)
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
           and ((public.is_bubble_member(f.bubble_id) and not public.is_blocked_with(f.user_id))
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
revoke execute on function public.can_read_image(text, text) from public, anon;
grant execute on function public.can_read_image(text, text) to authenticated;

create policy "images: readers" on storage.objects for select to authenticated
  using (bucket_id in ('avatars', 'food.images', 'market.images', 'bubble.images', 'link.previews')
         and public.can_read_image(bucket_id, name));

-- 3 -------------------------------------------------------------------------
-- Same body as 20261123140000_invite_links.sql, plus the cover grant for a non-member.
create or replace function public.get_invite_preview(p_code text)
returns table (bubble_id uuid, name text, logo text, member_count int, max_size int, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  b       public.bubbles;
  members int;
  code    text := public.normalize_invite_code(p_code);
begin
  perform public.require_verified_session();
  perform public.require_invite_lookup_allowed();

  if char_length(code) between 4 and 32 then
    select * into b from public.bubbles where invite_code = code;
  end if;
  if b.id is null then
    delete from public.invite_lookup_failures where user_id = auth.uid() and at < now() - interval '1 day';
    insert into public.invite_lookup_failures (user_id) values (auth.uid());
    return;
  end if;

  if b.logo is not null and not public.is_bubble_member(b.id) then
    delete from public.invite_preview_grants g where g.user_id = auth.uid() and g.at < now() - interval '1 day';
    insert into public.invite_preview_grants as g (user_id, bubble_id) values (auth.uid(), b.id)
    on conflict on constraint invite_preview_grants_pkey do update set at = now();
  end if;

  select count(*) into members from public.bubble_members m where m.bubble_id = b.id and m.approved;
  return query select
    case when public.is_bubble_member(b.id) then b.id end,
    b.name,
    b.logo,
    members,
    b.max_size,
    case
      when public.is_bubble_member(b.id) then 'member'
      when exists (select 1 from public.join_requests jr where jr.bubble_id = b.id and jr.user_id = auth.uid()) then 'pending'
      when members >= b.max_size then 'full'
      else 'open'
    end;
end;
$$;
