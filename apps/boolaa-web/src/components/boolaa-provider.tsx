"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getSupabase, type BoolaaClient } from "@/lib/supabase/client";
import { liveChannel } from "@/lib/realtime";
import type { Bubble, UserProfile } from "@/lib/types";
import { BUBBLE_COOKIE, hardNavigate, readCookie, signOutTarget, writeCookie } from "@/lib/utils";
import { gateState } from "@/lib/device";
import { syncPush } from "@/lib/push";
import { useLocale } from "next-intl";

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
  /** People I blocked. Blocking is two-way on the server (RLS); views also filter instantly. */
  blocked: Set<string>;
  block: (userId: string) => Promise<void>;
  unblock: (userId: string) => Promise<void>;
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

/**
 * Merges a realtime UPDATE of a `bubbles` row into my list by id (keeping my role). Ids I don't hold
 * are ignored, and an unchanged row returns the same list so nothing re-renders.
 */
export function mergeBubbleUpdate(list: MyBubble[], row: Partial<Bubble>): MyBubble[] {
  const i = list.findIndex((b) => b.id === row.id);
  if (i < 0) return list;
  const cur = list[i]!;
  const next: MyBubble = {
    ...cur,
    name: row.name ?? cur.name,
    description: row.description !== undefined ? row.description : cur.description,
    logo: row.logo !== undefined ? row.logo : cur.logo,
  };
  if (next.name === cur.name && next.description === cur.description && next.logo === cur.logo) return list;
  return list.map((b, j) => (j === i ? next : b));
}

export function BoolaaProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const supabase = getSupabase();
  const [auth, setAuth] = useState<{ id: string; email: string } | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [bubbles, setBubbles] = useState<MyBubble[] | null>(null);
  const [bubbleId, setBubbleIdState] = useState<string | null>(null);
  const [lostBubble, setLostBubble] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const current = useRef<{ bubbles: MyBubble[] | null; bubbleId: string | null }>({ bubbles: null, bubbleId: null });
  const locale = useLocale();
  const [verified, setVerified] = useState(false);
  // Deep link from a notification (docs/push-notifications.md §5): `?bubble=<id>` on first load
  // switches to that bubble if it's still one of mine, otherwise opens Home without switching.
  const deepLinkBubble = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    current.current = { bubbles, bubbleId };
  }, [bubbles, bubbleId]);

  const setBubbleId = useCallback((id: string) => {
    writeCookie(BUBBLE_COOKIE, id);
    setBubbleIdState(id);
  }, []);

  const refreshBubbles = useCallback(async () => {
    if (!auth || signOutTarget.leaving) return [];
    const list = await fetchMyBubbles(supabase, auth.id);
    const prev = current.current;
    const lost = prev.bubbleId && !list.some((b) => b.id === prev.bubbleId) && prev.bubbles?.find((b) => b.id === prev.bubbleId);
    if (lost) setLostBubble(lost.name);
    if (signOutTarget.leaving) return list;
    if (list.length === 0) {
      hardNavigate("/onboarding");
      return list;
    }
    if (deepLinkBubble.current === undefined)
      deepLinkBubble.current = new URLSearchParams(window.location.search).get("bubble");
    const linked = deepLinkBubble.current;
    deepLinkBubble.current = null;
    if (linked && !list.some((b) => b.id === linked) && window.location.pathname !== "/home") {
      hardNavigate("/home");
      return list;
    }
    const pick = linked && list.some((b) => b.id === linked) ? linked : null;
    if (linked) {
      // Applied once: drop it from the address bar so the bubble switcher stays in charge.
      const url = new URL(window.location.href);
      url.searchParams.delete("bubble");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
    setBubbles(list);
    setBubbleIdState((cur) => {
      const wanted = pick ?? cur ?? readCookie(BUBBLE_COOKIE);
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
      // Session restore: start_device_check on every load (docs/auth-security.md §8). The proxy
      // already sent unverified sessions to /verify, so this runs alongside the data load; it keeps
      // the device's trust fresh and catches a revocation that happened since.
      gateState(supabase)
        .then((state) => {
          if (alive && state !== "ok" && !signOutTarget.leaving)
            hardNavigate(`/verify?next=${encodeURIComponent(window.location.pathname)}`);
          else if (alive && state === "ok") setVerified(true);
        })
        .catch(() => undefined);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") hardNavigate(signOutTarget.path);
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
    const unsubscribe = liveChannel(
      supabase,
      `membership:${auth.id}`,
      (ch) =>
        ch
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "bubble_members", filter: mine }, refresh)
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "bubble_members", filter: mine }, refresh)
          .on("postgres_changes", { event: "DELETE", schema: "public", table: "bubble_members" }, (p) => {
            if ((p.old as { user_id?: string }).user_id === auth.id) refresh();
          })
          // A bubble's name, description or photo changed (RLS sends only bubbles I can read).
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "bubbles" }, (p) => {
            setBubbles((list) => (list ? mergeBubbleUpdate(list, p.new as Partial<Bubble>) : list));
          }),
      (ready) => {
        if (ready) void refreshBubbles().then(() => setLive(true));
        else setLive(false);
      },
    );
    // Fallback if a realtime event was missed (tab asleep, socket reconnecting).
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      unsubscribe();
    };
  }, [auth, supabase, refreshBubbles]);

  // Push: once the session is verified, register this browser's subscription again on every start
  // and whenever the language changes (never prompts; docs/push-notifications.md §8).
  useEffect(() => {
    if (!verified || signOutTarget.leaving) return;
    syncPush(supabase, locale).catch(() => undefined);
  }, [verified, locale, supabase]);

  const dismissLostBubble = useCallback(() => setLostBubble(null), []);

  useEffect(() => {
    if (!auth) return;
    supabase
      .from("blocks")
      .select("blocked_id")
      .eq("blocker_id", auth.id)
      .then(({ data }) => setBlocked(new Set((data ?? []).map((b) => b.blocked_id))));
  }, [auth, supabase]);

  const block = useCallback(
    async (id: string) => {
      if (!auth) return;
      const { error } = await supabase.from("blocks").insert({ blocker_id: auth.id, blocked_id: id });
      if (error && error.code !== "23505") throw error; // already blocked is fine
      setBlocked((prev) => new Set(prev).add(id));
    },
    [auth, supabase],
  );

  const unblock = useCallback(
    async (id: string) => {
      if (!auth) return;
      const { error } = await supabase.from("blocks").delete().eq("blocker_id", auth.id).eq("blocked_id", id);
      if (error) throw error;
      setBlocked((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [auth, supabase],
  );

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
        blocked,
        block,
        unblock,
      }}
    >
      {children}
    </BoolaaContext.Provider>
  );
}
