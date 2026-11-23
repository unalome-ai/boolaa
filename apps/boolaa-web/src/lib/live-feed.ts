import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { BoolaaClient } from "@/lib/supabase/client";
import { liveChannel } from "@/lib/realtime";
import { useConnectivity } from "@/lib/connectivity";

/** Bubble feeds that stream over Realtime (supabase/migrations/20261123110000_realtime_feeds.sql). */
export type FeedTable = "events" | "food_posts" | "market_items" | "shared_links";

type Identified = { id: string };

/**
 * Inserts or replaces `row` by id and keeps the list sorted. Fields the change payload lacks (the
 * joined author) are kept from the row already in the list. Returns `rows` itself when nothing
 * changed, so React skips the render (no flicker on our own echoed writes).
 */
export function upsertRow<T extends Identified>(rows: T[] | null, row: T, compare: (a: T, b: T) => number): T[] | null {
  if (!rows) return rows; // first load not done yet: it will bring the row
  const i = rows.findIndex((r) => r.id === row.id);
  if (i >= 0) {
    const merged = { ...rows[i], ...row };
    if (shallowEqual(rows[i], merged)) return rows;
    const next = rows.slice();
    next[i] = merged;
    return next.sort(compare);
  }
  return [...rows, row].sort(compare);
}

/** Removes the row with `id`; returns `rows` itself when it isn't there (e.g. another bubble's delete). */
export function removeRow<T extends Identified>(rows: T[] | null, id: string): T[] | null {
  if (!rows || !rows.some((r) => r.id === id)) return rows;
  return rows.filter((r) => r.id !== id);
}

function shallowEqual(a: object, b: object) {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => JSON.stringify((a as Record<string, unknown>)[k]) === JSON.stringify((b as Record<string, unknown>)[k]));
}

/**
 * Keeps a feed list live for the current bubble. INSERT and UPDATE are filtered by `bubble_id`
 * and checked against the subscriber's RLS by Realtime (blocked authors and unverified sessions
 * get nothing). DELETE carries only the id and can't be filtered, so it removes by id and ignores
 * ids the list doesn't hold. New rows are fetched once with `select` to get the joined author
 * (and to let RLS decide again). Resubscribes when the bubble changes and unsubscribes on unmount
 * (leaving the bubble, signing out).
 */
export function useLiveFeed<T extends Identified>(opts: {
  supabase: BoolaaClient;
  table: FeedTable;
  bubbleId: string;
  select: string;
  rows: T[] | null;
  setRows: Dispatch<SetStateAction<T[] | null>>;
  compare: (a: T, b: T) => number;
  /** Full reload, run once the stream is live to catch changes made while connecting. */
  reload: () => unknown;
  /** More listeners on the same channel (reactions). Read once per subscription; keep it stable. */
  extend?: (channel: RealtimeChannel) => RealtimeChannel;
}) {
  const ref = useRef(opts);
  useEffect(() => {
    ref.current = opts;
  });
  const { supabase, table, bubbleId } = opts;
  // A reconnect (or the tab back after a while) bumps this: tear the channel down, subscribe again,
  // and reload once live, so nothing missed while away stays missing.
  const { generation } = useConnectivity();

  useEffect(() => {
    let alive = true;
    const upsert = (row: T) => alive && ref.current.setRows((prev) => upsertRow(prev, row, ref.current.compare));
    const fetchOne = async (id: string) => {
      const { data } = await supabase.from(table).select(ref.current.select).eq("id", id).maybeSingle();
      if (data) upsert(data as unknown as T);
    };
    const filter = `bubble_id=eq.${bubbleId}`;
    const unsubscribe = liveChannel(
      supabase,
      `${table}:${bubbleId}`,
      (ch) =>
        (ref.current.extend ?? ((c: RealtimeChannel) => c))(ch)
          .on("postgres_changes", { event: "INSERT", schema: "public", table, filter }, (p) => void fetchOne((p.new as T).id))
          .on("postgres_changes", { event: "UPDATE", schema: "public", table, filter }, (p) => {
            const row = p.new as T;
            if (!alive) return;
            // A row we don't hold yet (inserted while loading): fetch it with its author.
            if (ref.current.rows && !ref.current.rows.some((r) => r.id === row.id)) void fetchOne(row.id);
            else upsert(row);
          })
          .on("postgres_changes", { event: "DELETE", schema: "public", table }, (p) => {
            const id = (p.old as Partial<T>).id;
            if (alive && id) ref.current.setRows((prev) => removeRow(prev, id));
          }),
      (ready) => {
        if (ready && alive) void ref.current.reload();
      },
    );
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [supabase, table, bubbleId, generation]);
}

export const byCreatedDesc = (a: { created_at: string; id: string }, b: { created_at: string; id: string }) =>
  b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id);

export const byDatetimeAsc = (a: { datetime: string; id: string }, b: { datetime: string; id: string }) =>
  new Date(a.datetime).getTime() - new Date(b.datetime).getTime() || a.id.localeCompare(b.id);
