-- Bubble logo (cover image): upload, replace, remove, shown wherever a bubble is shown
-- (docs/boolaa-spec.md, "Bubble logo").
--
--   1. can_manage_bubble(p_bubble_id): the one place that decides who may edit a bubble's
--      details and logo. Today that is the owner (role 'owner', approved). When bubble roles
--      (admins, TODO P2) arrive, widen this function and every policy below follows.
--   2. bubbles: the update policy uses it (with a WITH CHECK this time), and clients may update
--      only name, description and logo. Before, the table-wide grant let an owner rewrite
--      invite_code, max_size and created_by directly.
--   3. bubbles.logo may only be null or the public URL of an existing object in bucket
--      `bubble.images` under this bubble's own folder (no external URLs, no other bubble's file).
--      The host part is not checked (it differs per environment).
--   4. Bucket `bubble.images` (public, 2 MB, JPEG/WebP like avatars). Object paths are
--      `<bubble id>/<uuid>.jpg`, NOT `<auth uid>/...`: the logo belongs to the bubble, not to its
--      uploader. So when ownership passes to another member (owner left or deleted their
--      account), the new owner can replace or remove the old file, and deleting the uploader's
--      account (which wipes their `<uid>/` folders) doesn't break the bubble's logo.
--      Whoever can_manage_bubble() may insert, update, delete and see (list) objects in that
--      folder; everyone reads through the public URL.
--   5. Cleanup. Clients delete the old object right after replacing or removing the logo (best
--      effort, as for avatars). Everything they miss — a failed delete, an upload whose row update
--      failed, and the logo of a deleted bubble (last member left, account deletion, ban) —
--      is an orphan: an object in `bubble.images` that no bubbles.logo points at.
--      SQL can't delete storage objects (storage.protect_delete; the bytes live behind the Storage
--      API), so pg_cron runs sweep_bubble_images() hourly, which sends one Storage API DELETE
--      through pg_net for up to 100 orphans older than an hour (the hour covers an upload whose
--      row update is still in flight). It needs two Vault secrets, and is a no-op without them:
--        select vault.create_secret('https://<ref>.supabase.co', 'storage_sweep_url');
--        select vault.create_secret('<service role key>', 'storage_sweep_key');
--   6. Realtime: bubbles joins supabase_realtime, so members (and pending requesters, who may
--      read the row) see a new name, description or logo live. Clients listen to UPDATE on
--      `bubbles` (RLS decides who gets which row); deletes still come via bubble_members.

-- 1 -------------------------------------------------------------------------
create function public.can_manage_bubble(p_bubble_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.bubble_members
     where bubble_id = p_bubble_id and user_id = auth.uid() and approved and role = 'owner'
  );
$$;
revoke execute on function public.can_manage_bubble(uuid) from public, anon;
grant execute on function public.can_manage_bubble(uuid) to authenticated;

-- 2 -------------------------------------------------------------------------
drop policy bubbles_update_owner on public.bubbles;
create policy bubbles_update_manager on public.bubbles for update to authenticated
  using (public.can_manage_bubble(id)) with check (public.can_manage_bubble(id));

revoke update on public.bubbles from anon, authenticated;
grant update (name, description, logo) on public.bubbles to authenticated;

-- 3 -------------------------------------------------------------------------
create function public.check_bubble_logo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text;
begin
  if new.logo is null or (tg_op = 'UPDATE' and new.logo is not distinct from old.logo) then
    return new;
  end if;
  v_path := public.storage_path_from_url('bubble.images', new.logo);
  if v_path is null
     or new.logo !~ '^https?://'
     or v_path !~ ('^' || new.id::text || '/[A-Za-z0-9._-]+$')
     or v_path like '%..%'
     or not exists (select 1 from storage.objects where bucket_id = 'bubble.images' and name = v_path)
  then
    raise exception 'invalid bubble logo' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger bubbles_check_logo
  before insert or update of logo on public.bubbles
  for each row execute function public.check_bubble_logo();

-- 4 -------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bubble.images', 'bubble.images', true, 2 * 1024 * 1024, array['image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- True when `p_name` sits in the folder of a bubble the caller may manage (`<bubble id>/<file>`).
create function public.can_manage_bubble_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         and array_length(storage.foldername(p_name), 1) = 1
      then public.can_manage_bubble(((storage.foldername(p_name))[1])::uuid)
    else false
  end;
$$;
revoke execute on function public.can_manage_bubble_object(text) from public, anon;
grant execute on function public.can_manage_bubble_object(text) to authenticated;

-- The restrictive "require verified session (...)" policies on storage.objects still apply.
create policy "bubble images: managers upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'bubble.images' and public.can_manage_bubble_object(name));
create policy "bubble images: managers update" on storage.objects for update to authenticated
  using (bucket_id = 'bubble.images' and public.can_manage_bubble_object(name))
  with check (bucket_id = 'bubble.images' and public.can_manage_bubble_object(name));
create policy "bubble images: managers delete" on storage.objects for delete to authenticated
  using (bucket_id = 'bubble.images' and public.can_manage_bubble_object(name));
-- The Storage API deletes with RETURNING (and lists with select), so managers see the folder too.
create policy "bubble images: managers read" on storage.objects for select to authenticated
  using (bucket_id = 'bubble.images' and public.can_manage_bubble_object(name));

-- 5 -------------------------------------------------------------------------
-- Objects in bubble.images that no bubble points at, oldest first, older than p_grace.
create function public.bubble_image_orphans(p_limit int default 100, p_grace interval default interval '1 hour')
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'bubble.images'
     and o.created_at < now() - p_grace
     and not exists (
       select 1 from public.bubbles b
        where b.logo is not null
          and public.storage_path_from_url('bubble.images', b.logo) = o.name
     )
   order by o.created_at
   limit p_limit;
$$;
revoke execute on function public.bubble_image_orphans(int, interval) from public, anon, authenticated;
grant execute on function public.bubble_image_orphans(int, interval) to service_role;

-- Asks the Storage API to delete up to 100 orphans (fire-and-forget through pg_net) and returns
-- how many it asked for. URL and key come from Vault unless given (tests pass them explicitly).
create function public.sweep_bubble_images(
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

  select array_agg(n) into v_paths from public.bubble_image_orphans(100, p_grace) as n;
  if v_paths is null then
    return 0;
  end if;

  perform net.http_delete(
    url := rtrim(v_url, '/') || '/storage/v1/object/bubble.images',
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
revoke execute on function public.sweep_bubble_images(text, text, interval) from public, anon, authenticated;
grant execute on function public.sweep_bubble_images(text, text, interval) to service_role;

select cron.schedule('bubble-images-sweep', '41 * * * *', 'select public.sweep_bubble_images()');

-- 6 -------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bubbles'
  ) then
    alter publication supabase_realtime add table public.bubbles;
  end if;
end
$$;
