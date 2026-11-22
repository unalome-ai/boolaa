-- Bubble roles (owner, admins, members) and manual ownership transfer (docs/boolaa-spec.md, "Roles").
--
-- Ownership was already a role: bubble_members.role in ('owner', 'member'), set by create_bubble and
-- handed over by after_member_removed. bubbles.created_by is history only (who created the bubble,
-- set null when that account goes) and is NOT ownership; nothing below reads it.
--
--   1. bubble_members.role gains 'admin'. A partial unique index allows at most one owner per bubble,
--      so no bug or race can ever produce two. Clients can't INSERT/UPDATE bubble_members at all
--      (there were no policies for it; the table grants go too): roles change only through RPCs.
--   2. bubble_role(bubble, user): internal helper. can_manage_bubble() is widened to owner + admins, so
--      the bubbles UPDATE policy and the bubble.images storage policies follow automatically.
--   3. rotate_invite_code: owner or admin. remove_member: the owner removes anyone; an admin removes
--      plain members only. The exception texts are unchanged (clients and tests match on them) and
--      one is new: 'only the owner can remove admins'.
--   4. transfer_ownership(p_bubble_id, p_new_owner): owner only, target must be an approved member.
--      The old owner becomes an admin (not a plain member): they keep helping run the bubble, and a
--      mistaken transfer is not a total loss of control; the new owner can demote them in one tap.
--      Both rows are locked and updated in one transaction (demote first, then promote, so the unique
--      index never sees two owners); no other transaction sees zero or two owners.
--   5. set_member_role(p_bubble_id, p_user_id, p_role): owner only, p_role 'admin' or 'member', on
--      another approved member who isn't the owner.
--   6. after_member_removed: when the owner leaves, is removed (moderation) or deletes their account,
--      ownership goes to the longest-standing admin, else the longest-standing member. Empty bubbles
--      are still deleted, departed votes stripped, queued requests admitted.
--
-- Approving join requests is unchanged: admins vote like everyone else (majority of members).

-- 1 -------------------------------------------------------------------------
alter table public.bubble_members drop constraint bubble_members_role_check;
alter table public.bubble_members
  add constraint bubble_members_role_check check (role in ('owner', 'admin', 'member'));

create unique index bubble_members_one_owner on public.bubble_members (bubble_id) where role = 'owner';

revoke insert, update, truncate, references, trigger on public.bubble_members from anon, authenticated;

-- 2 -------------------------------------------------------------------------
-- The approved role of p_user_id in p_bubble_id, or null. Internal (security definer helpers only).
create function public.bubble_role(p_bubble_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.bubble_members
   where bubble_id = p_bubble_id and user_id = p_user_id and approved;
$$;
revoke execute on function public.bubble_role(uuid, uuid) from public, anon, authenticated;

create or replace function public.can_manage_bubble(p_bubble_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.bubble_members
     where bubble_id = p_bubble_id and user_id = auth.uid() and approved and role in ('owner', 'admin')
  );
$$;

-- 3 -------------------------------------------------------------------------
create or replace function public.rotate_invite_code(p_bubble_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  code text;
begin
  perform public.require_verified_session();
  if not public.can_manage_bubble(p_bubble_id) then
    raise exception 'only the owner can change the invite code';  -- text kept: owner or admin
  end if;
  loop
    code := public.generate_invite_code();
    begin
      update public.bubbles set invite_code = code where id = p_bubble_id;
      return code;
    exception when unique_violation then
      -- 31^10 codes: practically never, but never hand out a duplicate.
    end;
  end loop;
end;
$$;

create or replace function public.remove_member(p_bubble_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me     text;
  target text;
begin
  perform public.require_verified_session();
  -- Lock the caller's row: a concurrent transfer/demotion finishes first, then we re-read the role.
  select role into me from public.bubble_members
   where bubble_id = p_bubble_id and user_id = auth.uid() and approved
   for update;
  if me is null or me not in ('owner', 'admin') then
    raise exception 'only the owner can remove members';  -- text kept: owner or admin
  end if;
  if p_user_id = auth.uid() then raise exception 'use leave to remove yourself'; end if;
  select role into target from public.bubble_members
   where bubble_id = p_bubble_id and user_id = p_user_id
   for update;
  if not found then raise exception 'member not found'; end if;
  if me = 'admin' and target <> 'member' then
    raise exception 'only the owner can remove admins';
  end if;
  delete from public.bubble_members where bubble_id = p_bubble_id and user_id = p_user_id;
end;
$$;

-- 4 -------------------------------------------------------------------------
create function public.transfer_ownership(p_bubble_id uuid, p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_verified_session();
  perform 1 from public.bubble_members
    where bubble_id = p_bubble_id and user_id = auth.uid() and approved and role = 'owner'
    for update;
  if not found then raise exception 'only the owner can transfer ownership'; end if;
  if p_new_owner = auth.uid() then raise exception 'already the owner'; end if;
  perform 1 from public.bubble_members
    where bubble_id = p_bubble_id and user_id = p_new_owner and approved
    for update;
  if not found then raise exception 'member not found'; end if;

  update public.bubble_members set role = 'admin'
   where bubble_id = p_bubble_id and user_id = auth.uid();
  update public.bubble_members set role = 'owner'
   where bubble_id = p_bubble_id and user_id = p_new_owner;
end;
$$;

-- 5 -------------------------------------------------------------------------
create function public.set_member_role(p_bubble_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_verified_session();
  if p_role is null or p_role not in ('admin', 'member') then raise exception 'invalid role'; end if;
  perform 1 from public.bubble_members
    where bubble_id = p_bubble_id and user_id = auth.uid() and approved and role = 'owner'
    for update;
  if not found then raise exception 'only the owner can change roles'; end if;
  if p_user_id = auth.uid() then raise exception 'use transfer_ownership'; end if;
  perform 1 from public.bubble_members
    where bubble_id = p_bubble_id and user_id = p_user_id and approved
    for update;
  if not found then raise exception 'member not found'; end if;
  update public.bubble_members set role = p_role
   where bubble_id = p_bubble_id and user_id = p_user_id and role is distinct from p_role;
end;
$$;

-- 6 -------------------------------------------------------------------------
create or replace function public.after_member_removed()
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

  -- Hand over: longest-standing admin first, then longest-standing member.
  if old.role = 'owner' and not exists (
       select 1 from public.bubble_members where bubble_id = old.bubble_id and role = 'owner') then
    update public.bubble_members set role = 'owner'
     where (user_id, bubble_id) = (
       select user_id, bubble_id from public.bubble_members
        where bubble_id = old.bubble_id and approved
        order by (role = 'admin') desc, created_at, user_id limit 1);
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

-- Grants --------------------------------------------------------------------
revoke execute on function public.transfer_ownership(uuid, uuid)   from public, anon;
revoke execute on function public.set_member_role(uuid, uuid, text) from public, anon;
grant execute on function public.transfer_ownership(uuid, uuid)    to authenticated, service_role;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated, service_role;
