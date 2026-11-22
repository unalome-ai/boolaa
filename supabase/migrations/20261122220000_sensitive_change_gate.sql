-- Server-side gate for password and email changes (docs/auth-security.md → Sensitive actions).
--
-- GoTrue's "secure password change" nonce is only checked for sessions older than 24 hours:
-- measured on v2.186, a younger session changes the password with no nonce or a WRONG one
-- (and GoTrue still clears reauthentication_token, so the token can't prove anything here).
-- An email change needs no proof at all. A stolen fresh session could therefore take the
-- account over. This trigger on auth.users closes that, behind the same rollout flag as
-- delete_my_account (device_verification_enforced), so today's clients keep working.
--
-- A password change is allowed when, for this user, within the last 10 minutes:
--   * a `sensitive_action` code was verified (device-code function), or
--   * a recovery / magic-link code was consumed (GoTrue clears recovery_token on verify;
--     recorded below in auth_recovery_grants), which is the forgot-password path.
-- An email change request (auth.users.email_change set) needs the `sensitive_action` code.
--
-- The trigger can't see which session is calling, so a code verified in any session of the
-- user counts. A thief without the user's mailbox can't produce one either way.
-- A blocked change surfaces from GoTrue as HTTP 500 "Database error updating user"; clients
-- always ask for the code first, so only a bypass attempt sees it.

create table public.auth_recovery_grants (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now()
);
alter table public.auth_recovery_grants enable row level security; -- no client policies

create function public.has_fresh_sensitive_proof(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from email_challenges
     where user_id = p_user_id
       and purpose = 'sensitive_action'
       and consumed_at > now() - interval '10 minutes'
  )
$$;
revoke execute on function public.has_fresh_sensitive_proof(uuid) from public, anon, authenticated;

create function public.guard_sensitive_auth_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enforced boolean := coalesce((select device_verification_enforced from app_settings where id), false);
begin
  -- A recovery / magic-link code was just used: remember it for the new-password step.
  if coalesce(old.recovery_token, '') <> '' and coalesce(new.recovery_token, '') = ''
     and new.encrypted_password is not distinct from old.encrypted_password then
    insert into auth_recovery_grants (user_id) values (new.id)
    on conflict (user_id) do update set granted_at = now();
  end if;

  -- Operators (SQL, never GoTrue or clients): `set local boolaa.bypass_auth_guard = 'on';`
  if not v_enforced or current_setting('boolaa.bypass_auth_guard', true) = 'on' then return new; end if;

  if new.encrypted_password is distinct from old.encrypted_password then
    if public.has_fresh_sensitive_proof(new.id) then
      null;
    elsif exists (select 1 from auth_recovery_grants where user_id = new.id and granted_at > now() - interval '10 minutes') then
      delete from auth_recovery_grants where user_id = new.id; -- one password per reset code
    else
      raise exception 'reauthentication required' using errcode = '42501';
    end if;
  end if;

  if coalesce(new.email_change, '') <> '' and new.email_change is distinct from old.email_change
     and not public.has_fresh_sensitive_proof(new.id) then
    raise exception 'reauthentication required' using errcode = '42501';
  end if;

  return new;
end;
$$;
revoke execute on function public.guard_sensitive_auth_change() from public, anon, authenticated;

create trigger guard_sensitive_auth_change
  before update of encrypted_password, email_change, recovery_token on auth.users
  for each row execute function public.guard_sensitive_auth_change();
