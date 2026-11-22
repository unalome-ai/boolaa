-- Invite links (docs/boolaa-spec.md, "Invite links"): https://boolaa.ro/join/<CODE>.
--
-- CODE is the bubble's existing invite_code: the typed code and the link are the same secret, so
-- there is one thing to share and one thing to revoke. A link never bypasses approval: opening it
-- only shows a small preview, and joining still goes through request_to_join + majority vote.
--
--  * generate_invite_code(): new and rotated codes are 10 characters from a 31-letter alphabet
--    without look-alikes (0/O, 1/I/L), about 49 bits. Existing codes keep working until rotated.
--  * rotate_invite_code(p_bubble_id): owner only. Every member can see and share the code; only the
--    owner can replace it (which kills every link and QR code in circulation at once).
--  * get_invite_preview(p_code): what a non-member may see before asking to join: name, cover
--    (logo), member count and size, plus the caller's own status. Security definer, signed-in and
--    verified sessions only (never anon), and throttled per user: lookups of unknown codes are
--    logged, and after too many in an hour both the preview and request_to_join raise
--    'too many attempts'. RLS on bubbles is unchanged.
--  * Only rotate_invite_code changes a code. Clients may already UPDATE only (name, description,
--    logo) (20261123130000_bubble_cover.sql); a trigger also refuses a code change by a client
--    role, in case a later grant widens that. The preview's cover is `logo` (the bubble cover).

-- ---------------------------------------------------------------------------
-- Codes
-- ---------------------------------------------------------------------------

create function public.generate_invite_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; -- 31 characters, no 0 O 1 I L
  bytes bytea := extensions.gen_random_bytes(10);
  code  text := '';
begin
  for i in 0..9 loop
    -- 256 mod 31 = 8, so the first 8 letters are very slightly more likely; irrelevant here.
    code := code || substr(alphabet, (get_byte(bytes, i) % 31) + 1, 1);
  end loop;
  return code;
end;
$$;

alter table public.bubbles alter column invite_code set default public.generate_invite_code();

/** Upper-case, drop spaces, dashes and anything else that is not a letter or digit. */
create function public.normalize_invite_code(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- Only rotate_invite_code changes a code; a client UPDATE runs as `authenticated`, the security
-- definer function as its owner.
create function public.guard_invite_code_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.invite_code is distinct from old.invite_code and current_user in ('authenticated', 'anon') then
    raise exception 'use rotate_invite_code' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger bubbles_guard_invite_code
  before update of invite_code on public.bubbles
  for each row execute function public.guard_invite_code_update();

-- ---------------------------------------------------------------------------
-- Throttle for unknown codes
-- ---------------------------------------------------------------------------

-- One row per lookup of a code that matched no bubble. No policies: only the functions below
-- read or write it. Rows older than a day are pruned on insert.
create table public.invite_lookup_failures (
  user_id uuid not null references public.users (id) on delete cascade,
  at      timestamptz not null default now()
);
create index invite_lookup_failures_user_at on public.invite_lookup_failures (user_id, at);
alter table public.invite_lookup_failures enable row level security;
revoke all on public.invite_lookup_failures from anon, authenticated;

/** Unknown codes a user may try per hour before lookups and requests are refused. */
create function public.invite_lookup_limit()
returns int
language sql
immutable
as $$ select 20 $$;

create function public.require_invite_lookup_allowed()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.invite_lookup_failures
       where user_id = auth.uid() and at > now() - interval '1 hour') >= public.invite_lookup_limit() then
    raise exception 'too many attempts' using errcode = '54000';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Preview
-- ---------------------------------------------------------------------------

-- status: 'member' (already in; bubble_id is set so the client can switch to it), 'pending' (the
-- caller already asked), 'full' (no free seat), 'open'. No rows: the code matches no bubble.
-- bubble_id is null unless the caller is a member: non-members get nothing they could query with.
create function public.get_invite_preview(p_code text)
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

-- ---------------------------------------------------------------------------
-- request_to_join: same contract, plus code normalisation and the throttle
-- ---------------------------------------------------------------------------

create or replace function public.request_to_join(p_invite_code text)
returns public.join_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  b  public.bubbles;
  jr public.join_requests;
begin
  perform public.require_verified_session();
  perform public.require_invite_lookup_allowed();
  select * into b from public.bubbles where invite_code = public.normalize_invite_code(p_invite_code);
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

-- ---------------------------------------------------------------------------
-- Rotation
-- ---------------------------------------------------------------------------

create function public.rotate_invite_code(p_bubble_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  code text;
begin
  perform public.require_verified_session();
  if not exists (select 1 from public.bubble_members
                  where bubble_id = p_bubble_id and user_id = auth.uid() and approved and role = 'owner') then
    raise exception 'only the owner can change the invite code';
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

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.generate_invite_code()              from public, anon, authenticated;
revoke execute on function public.normalize_invite_code(text)          from public, anon;
revoke execute on function public.guard_invite_code_update()           from public, anon, authenticated;
revoke execute on function public.invite_lookup_limit()                from public, anon;
revoke execute on function public.require_invite_lookup_allowed()      from public, anon, authenticated;
revoke execute on function public.get_invite_preview(text)             from public, anon;
revoke execute on function public.rotate_invite_code(uuid)             from public, anon;
revoke execute on function public.request_to_join(text)                from public, anon;

grant execute on function public.normalize_invite_code(text)     to authenticated, service_role;
grant execute on function public.invite_lookup_limit()           to authenticated, service_role;
grant execute on function public.get_invite_preview(text)        to authenticated, service_role;
grant execute on function public.rotate_invite_code(uuid)        to authenticated, service_role;
grant execute on function public.request_to_join(text)           to authenticated, service_role;
grant execute on function public.generate_invite_code()          to service_role;
grant execute on function public.require_invite_lookup_allowed() to service_role;
