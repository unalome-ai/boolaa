-- Moderation admin view and account suspension. How to moderate: docs/moderation.md.
--
--  1. admins (no client policies) + is_admin(). Production gets its admin by hand:
--       insert into public.admins (user_id) select id from auth.users where email = '<lead's email>';
--  2. users.status (active / suspended / banned) + reason / until / changed_at.
--     is_session_verified() now also needs an active account, so a suspended or banned user
--     reads and writes nothing (every RLS policy and RPC already goes through it). Exceptions:
--     their own `users` row (so clients can show "suspended until …"), their own storage
--     objects (select/delete, for the account-deletion cleanup) and delete_my_account().
--     auth.users.banned_until is set too: GoTrue then refuses sign-in and token refresh
--     ("user_banned"); an access token already issued keeps working until it expires
--     (<= 1 h), and RLS covers that window.
--     Content of suspended/banned users stays visible to their bubbles (delete_content
--     removes what was reported). A ban also removes the user from every bubble, so they
--     don't hold a seat or a vote forever.
--  3. moderation_actions: append-only audit log, readable only by admins.
--  4. Admin RPCs: admin_list_reports, admin_get_report, admin_resolve_report,
--     admin_unsuspend, admin_find_users. Each one raises 'permission denied' (42501)
--     for non-admins, then requires a verified session (device check).

-- 1 -------------------------------------------------------------------------
create table public.admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;
-- No policies: only security definer functions and the service role read it.

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (select 1 from public.admins where user_id = auth.uid());
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- 2 -------------------------------------------------------------------------
-- status_reason is a category (a report reason), never the moderator's free-text note
-- (that goes to reports.handled_note / moderation_actions.note): bubble mates can read
-- users rows, so nothing sensitive is stored here.
alter table public.users
  add column status            text not null default 'active' check (status in ('active', 'suspended', 'banned')),
  add column status_reason     text check (status_reason in ('spam', 'harassment', 'hate', 'sexual', 'violence', 'self_harm', 'other')),
  add column status_until      timestamptz,
  add column status_changed_at timestamptz;
-- Clients still update only (name, avatar): the column grant from 20261122160000 stays.

-- False while the caller is banned, or suspended and the suspension hasn't ended.
-- A suspension ends by itself at status_until (no job needed; GoTrue's banned_until
-- ends at the same moment). Clients must apply the same rule to users.status.
create function public.is_account_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.users
     where id = auth.uid()
       and (status = 'banned'
            or (status = 'suspended' and (status_until is null or status_until > now()))));
$$;
revoke execute on function public.is_account_active() from public, anon;
grant execute on function public.is_account_active() to authenticated, service_role;

create or replace function public.is_session_verified()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_device_verified() and public.is_age_confirmed() and public.is_account_active();
$$;

create or replace function public.require_verified_session()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_device_verified() then
    raise exception 'session not verified' using errcode = '42501';
  end if;
  if not public.is_account_active() then
    raise exception 'account suspended' using errcode = '42501';
  end if;
  if not public.is_age_confirmed() then
    raise exception 'age confirmation required' using errcode = '42501';
  end if;
end;
$$;

-- users: a suspended (or not-yet-16+-confirmed) user may still read their own row once the
-- device check passed. Writes keep the full check.
drop policy require_verified_session on public.users;
create policy require_verified_session_read on public.users as restrictive for select to authenticated
  using ((select public.is_session_verified()) or (id = auth.uid() and (select public.is_device_verified())));
create policy require_verified_session_insert on public.users as restrictive for insert to authenticated
  with check ((select public.is_session_verified()));
create policy require_verified_session_update on public.users as restrictive for update to authenticated
  using ((select public.is_session_verified())) with check ((select public.is_session_verified()));
create policy require_verified_session_delete on public.users as restrictive for delete to authenticated
  using ((select public.is_session_verified()));
create policy users_select_self on public.users for select to authenticated
  using (id = auth.uid());

-- storage: own objects stay listable and deletable (delete_my_account cleanup); uploads
-- and updates need the full check.
drop policy "images: require verified session" on storage.objects;
create policy "images: require verified session (read)" on storage.objects as restrictive for select to authenticated
  using ((select public.is_session_verified())
         or ((storage.foldername(name))[1] = auth.uid()::text and (select public.is_device_verified())));
create policy "images: require verified session (delete)" on storage.objects as restrictive for delete to authenticated
  using ((select public.is_session_verified())
         or ((storage.foldername(name))[1] = auth.uid()::text and (select public.is_device_verified())));
create policy "images: require verified session (insert)" on storage.objects as restrictive for insert to authenticated
  with check ((select public.is_session_verified()));
create policy "images: require verified session (update)" on storage.objects as restrictive for update to authenticated
  using ((select public.is_session_verified())) with check ((select public.is_session_verified()));

-- 3 -------------------------------------------------------------------------
-- Plain uuids (no foreign keys) so the log outlives deleted users, reports and content.
create table public.moderation_actions (
  id              uuid primary key default gen_random_uuid(),
  admin_id        uuid not null,
  action          text not null check (action in
                    ('dismiss', 'delete_content', 'remove_from_bubble', 'suspend', 'ban', 'unsuspend')),
  target_type     text,
  target_id       uuid,
  target_user_id  uuid,
  bubble_id       uuid,
  report_id       uuid,
  note            text check (char_length(note) <= 2000),
  details         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index moderation_actions_created_idx on public.moderation_actions (created_at desc);
create index moderation_actions_user_idx on public.moderation_actions (target_user_id, created_at desc);
alter table public.moderation_actions enable row level security;
revoke all on public.moderation_actions from anon, authenticated;
grant select on public.moderation_actions to authenticated;
create policy moderation_actions_admin_read on public.moderation_actions for select to authenticated
  using ((select public.is_admin()));
create policy require_verified_session on public.moderation_actions as restrictive for all to authenticated
  using ((select public.is_session_verified())) with check ((select public.is_session_verified()));

-- 4 -------------------------------------------------------------------------
create function public.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'permission denied' using errcode = '42501'; end if;
  perform public.require_verified_session();
end;
$$;

-- What the reported thing looks like now: {text, title, url, image, deleted}.
create function public.report_target_snapshot(p_target_type text, p_target_id uuid)
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
      select jsonb_build_object('text', content) into v from chat_messages where id = p_target_id;
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

-- One report as the admin view shows it.
create function public.admin_report_json(r public.reports)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', r.id,
    'reason', r.reason,
    'details', r.details,
    'created_at', r.created_at,
    'status', r.status,
    'handled_at', r.handled_at,
    'handled_note', r.handled_note,
    'target_type', r.target_type,
    'target_id', r.target_id,
    'bubble_id', r.bubble_id,
    'bubble_name', (select name from bubbles where id = r.bubble_id),
    'reporter_id', r.reporter_id,
    'reporter_name', (select name from users where id = r.reporter_id),
    'reported_user_id', r.reported_user_id,
    'reported_user_name', u.name,
    'reported_user_status', u.status,
    'reported_user_status_until', u.status_until,
    'reported_user_is_member', exists (select 1 from bubble_members m
                                        where m.bubble_id = r.bubble_id and m.user_id = r.reported_user_id and m.approved),
    'snapshot', public.report_target_snapshot(r.target_type, r.target_id),
    'open_reports_against_user_30d', (
      select count(*) from reports o
       where o.reported_user_id = r.reported_user_id and o.status = 'open'
         and o.created_at > now() - interval '30 days'),
    'open_reports_on_target', (
      select count(*) from reports o
       where o.target_type = r.target_type and o.target_id = r.target_id and o.status = 'open'))
  from (select 1) one
  left join users u on u.id = r.reported_user_id;
$$;

-- Queue. Open: self-harm first, then oldest first (24 h SLA). Handled: newest first.
-- Returns {"total": n, "items": [...]}.
create function public.admin_list_reports(p_status text default 'open', p_limit int default 50, p_offset int default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_items jsonb;
  v_total int;
begin
  perform public.require_admin();
  if p_status not in ('open', 'actioned', 'dismissed') then raise exception 'invalid status'; end if;

  select count(*) into v_total from reports where status = p_status;
  select coalesce(jsonb_agg(public.admin_report_json(x) order by
                    case when p_status = 'open' and x.reason = 'self_harm' then 0 else 1 end,
                    case when p_status = 'open' then x.created_at end asc,
                    case when p_status <> 'open' then coalesce(x.handled_at, x.created_at) end desc,
                    x.id), '[]'::jsonb)
    into v_items
    from (select * from reports
           where status = p_status
           order by case when p_status = 'open' and reason = 'self_harm' then 0 else 1 end,
                    case when p_status = 'open' then created_at end asc,
                    case when p_status <> 'open' then coalesce(handled_at, created_at) end desc,
                    id
           limit least(greatest(coalesce(p_limit, 50), 1), 200)
           offset greatest(coalesce(p_offset, 0), 0)) x;
  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

-- One report with context: for a chat message the 5 messages before and after it;
-- the other reports on the same target; the audit entries of this report.
create function public.admin_get_report(p_report_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r      public.reports;
  m      public.chat_messages;
  v_ctx  jsonb := '[]'::jsonb;
begin
  perform public.require_admin();
  select * into r from reports where id = p_report_id;
  if not found then raise exception 'report not found'; end if;

  if r.target_type = 'chat_message' then
    select * into m from chat_messages where id = r.target_id;
    if found then
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', c.id, 'sender_id', c.sender_id, 'sender_name', (select name from users where id = c.sender_id),
               'content', c.content, 'created_at', c.created_at, 'is_target', c.id = m.id)
             order by c.created_at, c.id), '[]'::jsonb)
        into v_ctx
        from (
          (select * from chat_messages
            where bubble_id = m.bubble_id and (created_at, id) < (m.created_at, m.id)
            order by created_at desc, id desc limit 5)
          union all
          (select * from chat_messages where id = m.id)
          union all
          (select * from chat_messages
            where bubble_id = m.bubble_id and (created_at, id) > (m.created_at, m.id)
            order by created_at, id limit 5)
        ) c;
    end if;
  end if;

  return public.admin_report_json(r) || jsonb_build_object(
    'context', v_ctx,
    'related', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', o.id, 'reason', o.reason, 'details', o.details, 'status', o.status, 'created_at', o.created_at,
                  'reporter_id', o.reporter_id, 'reporter_name', (select name from users where id = o.reporter_id))
                  order by o.created_at), '[]'::jsonb)
                  from reports o
                 where o.target_type = r.target_type and o.target_id = r.target_id and o.id <> r.id),
    'actions', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', a.id, 'action', a.action, 'note', a.note, 'details', a.details, 'created_at', a.created_at,
                  'admin_id', a.admin_id) order by a.created_at), '[]'::jsonb)
                  from moderation_actions a where a.report_id = r.id));
end;
$$;

-- Internal: set a user's status and the matching GoTrue ban.
create function public.set_account_status(p_user_id uuid, p_status text, p_reason text, p_until timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
     set status = p_status,
         status_reason = case when p_status = 'active' then null else p_reason end,
         status_until = case when p_status = 'suspended' then p_until end,
         status_changed_at = now()
   where id = p_user_id;
  if not found then raise exception 'user not found'; end if;
  -- GoTrue refuses password/OTP sign-in and refresh while banned_until is in the future.
  -- 'infinity' can't be read by GoTrue, so a ban is 100 years.
  update auth.users
     set banned_until = case p_status when 'suspended' then p_until
                                      when 'banned' then now() + interval '100 years' end,
         updated_at = now()
   where id = p_user_id;
end;
$$;

-- Acts on a report: dismiss, delete_content, remove_from_bubble, suspend (p_days 1-365) or
-- ban. Marks the report (and every other open report on the same target) actioned or
-- dismissed, and writes the audit log.
create function public.admin_resolve_report(p_report_id uuid, p_action text, p_note text default null, p_days int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r          public.reports;
  v_status   text;
  v_note     text := nullif(trim(p_note), '');
  v_until    timestamptz;
  v_deleted  int := 0;
  v_closed   int := 0;
  v_details  jsonb := '{}'::jsonb;
begin
  perform public.require_admin();
  if p_action not in ('dismiss', 'delete_content', 'remove_from_bubble', 'suspend', 'ban') then
    raise exception 'invalid action';
  end if;
  if char_length(v_note) > 2000 then raise exception 'note too long'; end if;

  select * into r from reports where id = p_report_id for update;
  if not found then raise exception 'report not found'; end if;
  if r.status <> 'open' then raise exception 'report already handled'; end if;

  if p_action in ('remove_from_bubble', 'suspend', 'ban') then
    if r.reported_user_id is null or not exists (select 1 from users where id = r.reported_user_id) then
      raise exception 'reported user no longer exists';
    end if;
    if r.reported_user_id = auth.uid() then raise exception 'cannot act on yourself'; end if;
  end if;

  case p_action
    when 'dismiss' then null;

    when 'delete_content' then
      -- Rows only: stored images can't be deleted from SQL (see docs/moderation.md).
      case r.target_type
        when 'chat_message' then delete from chat_messages where id = r.target_id;
        when 'event'        then delete from events        where id = r.target_id;
        when 'food_post'    then delete from food_posts    where id = r.target_id;
        when 'market_item'  then delete from market_items  where id = r.target_id;
        when 'shared_link'  then delete from shared_links  where id = r.target_id;
        else raise exception 'a user report has no content to delete';
      end case;
      get diagnostics v_deleted = row_count;
      v_details := jsonb_build_object('rows_deleted', v_deleted);

    when 'remove_from_bubble' then
      if r.bubble_id is null then raise exception 'report has no bubble'; end if;
      -- Same path as remove_member/leave: the after_member_removed trigger hands ownership
      -- on, deletes an empty bubble, strips votes and admits queued requests.
      delete from bubble_members where bubble_id = r.bubble_id and user_id = r.reported_user_id;
      if not found then raise exception 'member not found'; end if;

    when 'suspend' then
      if p_days is null or p_days not between 1 and 365 then raise exception 'invalid suspension length'; end if;
      if exists (select 1 from users where id = r.reported_user_id and status = 'banned') then
        raise exception 'user is banned';
      end if;
      v_until := now() + make_interval(days => p_days);
      perform public.set_account_status(r.reported_user_id, 'suspended', r.reason, v_until);
      v_details := jsonb_build_object('days', p_days, 'until', v_until);

    when 'ban' then
      perform public.set_account_status(r.reported_user_id, 'banned', r.reason, null);
      -- Free their seats and votes (trigger per row, as for any removal).
      with gone as (delete from bubble_members where user_id = r.reported_user_id returning bubble_id)
      select jsonb_build_object('bubbles_left', count(*)) into v_details from gone;
  end case;

  v_status := case when p_action = 'dismiss' then 'dismissed' else 'actioned' end;
  update reports
     set status = v_status, handled_at = now(), handled_note = v_note
   where id = r.id;
  update reports
     set status = v_status, handled_at = now(),
         handled_note = left(concat_ws(' ', 'Closed with report ' || r.id::text || ' (' || p_action || ').', v_note), 2000)
   where target_type = r.target_type and target_id = r.target_id and status = 'open' and id <> r.id;
  get diagnostics v_closed = row_count;

  insert into moderation_actions (admin_id, action, target_type, target_id, target_user_id, bubble_id, report_id, note, details)
  values (auth.uid(), p_action, r.target_type, r.target_id, r.reported_user_id, r.bubble_id, r.id, v_note,
          v_details || jsonb_build_object('duplicates_closed', v_closed));

  return jsonb_build_object('report_id', r.id, 'status', v_status, 'action', p_action,
                            'duplicates_closed', v_closed) || v_details;
end;
$$;

-- Lifts a suspension or a ban.
create function public.admin_unsuspend(p_user_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev text;
begin
  perform public.require_admin();
  select status into v_prev from users where id = p_user_id for update;
  if not found then raise exception 'user not found'; end if;
  perform public.set_account_status(p_user_id, 'active', null, null);
  insert into moderation_actions (admin_id, action, target_type, target_id, target_user_id, note, details)
  values (auth.uid(), 'unsuspend', 'user', p_user_id, p_user_id, nullif(left(trim(p_note), 2000), ''),
          jsonb_build_object('previous_status', v_prev));
  return jsonb_build_object('user_id', p_user_id, 'status', 'active', 'previous_status', v_prev);
end;
$$;

-- Users tab: search by name (substring) or exact id. Never returns email addresses.
create function public.admin_find_users(p_query text, p_limit int default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q    text := trim(coalesce(p_query, ''));
  v_id uuid := case when trim(coalesce(p_query, '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    then trim(p_query)::uuid end;
begin
  perform public.require_admin();
  if char_length(q) < 2 then return '[]'::jsonb; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', u.id, 'name', u.name, 'avatar', u.avatar, 'created_at', u.created_at,
             'status', u.status, 'status_reason', u.status_reason, 'status_until', u.status_until,
             'status_changed_at', u.status_changed_at,
             'active', u.status = 'active' or (u.status = 'suspended' and u.status_until <= now()),
             'bubbles', (select count(*) from bubble_members m where m.user_id = u.id and m.approved),
             'open_reports_30d', (select count(*) from reports o where o.reported_user_id = u.id and o.status = 'open'
                                     and o.created_at > now() - interval '30 days'),
             'reports_total', (select count(*) from reports o where o.reported_user_id = u.id))
           order by u.name, u.id), '[]'::jsonb)
      from (select * from users
             where id = v_id
                or name ilike '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
             order by name, id
             limit least(greatest(coalesce(p_limit, 20), 1), 100)) u);
end;
$$;

revoke execute on function public.require_admin(), public.report_target_snapshot(text, uuid),
  public.admin_report_json(public.reports), public.set_account_status(uuid, text, text, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.admin_list_reports(text, int, int), public.admin_get_report(uuid),
  public.admin_resolve_report(uuid, text, text, int), public.admin_unsuspend(uuid, text),
  public.admin_find_users(text, int) from public, anon;
grant execute on function public.admin_list_reports(text, int, int), public.admin_get_report(uuid),
  public.admin_resolve_report(uuid, text, text, int), public.admin_unsuspend(uuid, text),
  public.admin_find_users(text, int) to authenticated;
