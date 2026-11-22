-- Search inside a bubble (docs/boolaa-spec.md, "Search").
--
--  1. Extensions unaccent + pg_trgm, and immutable folding helpers (lower + unaccent), so "sarmale"
--     finds "Sărmăluțe" and "creme" finds "crème" in every language Boolaa ships.
--  2. GIN indexes per searchable table: full text ('simple' config on folded text: no stemming,
--     no stop words, so it works the same for en/ro/fr/es/it) and trigram (partial words).
--  3. search_bubble(): one RPC for chat messages, events, food posts, market items and links.
--     SECURITY INVOKER: the tables' own RLS (membership, blocks both ways, verified session,
--     inactive accounts) decides what the caller sees. Nothing is reimplemented here.
--  4. chat_messages_around(): the chat window around a message, contiguous up to the newest one,
--     so a search hit opens in context and live messages and "load older" keep working.

-- 1 -------------------------------------------------------------------------
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- unaccent() is only STABLE (it reads the dictionary by name); with the dictionary given as a
-- regdictionary it is safe to call from an immutable function and so from index expressions.
create function public.search_fold(p_text text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select pg_catalog.lower(extensions.unaccent('extensions.unaccent'::regdictionary, p_text))
$$;

-- The searchable text of a row: its fields joined (nulls skipped) and folded. Index expressions and
-- search_bubble() must use exactly this so the planner can match them.
create function public.search_doc(variadic p_parts text[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select public.search_fold(pg_catalog.array_to_string(p_parts, ' '))
$$;

-- A short plain-text excerpt (no markup; clients highlight the words themselves) from the first of
-- p_texts that contains one of p_words, cut around the first hit. Falls back to the first non-empty text.
create function public.search_snippet(p_texts text[], p_words text[], p_width int default 160)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  t text;
  w text;
  pos int;
  best text;
  best_pos int := 1;
  s int;
begin
  foreach t in array coalesce(p_texts, '{}'::text[]) loop
    t := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(t, ''), '\s+', ' ', 'g'));
    continue when t = '';
    pos := 0;
    foreach w in array coalesce(p_words, '{}'::text[]) loop
      pos := pg_catalog.strpos(public.search_fold(t), w);
      exit when pos > 0;
    end loop;
    if pos > 0 then
      best := t;
      best_pos := pos;
      exit;
    end if;
    if best is null then best := t; end if;
  end loop;
  if best is null then return null; end if;
  if pg_catalog.char_length(best) <= p_width then return best; end if;
  -- Folding can change lengths slightly (œ → oe); the window is wide enough to keep the hit.
  s := greatest(1, least(best_pos - 40, pg_catalog.char_length(best) - p_width + 1));
  return case when s > 1 then '…' else '' end
      || pg_catalog.btrim(pg_catalog.substr(best, s, p_width))
      || case when s + p_width <= pg_catalog.char_length(best) then '…' else '' end;
end;
$$;

-- 2 -------------------------------------------------------------------------
create index chat_messages_search_fts_idx on public.chat_messages
  using gin (to_tsvector('simple'::regconfig, public.search_doc(content))) where deleted_at is null;
create index chat_messages_search_trgm_idx on public.chat_messages
  using gin (public.search_doc(content) extensions.gin_trgm_ops) where deleted_at is null;

create index events_search_fts_idx on public.events
  using gin (to_tsvector('simple'::regconfig, public.search_doc(title, description, location)));
create index events_search_trgm_idx on public.events
  using gin (public.search_doc(title, description, location) extensions.gin_trgm_ops);

create index food_posts_search_fts_idx on public.food_posts
  using gin (to_tsvector('simple'::regconfig, public.search_doc(description)));
create index food_posts_search_trgm_idx on public.food_posts
  using gin (public.search_doc(description) extensions.gin_trgm_ops);

create index market_items_search_fts_idx on public.market_items
  using gin (to_tsvector('simple'::regconfig, public.search_doc(title, description)));
create index market_items_search_trgm_idx on public.market_items
  using gin (public.search_doc(title, description) extensions.gin_trgm_ops);

-- Links also search their tags (text[]). array_to_string() is declared STABLE for anyarray (element
-- output functions may vary), but for text[] it is immutable in practice, like in search_doc.
create function public.search_link_doc(p_title text, p_url text, p_tags text[], p_preview_title text, p_preview_description text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select public.search_doc(p_title, p_url, pg_catalog.array_to_string(p_tags, ' '), p_preview_title, p_preview_description)
$$;
create index shared_links_search_fts_idx on public.shared_links
  using gin (to_tsvector('simple'::regconfig, public.search_link_doc(title, url, tags, preview_title, preview_description)));
create index shared_links_search_trgm_idx on public.shared_links
  using gin (public.search_link_doc(title, url, tags, preview_title, preview_description) extensions.gin_trgm_ops);

-- 3 -------------------------------------------------------------------------
-- rpc('search_bubble', {p_bubble_id, p_query, p_limit?, p_kinds?})
--
-- The query is folded (lower + unaccent), cut to 100 characters and must keep at least 2 characters,
-- otherwise no rows. A row matches when
--   * every word (letters and digits only, at most 8) starts a word of the row: full text with
--     prefix terms ('simple' config), so "climb gym" finds "Climbing at the gym"; or
--   * the whole query (3+ characters) appears anywhere in the row: trigram-indexed LIKE, with
--     %, _ and \ escaped, so "zza" finds "pizza" and URLs match by fragment.
-- User input never becomes SQL: the words are reduced to [[:alnum:]] before they form a tsquery and
-- the LIKE pattern is escaped; both are values, not code.
--
-- Rows come back best first: whole query in the title, then anywhere, then full-text rank, then
-- newest. kind is the reactions/report target name: chat_message, event, food_post, market_item,
-- shared_link. title is null for chat messages and food posts. event_at is the event's datetime.
-- matched_words are the folded words clients highlight (diacritic-insensitively) in title and snippet.
create function public.search_bubble(
  p_bubble_id uuid,
  p_query text,
  p_limit int default 30,
  p_kinds text[] default null
)
returns table (
  kind text,
  id uuid,
  title text,
  snippet text,
  author_id uuid,
  author_name text,
  created_at timestamptz,
  event_at timestamptz,
  rank real,
  matched_words text[]
)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_q text;
  v_words text[];
  v_tsq tsquery;
  v_like text;
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_all boolean := p_kinds is null or cardinality(p_kinds) = 0;
begin
  v_q := btrim(regexp_replace(public.search_fold(left(coalesce(p_query, ''), 100)), '\s+', ' ', 'g'));
  if char_length(v_q) < 2 then
    return;
  end if;

  select array_agg(w) into v_words
    from (select w
            from regexp_split_to_table(btrim(regexp_replace(v_q, '[^[:alnum:]]+', ' ', 'g')), ' ') as w
           where w <> ''
           limit 8) s;
  if v_words is not null then
    v_tsq := to_tsquery('simple', array_to_string(array(select w || ':*' from unnest(v_words) as w), ' & '));
  end if;
  -- The trigram arm needs 3 characters to use its index; shorter queries rely on full text.
  if char_length(v_q) >= 3 then
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  if v_tsq is null and v_like is null then
    return;
  end if;

  return query
  with hits as (
    -- Chat: live messages with text (a deleted message has none; RLS hides blocked senders).
    (select 'chat_message'::text as kind, m.id, null::text as title,
            public.search_snippet(array[m.content], v_words) as snippet,
            m.sender_id as author_id, m.created_at, null::timestamptz as event_at,
            (case when public.search_doc(m.content) like v_like then 1.0 else 0 end
             + coalesce(ts_rank(to_tsvector('simple'::regconfig, public.search_doc(m.content)), v_tsq), 0))::real as rank
       from public.chat_messages m
      where (v_all or 'chat_message' = any(p_kinds))
        and m.bubble_id = p_bubble_id
        and m.deleted_at is null
        and ((v_tsq is not null and to_tsvector('simple'::regconfig, public.search_doc(m.content)) @@ v_tsq)
             or (v_like is not null and public.search_doc(m.content) like v_like))
      order by rank desc, m.created_at desc
      limit v_limit)
    union all
    (select 'event', e.id, e.title,
            public.search_snippet(array[e.description, e.location], v_words),
            e.creator_id, e.created_at, e.datetime,
            (case when public.search_doc(e.title) like v_like then 2.0 else 0 end
             + case when public.search_doc(e.title, e.description, e.location) like v_like then 1.0 else 0 end
             + coalesce(ts_rank(to_tsvector('simple'::regconfig, public.search_doc(e.title, e.description, e.location)), v_tsq), 0))::real
       from public.events e
      where (v_all or 'event' = any(p_kinds))
        and e.bubble_id = p_bubble_id
        and ((v_tsq is not null and to_tsvector('simple'::regconfig, public.search_doc(e.title, e.description, e.location)) @@ v_tsq)
             or (v_like is not null and public.search_doc(e.title, e.description, e.location) like v_like))
      order by 8 desc, e.created_at desc
      limit v_limit)
    union all
    (select 'food_post', f.id, null::text,
            public.search_snippet(array[f.description], v_words),
            f.user_id, f.created_at, null::timestamptz,
            (case when public.search_doc(f.description) like v_like then 1.0 else 0 end
             + coalesce(ts_rank(to_tsvector('simple'::regconfig, public.search_doc(f.description)), v_tsq), 0))::real
       from public.food_posts f
      where (v_all or 'food_post' = any(p_kinds))
        and f.bubble_id = p_bubble_id
        and ((v_tsq is not null and to_tsvector('simple'::regconfig, public.search_doc(f.description)) @@ v_tsq)
             or (v_like is not null and public.search_doc(f.description) like v_like))
      order by 8 desc, f.created_at desc
      limit v_limit)
    union all
    (select 'market_item', i.id, i.title,
            public.search_snippet(array[i.description], v_words),
            i.owner_id, i.created_at, null::timestamptz,
            (case when public.search_doc(i.title) like v_like then 2.0 else 0 end
             + case when public.search_doc(i.title, i.description) like v_like then 1.0 else 0 end
             + coalesce(ts_rank(to_tsvector('simple'::regconfig, public.search_doc(i.title, i.description)), v_tsq), 0))::real
       from public.market_items i
      where (v_all or 'market_item' = any(p_kinds))
        and i.bubble_id = p_bubble_id
        and ((v_tsq is not null and to_tsvector('simple'::regconfig, public.search_doc(i.title, i.description)) @@ v_tsq)
             or (v_like is not null and public.search_doc(i.title, i.description) like v_like))
      order by 8 desc, i.created_at desc
      limit v_limit)
    union all
    (select 'shared_link', l.id, coalesce(nullif(btrim(l.title), ''), l.preview_title, l.url),
            public.search_snippet(array[l.preview_title, l.preview_description, l.url, array_to_string(l.tags, ' ')], v_words),
            l.user_id, l.created_at, null::timestamptz,
            (case when public.search_doc(coalesce(nullif(btrim(l.title), ''), l.preview_title, l.url)) like v_like then 2.0 else 0 end
             + case when public.search_link_doc(l.title, l.url, l.tags, l.preview_title, l.preview_description) like v_like then 1.0 else 0 end
             + coalesce(ts_rank(to_tsvector('simple'::regconfig, public.search_link_doc(l.title, l.url, l.tags, l.preview_title, l.preview_description)), v_tsq), 0))::real
       from public.shared_links l
      where (v_all or 'shared_link' = any(p_kinds))
        and l.bubble_id = p_bubble_id
        and ((v_tsq is not null and to_tsvector('simple'::regconfig, public.search_link_doc(l.title, l.url, l.tags, l.preview_title, l.preview_description)) @@ v_tsq)
             or (v_like is not null and public.search_link_doc(l.title, l.url, l.tags, l.preview_title, l.preview_description) like v_like))
      order by 8 desc, l.created_at desc
      limit v_limit)
  )
  -- The author's name through users RLS too (people sharing a bubble); null if not visible.
  select h.kind, h.id, h.title, h.snippet, h.author_id, u.name, h.created_at, h.event_at, h.rank, v_words
    from hits h
    left join public.users u on u.id = h.author_id
   order by h.rank desc, h.created_at desc, h.id
   limit v_limit;
end;
$$;
revoke execute on function public.search_bubble(uuid, text, int, text[]) from public, anon;
grant execute on function public.search_bubble(uuid, text, int, text[]) to authenticated;

-- 4 -------------------------------------------------------------------------
-- rpc('chat_messages_around', {p_bubble_id, p_message_id}).select('*, sender:users!sender_id(...)')
--
-- Newest first, like chat_messages_page: up to p_before (default 25, max 100) messages older than the
-- target, the target, and every message after it up to the newest, capped at p_limit (default and max
-- 1000) rows from the newest end. The result is contiguous with the newest page, so clients merge it
-- into the chat as it is: live messages and "load older" (chat_messages_page from the oldest row) keep
-- working. Fewer than p_before rows older than the target means the start of the chat is reached. No
-- rows when the caller can't see the message (RLS: other bubble, blocked sender) or it doesn't exist;
-- if the target isn't among the rows it is too far back for the cap.
create function public.chat_messages_around(
  p_bubble_id uuid,
  p_message_id uuid,
  p_before int default 25,
  p_limit int default 1000
)
returns setof public.chat_messages
language sql
stable
security invoker
set search_path = public
as $$
  with target as (
    select t.created_at, t.id
      from public.chat_messages t
     where t.id = p_message_id and t.bubble_id = p_bubble_id
  ),
  start as (
    select m.created_at, m.id
      from public.chat_messages m, target t
     where m.bubble_id = p_bubble_id
       and (m.created_at, m.id) <= (t.created_at, t.id)
     order by m.created_at desc, m.id desc
     offset least(greatest(coalesce(p_before, 25), 0), 100)
     limit 1
  )
  select m.*
    from public.chat_messages m
   where m.bubble_id = p_bubble_id
     and exists (select 1 from target)
     and (not exists (select 1 from start)
          or (m.created_at, m.id) >= (select s.created_at, s.id from start s))
   order by m.created_at desc, m.id desc
   limit least(greatest(coalesce(p_limit, 1000), 1), 1000)
$$;
revoke execute on function public.chat_messages_around(uuid, uuid, int, int) from public, anon;
grant execute on function public.chat_messages_around(uuid, uuid, int, int) to authenticated;
