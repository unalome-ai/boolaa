"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getSupabase, type BoolaaClient } from "@/lib/supabase/client";
import type { Bubble, UserProfile } from "@/lib/types";
import { BUBBLE_COOKIE, hardNavigate, readCookie, writeCookie } from "@/lib/utils";

export type MyBubble = Bubble & { role: string };

type Ctx = {
  supabase: BoolaaClient;
  userId: string;
  email: string;
  profile: UserProfile | null;
  bubbles: MyBubble[];
  bubble: MyBubble | null;
  setBubbleId: (id: string) => void;
  refreshBubbles: () => Promise<MyBubble[]>;
  refreshProfile: () => Promise<void>;
  /** Name of the bubble the user was just dropped from (left or removed by the owner), for a notice. */
  lostBubble: string | null;
  dismissLostBubble: () => void;
  /** Realtime membership feed is connected. */
  live: boolean;
};

const BoolaaContext = createContext<Ctx | null>(null);

export function useBoolaa() {
  const ctx = useContext(BoolaaContext);
  if (!ctx) throw new Error("useBoolaa must be used inside <BoolaaProvider>");
  return ctx;
}

/** Current bubble, guaranteed non-null inside the main shell (the shell waits for it). */
export function useBubble() {
  const { bubble } = useBoolaa();
  if (!bubble) throw new Error("No current bubble");
  return bubble;
}

export async function fetchMyBubbles(supabase: BoolaaClient, userId: string): Promise<MyBubble[]> {
  const { data, error } = await supabase
    .from("bubble_members")
    .select("role, created_at, bubble:bubbles!bubble_id(*)")
    .eq("user_id", userId)
    .eq("approved", true)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).flatMap((m) => (m.bubble ? [{ ...m.bubble, role: m.role }] : []));
}

export function BoolaaProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const supabase = getSupabase();
  const [auth, setAuth] = useState<{ id: string; email: string } | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [bubbles, setBubbles] = useState<MyBubble[] | null>(null);
  const [bubbleId, setBubbleIdState] = useState<string | null>(null);
  const [lostBubble, setLostBubble] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const current = useRef<{ bubbles: MyBubble[] | null; bubbleId: string | null }>({ bubbles: null, bubbleId: null });
  useEffect(() => {
    current.current = { bubbles, bubbleId };
  }, [bubbles, bubbleId]);

  const setBubbleId = useCallback((id: string) => {
    writeCookie(BUBBLE_COOKIE, id);
    setBubbleIdState(id);
  }, []);

  const refreshBubbles = useCallback(async () => {
    if (!auth) return [];
    const list = await fetchMyBubbles(supabase, auth.id);
    const prev = current.current;
    const lost = prev.bubbleId && !list.some((b) => b.id === prev.bubbleId) && prev.bubbles?.find((b) => b.id === prev.bubbleId);
    if (lost) setLostBubble(lost.name);
    if (list.length === 0) {
      hardNavigate("/onboarding");
      return list;
    }
    setBubbles(list);
    setBubbleIdState((cur) => {
      const wanted = cur ?? readCookie(BUBBLE_COOKIE);
      const next = list.find((b) => b.id === wanted)?.id ?? list[0]!.id;
      if (next !== readCookie(BUBBLE_COOKIE)) writeCookie(BUBBLE_COOKIE, next);
      return next;
    });
    return list;
  }, [auth, supabase]);

  const refreshProfile = useCallback(async () => {
    if (!auth) return;
    const { data } = await supabase.from("users").select("*").eq("id", auth.id).maybeSingle();
    setProfile(data);
  }, [auth, supabase]);

  useEffect(() => {
    let alive = true;
    // The proxy already verified the session for this request; reading it locally (no network)
    // is enough here because every query is enforced by RLS on the server anyway.
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      const user = data.session?.user;
      if (!user) {
        hardNavigate("/login");
        return;
      }
      setAuth({ id: user.id, email: user.email ?? "" });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") hardNavigate("/login");
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!auth) return;
    // Initial load once the auth user is known; setState happens after the awaits.
    /* eslint-disable react-hooks/set-state-in-effect */
    void refreshBubbles();
    void refreshProfile();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [auth, refreshBubbles, refreshProfile]);

  // Live membership: admitted elsewhere, ownership handed over, or removed by the owner. DELETE events
  // can't be filtered server-side (the old row only carries the primary key), so they're checked here.
  useEffect(() => {
    if (!auth) return;
    const refresh = () => void refreshBubbles();
    const mine = `user_id=eq.${auth.id}`;
    const channel = supabase
      .channel(`membership:${auth.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "bubble_members", filter: mine }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "bubble_members", filter: mine }, refresh)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "bubble_members" }, (p) => {
        if ((p.old as { user_id?: string }).user_id === auth.id) refresh();
      })
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    // Fallback if a realtime event was missed (tab asleep, socket reconnecting).
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      void supabase.removeChannel(channel);
    };
  }, [auth, supabase, refreshBubbles]);

  const dismissLostBubble = useCallback(() => setLostBubble(null), []);

  const bubble = useMemo(() => bubbles?.find((b) => b.id === bubbleId) ?? null, [bubbles, bubbleId]);

  if (!auth || !bubbles || !bubble) return <>{fallback}</>;

  return (
    <BoolaaContext.Provider
      value={{
        supabase,
        userId: auth.id,
        email: auth.email,
        profile,
        bubbles,
        bubble,
        setBubbleId,
        refreshBubbles,
        refreshProfile,
        lostBubble,
        dismissLostBubble,
        live,
      }}
    >
      {children}
    </BoolaaContext.Provider>
  );
}
