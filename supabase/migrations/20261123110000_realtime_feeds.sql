-- Live updates for the bubble feeds (events + RSVPs, food, market, links), not only chat.
--
-- Clients subscribe to postgres_changes on these tables with a `bubble_id=eq.<id>` filter.
-- Realtime evaluates each INSERT/UPDATE against the subscriber's SELECT policies (bubble
-- membership, blocks, the restrictive require_verified_session gate), so RLS keeps deciding who
-- sees what. RSVPs live in events.rsvp_list, so an RSVP arrives as an UPDATE of the event row.
--
-- DELETE: these tables keep the default replica identity on purpose. With RLS enabled, Realtime
-- only ever sends the primary key of a deleted row (FULL would not add columns) and does not run
-- RLS for deletes, so clients remove rows by id and ignore ids they don't hold. FULL would only
-- add WAL volume.

do $$
declare
  t text;
begin
  foreach t in array array['events', 'food_posts', 'market_items', 'shared_links'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
