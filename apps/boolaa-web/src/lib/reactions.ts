/**
 * Reactions on chat messages, events, food posts, market items and links
 * (docs/boolaa-spec.md, "Reactions"; migration 20261123160000_reactions_link_previews.sql).
 *
 * Rows are loaded per screen for the targets it holds, kept in memory and counted per
 * (target, reaction). Live changes ride on the screen's existing channel (see `bind`): INSERT
 * filtered by bubble (RLS-checked), DELETE by the random row id only.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { BoolaaClient } from "@/lib/supabase/client";

export const REACTIONS = ["like", "love", "laugh", "wow", "sad", "thanks"] as const;
export type ReactionKey = (typeof REACTIONS)[number];
export const REACTION_EMOJI: Record<ReactionKey, string> = {
  like: "👍",
  love: "❤️",
  laugh: "😂",
  wow: "😮",
  sad: "😢",
  thanks: "🙏",
};
export type ReactionTarget = "chat_message" | "event" | "food_post" | "market_item" | "shared_link";

export type ReactionRow = { id: string; target_type: string; target_id: string; reaction: string; user_id: string };
export type ReactionSummary = { reaction: ReactionKey; count: number; mine: boolean }[];

const COLUMNS = "id, target_type, target_id, reaction, user_id";
export const REACTION_CHUNK = 100;

/** Adds a row unless one with that id is already held. Returns `rows` itself when unchanged. */
export function addReaction(rows: ReactionRow[], row: ReactionRow) {
  return rows.some((r) => r.id === row.id) ? rows : [...rows, row];
}

/** Removes the row with `id`. Returns `rows` itself when it isn't held. */
export function removeReaction(rows: ReactionRow[], id: string) {
  return rows.some((r) => r.id === id) ? rows.filter((r) => r.id !== id) : rows;
}

/** Counts per reaction for one target, in the fixed order, only those with a count. */
export function summarize(rows: ReactionRow[], targetId: string, userId: string, hidden?: Set<string>): ReactionSummary {
  const out: ReactionSummary = [];
  for (const key of REACTIONS) {
    const mine = rows.filter((r) => r.target_id === targetId && r.reaction === key && !hidden?.has(r.user_id));
    if (mine.length > 0) out.push({ reaction: key, count: mine.length, mine: mine.some((r) => r.user_id === userId) });
  }
  return out;
}

/** Loads the reactions of the given targets, 100 ids per request. */
export async function loadReactions(supabase: BoolaaClient, bubbleId: string, type: ReactionTarget, ids: string[]) {
  const rows: ReactionRow[] = [];
  for (let i = 0; i < ids.length; i += REACTION_CHUNK) {
    const { data, error } = await supabase
      .from("reactions")
      .select(COLUMNS)
      .eq("bubble_id", bubbleId)
      .eq("target_type", type)
      .in("target_id", ids.slice(i, i + REACTION_CHUNK));
    if (error) throw error;
    rows.push(...((data ?? []) as ReactionRow[]));
  }
  return rows;
}

/**
 * Reaction state for one screen. `targetIds` are the items on screen; reactions of new ids are
 * loaded as they appear. `bind` adds the reaction listeners to the screen's own channel (it is
 * stable, so it can be used inside the channel's effect).
 */
export function useReactions(opts: {
  supabase: BoolaaClient;
  bubbleId: string;
  type: ReactionTarget;
  targetIds: string[];
  userId: string;
  onError?: (err: unknown) => void;
}) {
  const { supabase, bubbleId, type, userId } = opts;
  const [rows, setRows] = useState<ReactionRow[]>([]);
  const busy = useRef(new Set<string>());
  const loaded = useRef(new Set<string>());
  const held = useRef(new Set<string>());
  const onError = useRef(opts.onError);
  useEffect(() => {
    onError.current = opts.onError;
  });

  const key = [...new Set(opts.targetIds)].sort().join(",");
  useEffect(() => {
    held.current = new Set(key ? key.split(",") : []);
  }, [key]);

  // A new bubble (or screen type) starts empty.
  useEffect(() => {
    loaded.current = new Set();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows([]);
  }, [bubbleId, type]);

  const fetchIds = useCallback(
    async (ids: string[], replace: boolean) => {
      if (ids.length === 0) return;
      ids.forEach((id) => loaded.current.add(id));
      try {
        const got = await loadReactions(supabase, bubbleId, type, ids);
        const set = new Set(ids);
        setRows((prev) => {
          const kept = replace ? prev.filter((r) => !set.has(r.target_id)) : prev;
          return got.reduce(addReaction, kept);
        });
      } catch (err) {
        ids.forEach((id) => loaded.current.delete(id));
        onError.current?.(err);
      }
    },
    [supabase, bubbleId, type],
  );

  useEffect(() => {
    const ids = key ? key.split(",") : [];
    void fetchIds(
      ids.filter((id) => !loaded.current.has(id)),
      false,
    );
  }, [key, fetchIds]);

  /** Reloads every held target's reactions (after the channel goes live). */
  const reload = useCallback(() => fetchIds([...held.current], true), [fetchIds]);

  /** Drops a target's reactions (a chat message was deleted). */
  const dropTarget = useCallback((targetId: string) => {
    setRows((prev) => (prev.some((r) => r.target_id === targetId) ? prev.filter((r) => r.target_id !== targetId) : prev));
  }, []);

  const bind = useCallback(
    (ch: RealtimeChannel) =>
      ch
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "reactions", filter: `bubble_id=eq.${bubbleId}` }, (p) => {
          const row = p.new as ReactionRow;
          if (row.target_type === type && held.current.has(row.target_id)) setRows((prev) => addReaction(prev, row));
        })
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "reactions" }, (p) => {
          const id = (p.old as Partial<ReactionRow>).id;
          if (id) setRows((prev) => removeReaction(prev, id));
        }),
    [bubbleId, type],
  );

  const toggle = useCallback(
    async (targetId: string, reaction: ReactionKey) => {
      const k = `${targetId}:${reaction}`;
      if (busy.current.has(k)) return; // a double click while the first toggle is in flight
      busy.current.add(k);
      const { data, error } = await supabase.rpc("toggle_reaction", { p_target_type: type, p_target_id: targetId, p_reaction: reaction });
      busy.current.delete(k);
      if (error) return onError.current?.(error);
      const res = data as { id: string; reacted: boolean } | null;
      if (!res) return;
      setRows((prev) =>
        res.reacted
          ? addReaction(prev, { id: res.id, target_type: type, target_id: targetId, reaction, user_id: userId })
          : removeReaction(prev, res.id),
      );
    },
    [supabase, type, userId],
  );

  return { rows, toggle, bind, reload, dropTarget };
}

export type Reactions = ReturnType<typeof useReactions>;
