-- Membership and storage fixes found while building the iOS/web clients.
--  1. Storage: owners can SELECT their own objects (storage.remove() needs it).
--  2. Realtime: publish join_requests and bubble_members (live pending screens).
--  3. Full bubbles: approvals are kept; admission happens as soon as a seat frees.
--     Only approvals from *current* approved members count.
--  4. Owners can remove members; ownership passes on when an owner leaves;
--     a bubble with no members left is deleted.

-- 1 -------------------------------------------------------------------------
create policy "images: owners read" on storage.objects for select to authenticated
  using (bucket_id in ('food.images', 'market.images', 'avatars')
         and (storage.foldername(name))[1] = auth.uid()::text);

-- 2 -------------------------------------------------------------------------
alter publication supabase_realtime add table public.join_requests, public.bubble_members;

-- 3 -------------------------------------------------------------------------
-- Admit a request if it has a strict majority of current members' approvals
-- and the bubble has a free seat. Internal helper (not callable by clients).
create function public.try_admit_join_request(p_request_id uuid)
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
  if not found then return false; end if;
  select * into b from public.bubbles where id = jr.bubble_id;
  if not found then return false; end if;

  select count(*) into members
    from public.bubble_members where bubble_id = jr.bubble_id and approved;
  select count(*) into approvals
    from public.bubble_members
   where bubble_id = jr.bubble_id and approved and user_id = any(jr.approver_ids);

  if approvals * 2 > members and members < b.max_size then
    insert into public.bubble_members (user_id, bubble_id, approved, role)
    values (jr.user_id, jr.bubble_id, true, 'member')
    on conflict (user_id, bubble_id) do update set approved = true;
    delete from public.join_requests where id = jr.id;
    return true;
  end if;
  return false;
end;
$$;
revoke execute on function public.try_admit_join_request(uuid) from public, anon, authenticated;

-- Same signature as before: returns true when the requester was admitted.
-- No longer raises 'bubble is full': the approval is recorded and the
-- requester is admitted automatically once a seat frees up.
create or replace function public.approve_join_request(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  jr public.join_requests;
begin
  select * into jr from public.join_requests where id = p_request_id for update;
  if not found then raise exception 'request not found'; end if;
  if not public.is_bubble_member(jr.bubble_id) then raise exception 'not a member of this bubble'; end if;

  update public.join_requests
     set approver_ids = array(select distinct unnest(approver_ids || auth.uid()))
   where id = jr.id;

  return public.try_admit_join_request(jr.id);
end;
$$;

-- 4 -------------------------------------------------------------------------
-- Owner removes another member (not themselves: leaving is a delete of own row).
create function public.remove_member(p_bubble_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.bubble_members
                  where bubble_id = p_bubble_id and user_id = auth.uid() and approved and role = 'owner') then
    raise exception 'only the owner can remove members';
  end if;
  if p_user_id = auth.uid() then raise exception 'use leave to remove yourself'; end if;
  delete from public.bubble_members where bubble_id = p_bubble_id and user_id = p_user_id;
  if not found then raise exception 'member not found'; end if;
end;
$$;
revoke execute on function public.remove_member(uuid, uuid) from anon;

-- After anyone leaves or is removed: hand over ownership, drop empty bubbles,
-- strip the departed member's votes, and admit queued requests into free seats.
create function public.after_member_removed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if not exists (select 1 from public.bubbles where id = old.bubble_id) then
    return null;  -- bubble itself is being deleted (cascade)
  end if;

  if not exists (select 1 from public.bubble_members where bubble_id = old.bubble_id and approved) then
    delete from public.bubbles where id = old.bubble_id;
    return null;
  end if;

  if old.role = 'owner' and not exists (
       select 1 from public.bubble_members where bubble_id = old.bubble_id and role = 'owner') then
    update public.bubble_members set role = 'owner'
     where (user_id, bubble_id) = (
       select user_id, bubble_id from public.bubble_members
        where bubble_id = old.bubble_id and approved
        order by created_at, user_id limit 1);
  end if;

  update public.join_requests
     set approver_ids = array_remove(approver_ids, old.user_id)
   where bubble_id = old.bubble_id and old.user_id = any(approver_ids);

  for r in select id from public.join_requests where bubble_id = old.bubble_id order by created_at loop
    perform public.try_admit_join_request(r.id);
  end loop;
  return null;
end;
$$;

create trigger on_bubble_member_removed
  after delete on public.bubble_members
  for each row execute function public.after_member_removed();
