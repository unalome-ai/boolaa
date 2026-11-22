"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useBoolaa } from "@/components/boolaa-provider";
import { liveChannel } from "@/lib/realtime";

export type UnreadEntry = { unread: number; lastReadAt: string | null };

type Ctx = {
  /** By bubble id: unread messages from others (capped at 100) and the last-read marker. */
  counts: Record<string, UnreadEntry>;
  /** Fresh counts from the server; resolves with this bubble's entry (the chat's divider uses it). */
  load: (bubbleId?: string) => Promise<UnreadEntry | null>;
  /** Moves this bubble's marker up to `messageId` (the newest message shown). */
  markRead: (bubbleId: string, messageId: string) => Promise<void>;
};

const UnreadContext = createContext<Ctx | null>(null);

export function useChatUnread() {
  const ctx = useContext(UnreadContext);
  if (!ctx) throw new Error("useChatUnread must be used inside <ChatUnreadProvider>");
  return ctx;
}

/**
 * Unread chat counts for every bubble (docs/boolaa-spec.md, "Chat"): chat_unread_counts() on start,
 * focus and bubble-list changes, and (debounced) on any chat message insert in my bubbles, from one
 * unfiltered channel that RLS limits to bubbles I can read.
 */
export function ChatUnreadProvider({ children }: { children: ReactNode }) {
  const { supabase, userId, bubbles } = useBoolaa();
  const [counts, setCounts] = useState<Record<string, UnreadEntry>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const bubbleKey = bubbles.map((b) => b.id).join(",");

  const load = useCallback(
    async (bubbleId?: string) => {
      const { data, error } = await supabase.rpc("chat_unread_counts");
      if (error || !data) return null;
      const next: Record<string, UnreadEntry> = {};
      for (const r of data) next[r.bubble_id] = { unread: r.unread_count, lastReadAt: r.last_read_at };
      setCounts(next);
      return bubbleId ? (next[bubbleId] ?? null) : null;
    },
    [supabase],
  );

  const refresh = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(), 400);
  }, [load]);

  useEffect(() => {
    // Initial load and whenever the bubble list changes; setState happens after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, bubbleKey]);

  useEffect(() => {
    const unsubscribe = liveChannel(
      supabase,
      `unread:${userId}`,
      (ch) =>
        ch
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (p) => {
            if ((p.new as { sender_id?: string }).sender_id !== userId) refresh();
          })
          // A deleted unread message leaves the count.
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages" }, (p) => {
            if ((p.new as { sender_id?: string }).sender_id !== userId) refresh();
          }),
      (ready) => ready && refresh(),
    );
    const onVisible = () => document.visibilityState === "visible" && refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      unsubscribe();
    };
  }, [supabase, userId, refresh]);

  const markRead = useCallback(
    async (bubbleId: string, messageId: string) => {
      const { data, error } = await supabase.rpc("mark_chat_read", { p_bubble_id: bubbleId, p_message_id: messageId });
      if (error) return;
      setCounts((c) => ({ ...c, [bubbleId]: { unread: 0, lastReadAt: data } }));
      refresh(); // messages newer than the marker (a race) come back with the next count
    },
    [supabase, refresh],
  );

  const value = useMemo(() => ({ counts, load, markRead }), [counts, load, markRead]);
  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>;
}
