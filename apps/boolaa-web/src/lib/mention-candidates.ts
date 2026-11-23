"use client";

/**
 * `rpc('mention_candidates')` for the current bubble (docs/boolaa-spec.md, "Mentions"): the composer's
 * list and the rendering rule. Loaded when the chat opens (cached as the last view), on bubble switch,
 * after a reconnect, after a block / unblock, and at most every 30 s when a message mentions someone
 * the reader doesn't know yet.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { BoolaaClient } from "@/lib/supabase/client";
import { readCache, writeCache } from "@/lib/offline";
import type { Candidate } from "@/lib/mentions";

const UNKNOWN_REFRESH_MS = 30_000;

export function useMentionCandidates(opts: { supabase: BoolaaClient; bubbleId: string; generation: number; blocked: Set<string> }) {
  const { supabase, bubbleId, generation, blocked } = opts;
  const key = `mentions.${bubbleId}`;
  const [list, setList] = useState<Candidate[] | null>(() => readCache<Candidate[]>(key));
  const lastUnknown = useRef(0);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("mention_candidates", { p_bubble_id: bubbleId });
    if (error) return;
    const rows = (data ?? []).map((r) => ({ user_id: r.user_id.toLowerCase(), name: r.name, avatar: r.avatar ?? null }));
    setList(rows);
    writeCache(key, rows);
  }, [supabase, bubbleId, key]);

  // Bubble switch: start from that bubble's cached list.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setList(readCache<Candidate[]>(key));
  }, [key]);

  // Open, reconnect (generation), block / unblock (blocked changes identity).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async load, state is set after the RPC
    void load();
  }, [load, generation, blocked]);

  // Back in the foreground: someone may have joined, left or been blocked meanwhile.
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  /** A message mentions people neither the reader nor a candidate: someone may have joined. */
  const checkUnknown = useCallback(
    (userIds: string[], readerId: string) => {
      if (!list) return;
      const known = new Set(list.map((c) => c.user_id));
      if (!userIds.some((id) => id !== readerId && !known.has(id))) return;
      const now = Date.now();
      if (now - lastUnknown.current < UNKNOWN_REFRESH_MS) return;
      lastUnknown.current = now;
      void load();
    },
    [list, load],
  );

  return { candidates: list ?? [], loaded: list !== null, reload: load, checkUnknown };
}
