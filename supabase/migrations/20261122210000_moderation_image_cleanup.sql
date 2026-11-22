-- Moderation "Delete content" also removes the uploaded photo (food posts, marketplace items).
--
-- The image buckets are public: a deleted post's photo stays reachable at its URL until the
-- storage object is gone. SQL can't delete storage objects (Storage API only), so:
--   1. admin_resolve_report (now a wrapper) records the photo's bucket + path in the audit row
--      (moderation_actions.details: image_bucket, image_path) and returns them;
--   2. the admin client then deletes the object through the Storage API;
--   3. storage policies let an admin see and delete exactly the objects named by a delete_content
--      audit row, and nothing else.

alter function public.admin_resolve_report(uuid, text, text, int) rename to admin_resolve_report_core;
revoke execute on function public.admin_resolve_report_core(uuid, text, text, int) from public, anon, authenticated;

-- Storage path of one of our public image URLs, or null (external URL / other bucket).
create function public.storage_path_from_url(p_bucket text, p_url text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(split_part(p_url, '/storage/v1/object/public/' || p_bucket || '/', 2), '')
$$;

create function public.admin_resolve_report(p_report_id uuid, p_action text, p_note text default null, p_days int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r        public.reports;
  v_bucket text;
  v_path   text;
  v_res    jsonb;
begin
  perform public.require_admin();
  if p_action = 'delete_content' then
    select * into r from reports where id = p_report_id;
    if r.target_type = 'food_post' then
      v_bucket := 'food.images';
      select storage_path_from_url(v_bucket, image) into v_path from food_posts where id = r.target_id;
    elsif r.target_type = 'market_item' then
      v_bucket := 'market.images';
      select storage_path_from_url(v_bucket, image) into v_path from market_items where id = r.target_id;
    end if;
  end if;

  v_res := public.admin_resolve_report_core(p_report_id, p_action, p_note, p_days);

  if v_path is not null then
    update moderation_actions
       set details = details || jsonb_build_object('image_bucket', v_bucket, 'image_path', v_path)
     where report_id = p_report_id and action = 'delete_content';
    v_res := v_res || jsonb_build_object('image_bucket', v_bucket, 'image_path', v_path);
  end if;
  return v_res;
end;
$$;
revoke execute on function public.admin_resolve_report(uuid, text, text, int) from public, anon;
grant execute on function public.admin_resolve_report(uuid, text, text, int) to authenticated;

-- True for a photo named by a delete_content audit row, when the caller is an admin.
create function public.is_moderated_photo(p_bucket text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_bucket in ('food.images', 'market.images')
     and public.is_admin()
     and exists (
       select 1 from moderation_actions m
        where m.action = 'delete_content'
          and m.details->>'image_bucket' = p_bucket
          and m.details->>'image_path' = p_name
     )
$$;
revoke execute on function public.is_moderated_photo(text, text) from public, anon;
grant execute on function public.is_moderated_photo(text, text) to authenticated;

-- The Storage API deletes with RETURNING, so the admin needs to see the object as well.
create policy "images: admins read moderated photos" on storage.objects for select to authenticated
  using (public.is_moderated_photo(bucket_id, name));
create policy "images: admins delete moderated photos" on storage.objects for delete to authenticated
  using (public.is_moderated_photo(bucket_id, name));
