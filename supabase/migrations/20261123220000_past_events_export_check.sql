-- QA follow-ups (docs/boolaa-spec.md "Events", "Data export").
--
--  1. toggle_rsvp refuses events that already ended. Events store only their start (`datetime`,
--     timestamptz) and every client exports them as 1-hour events ("Add to calendar"), so an event
--     has ENDED once `datetime + 1 hour <= now()`. Clients use the same rule to move events into
--     the "Past" section. New exception text: 'event has ended' (glossary, mapped to `eventEnded`).
--  2. data_export_available_at(): when the caller may download their data again (null = now).
--     Clients ask BEFORE emailing the `export_data` code, and the `device-code` function checks it
--     in its send step too, so nobody gets a code they can't use. export_my_data keeps its own
--     'export rate limited' check as the backstop.

-- 1 -------------------------------------------------------------------------
create or replace function public.event_has_ended(p_datetime timestamptz)
returns boolean
language sql
stable
set search_path = public
as $$ select p_datetime + interval '1 hour' <= now() $$;

grant execute on function public.event_has_ended(timestamptz) to authenticated;

create or replace function public.toggle_rsvp(p_event_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.events;
begin
  perform public.require_verified_session();
  select * into e from public.events where id = p_event_id for update;
  if not found or not public.is_bubble_member(e.bubble_id) then raise exception 'event not found'; end if;
  -- Both directions: the RSVP list of a past event is history, not something to change.
  if public.event_has_ended(e.datetime) then raise exception 'event has ended'; end if;
  update public.events
     set rsvp_list = case when auth.uid() = any(rsvp_list)
                          then array_remove(rsvp_list, auth.uid())
                          else rsvp_list || auth.uid() end
   where id = p_event_id
   returning rsvp_list into e.rsvp_list;
  return e.rsvp_list;
end;
$$;

-- 2 -------------------------------------------------------------------------
create or replace function public.data_export_available_at()
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_last timestamptz;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select max(created_at) into v_last from public.data_export_requests where user_id = v_uid;
  if v_last is null or v_last + interval '1 hour' <= now() then return null; end if;
  return v_last + interval '1 hour';
end;
$$;

revoke all on function public.data_export_available_at() from public, anon;
grant execute on function public.data_export_available_at() to authenticated;
