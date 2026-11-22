-- Moderation alerts: every new report triggers the `report-alert` Edge Function
-- (fire-and-forget through pg_net), which emails the moderation inbox.
-- Production setup: docs/moderation.md.
--
-- The function URL and the shared secret live in Supabase Vault:
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/report-alert', 'report_alert_url');
--   select vault.create_secret('<random secret>', 'report_alert_secret');
-- If either is missing, the trigger silently does nothing.

create extension if not exists pg_net;

-- Columns for the (later) admin view. `status` already exists (open/actioned/dismissed).
alter table public.reports
  add column handled_at    timestamptz,
  add column handled_note  text check (char_length(handled_note) <= 2000),
  add column alert_sent_at timestamptz;
create index reports_target_alert_idx on public.reports (target_type, target_id, alert_sent_at);
create index reports_reported_user_idx on public.reports (reported_user_id, created_at);

-- Reporters may still read their own rows (reports_select_own); nobody else can.
-- Clients never write reports directly (report_content only).
revoke insert, update, delete on public.reports from anon, authenticated;

create function public.notify_report_alert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url    text;
  v_secret text;
begin
  begin
    select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'report_alert_url'    limit 1;
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'report_alert_secret' limit 1;
    if v_url is not null and v_secret is not null then
      perform net.http_post(
        url     := v_url,
        body    := jsonb_build_object('report_id', new.id),
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-report-alert-secret', v_secret),
        timeout_milliseconds := 10000);
    end if;
  exception when others then
    -- Never let the alert break the report itself.
    raise warning 'report alert not queued: %', sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.notify_report_alert() from public, anon, authenticated;

create trigger on_report_created
  after insert on public.reports
  for each row execute function public.notify_report_alert();

-- Called by the report-alert Edge Function (service role). Deduplicates: at most
-- one email per target per 10 minutes (self-harm reports have their own window,
-- so an urgent report is never swallowed by an earlier non-urgent one). Returns
-- {"send": false, ...} when deduplicated, otherwise everything the email shows.
-- Never returns email addresses.
create function public.claim_report_alert(p_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r          public.reports;
  v_urgent   boolean;
  v_snippet  text;
  v_image    text;
  v_url      text;
  v_on_target int;
begin
  select * into r from public.reports where id = p_report_id;
  if not found then return jsonb_build_object('send', false, 'reason', 'not_found'); end if;
  v_urgent := r.reason = 'self_harm';

  perform pg_advisory_xact_lock(hashtext('report_alert:' || r.target_type || ':' || r.target_id::text));

  select count(*) into v_on_target
    from public.reports
   where target_type = r.target_type and target_id = r.target_id and created_at > now() - interval '10 minutes';

  if r.alert_sent_at is not null or exists (
       select 1 from public.reports o
        where o.target_type = r.target_type and o.target_id = r.target_id and o.id <> r.id
          and o.alert_sent_at > now() - interval '10 minutes'
          and (o.reason = 'self_harm') = v_urgent) then
    return jsonb_build_object('send', false, 'reason', 'deduplicated', 'reports_on_target_10m', v_on_target);
  end if;

  update public.reports set alert_sent_at = now() where id = r.id;

  case r.target_type
    when 'chat_message' then select content into v_snippet from chat_messages where id = r.target_id;
    when 'event' then
      select concat_ws(' · ', title, nullif(location, ''), nullif(description, '')) into v_snippet
        from events where id = r.target_id;
    when 'food_post' then select description, image into v_snippet, v_image from food_posts where id = r.target_id;
    when 'market_item' then
      select concat_ws(' · ', title, nullif(description, '')), image into v_snippet, v_image
        from market_items where id = r.target_id;
    when 'shared_link' then
      select concat_ws(' · ', nullif(title, ''), url), url into v_snippet, v_url from shared_links where id = r.target_id;
    else null;
  end case;

  return jsonb_build_object(
    'send', true,
    'urgent', v_urgent,
    'report_id', r.id,
    'reason', r.reason,
    'target_type', r.target_type,
    'target_id', r.target_id,
    'created_at', r.created_at,
    'details', r.details,
    'bubble_id', r.bubble_id,
    'bubble_name', (select name from bubbles where id = r.bubble_id),
    'reporter_id', r.reporter_id,
    'reporter_name', (select name from users where id = r.reporter_id),
    'reported_user_id', r.reported_user_id,
    'reported_user_name', (select name from users where id = r.reported_user_id),
    'snippet', case when v_snippet is null then null
                    when char_length(v_snippet) > 300 then left(v_snippet, 299) || '…'
                    else v_snippet end,
    'image_url', v_image,
    'link_url', v_url,
    'reports_on_target_10m', v_on_target,
    'open_reports_against_user_30d', (
      select count(*) from public.reports
       where reported_user_id = r.reported_user_id and status = 'open'
         and created_at > now() - interval '30 days'));
end;
$$;
revoke execute on function public.claim_report_alert(uuid) from public, anon, authenticated;
grant execute on function public.claim_report_alert(uuid) to service_role;
