-- Marketplace availability (available / reserved / taken) and calendar export.
--
-- 1. market_items.availability
--    A second, independent dimension next to `status` (free / trade, what kind of offer it is):
--    `availability` says whether the item can still be had. Values:
--      available  default, shown as usual
--      reserved   the owner promised it to someone; others can still ask (waiting list)
--      taken      gone; clients sort it last and can hide it
--    It deliberately does NOT record who the item is reserved for: the deal is arranged in the
--    bubble chat, a "reserved for X" label would publish members' private arrangements to the
--    whole bubble (and to anyone X has blocked), and a user reference would need consent, block
--    and account-deletion handling for little gain. The owner knows who it's for.
--
--    Only the owner changes it: the existing `market_update_own` policy (owner_id = auth.uid())
--    plus the restrictive verified-session policy already gate every UPDATE. A plain UPDATE keeps
--    all three clients on the same write path as editing an item; no RPC needed.
--    Status changes reach members live as an UPDATE (market_items is in supabase_realtime since
--    20261123110000_realtime_feeds.sql).
--
-- 2. Column-level UPDATE grant on market_items (like `bubbles` in 20261123130000): clients may
--    only change the editable fields. Before this an owner could move an item into another
--    bubble (bubble_id is not re-checked on UPDATE) or rewrite created_at to float it to the top.
--
-- 3. Calendar export needs no schema: events have `datetime` (timestamptz, the start) and an
--    optional `location`, no end time and no all-day flag. Clients export a 1-hour event in UTC
--    (see docs/boolaa-spec.md, "Add to calendar").

alter table public.market_items
  add column availability text not null default 'available'
    check (availability in ('available', 'reserved', 'taken'));

comment on column public.market_items.availability is
  'available | reserved | taken. Owner-only (market_update_own). Who it is reserved for is intentionally not stored.';

revoke update on public.market_items from anon, authenticated;
grant update (image, title, description, status, availability) on public.market_items to authenticated;
