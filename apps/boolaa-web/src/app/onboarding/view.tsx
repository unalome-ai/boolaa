"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Hourglass, LogOut, RefreshCw } from "lucide-react";
import { fetchMyBubbles } from "@/components/boolaa-provider";
import { CreateJoinTabs } from "@/components/create-join";
import { ErrorText, PageLoader } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { useTranslations } from "next-intl";
import { useErrorText } from "@/i18n/errors";
import { useFormat } from "@/i18n/format";
import { CompactLocalePicker } from "@/i18n/locale-picker";
import { liveChannel } from "@/lib/realtime";
import { BUBBLE_COOKIE, hardNavigate, writeCookie } from "@/lib/utils";

type Pending = {
  id: string;
  created_at: string;
  approver_ids: string[];
  bubble: { id: string; name: string; description: string | null } | null;
};

export default function OnboardingPage() {
  const supabase = getSupabase();
  const t = useTranslations("onboarding");
  const errorText = useErrorText();
  const fmt = useFormat();
  const [userId, setUserId] = useState<string | null>(null);
  const [hasBubbles, setHasBubbles] = useState(false);
  const [pending, setPending] = useState<Pending[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [live, setLive] = useState(false);
  const prevPending = useRef<Pending[] | null>(null);
  const pendingIds = useRef<Set<string>>(new Set());

  const load = useCallback(
    async (uid: string) => {
      setRefreshing(true);
      try {
        const [bubbles, reqs] = await Promise.all([
          fetchMyBubbles(supabase, uid),
          supabase
            .from("join_requests")
            .select("id, created_at, approver_ids, bubble:bubbles!bubble_id(id, name, description)")
            .eq("user_id", uid)
            .order("created_at", { ascending: false }),
        ]);
        if (reqs.error) throw reqs.error;
        const nextPending = reqs.data ?? [];
        // A pending request disappeared and we gained that bubble: we were admitted.
        const prev = prevPending.current;
        const admitted = prev && bubbles.find((b) => prev.some((p) => p.bubble?.id === b.id));
        if (admitted) {
          writeCookie(BUBBLE_COOKIE, admitted.id);
          hardNavigate("/home");
        }
        prevPending.current = nextPending;
        pendingIds.current = new Set(nextPending.map((p) => p.id));
        setPending(nextPending);
        setHasBubbles(bubbles.length > 0);
      } catch (e) {
        setError(errorText(e));
      } finally {
        setRefreshing(false);
      }
    },
    [supabase, errorText],
  );

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return hardNavigate("/login");
      setUserId(data.user.id);
    });
  }, [supabase]);

  useEffect(() => {
    if (!userId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(userId);
    const reload = () => void load(userId);
    // Live updates instead of polling: our own membership row appearing means we were admitted;
    // changes to our requests update the approval counts; a deleted request (rejected, cancelled,
    // or admitted) only carries its id, so it's matched against the requests on screen.
    const unsubscribe = liveChannel(
      supabase,
      `onboarding:${userId}`,
      (ch) =>
        ch
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "bubble_members", filter: `user_id=eq.${userId}` },
            (p) => {
              const row = p.new as { bubble_id?: string; approved?: boolean };
              if (row.approved && row.bubble_id) {
                writeCookie(BUBBLE_COOKIE, row.bubble_id);
                hardNavigate("/home");
              }
            },
          )
          .on("postgres_changes", { event: "*", schema: "public", table: "join_requests", filter: `user_id=eq.${userId}` }, reload)
          .on("postgres_changes", { event: "DELETE", schema: "public", table: "join_requests" }, (p) => {
            if (pendingIds.current.has((p.old as { id?: string }).id ?? "")) reload();
          }),
      (ready) => {
        if (ready) void load(userId).then(() => setLive(true)); // catch up on anything before streaming started
        else setLive(false);
      },
    );
    // Slow fallback in case an event was missed while the tab was asleep.
    window.addEventListener("focus", reload);
    return () => {
      window.removeEventListener("focus", reload);
      unsubscribe();
    };
  }, [userId, load, supabase]);

  async function cancel(id: string) {
    const { error } = await supabase.from("join_requests").delete().eq("id", id);
    if (error) return setError(errorText(error));
    if (userId) await load(userId);
  }

  async function signOut() {
    await supabase.auth.signOut();
    hardNavigate("/login");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 py-8" data-testid="onboarding" data-live={live}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        {hasBubbles ? (
          <Link href="/home" className="chip bg-chip text-brand">
            <ArrowLeft size={16} /> {t("myBubbles")}
          </Link>
        ) : (
          <span className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-lg font-black text-white">
              b
            </span>
            <span className="text-2xl font-black tracking-tight text-brand">boolaa</span>
          </span>
        )}
        <div className="flex items-center gap-2">
          <CompactLocalePicker />
          <button type="button" onClick={signOut} className="chip bg-chip text-muted hover:text-fg">
            <LogOut size={16} /> {t("signOut")}
          </button>
        </div>
      </div>

      <h1 className="text-3xl font-bold tracking-tight">{hasBubbles ? t("titleMore") : t("titleFirst")}</h1>
      <p className="mb-6 mt-1 text-muted">{t("intro")}</p>

      <ErrorText>{error}</ErrorText>

      {pending === null ? (
        <PageLoader />
      ) : (
        <>
          {pending.length > 0 && (
            <section aria-labelledby="pending-title" className="mb-8" data-testid="pending-list">
              <div className="mb-3 flex items-center justify-between">
                <h2 id="pending-title" className="text-lg font-bold">
                  {t("pendingTitle")}
                </h2>
                <button
                  type="button"
                  onClick={() => userId && load(userId)}
                  className="chip bg-chip text-brand"
                  data-testid="refresh-pending"
                >
                  <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} /> {t("refresh")}
                </button>
              </div>
              <ul className="space-y-3">
                {pending.map((p) => (
                  <li key={p.id} className="card flex items-center gap-4 p-4">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand">
                      <Hourglass size={22} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{p.bubble?.name ?? "—"}</p>
                      <p className="text-sm text-muted">
                        {t("approvalsSoFar", { count: p.approver_ids.length })} ·{" "}
                        {t("requested", { time: fmt.relative(p.created_at) })}
                      </p>
                    </div>
                    <button type="button" onClick={() => cancel(p.id)} className="btn-danger px-4 py-2 text-sm">
                      {t("cancelRequest")}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-muted">
                {t("pendingHint")}
              </p>
            </section>
          )}

          <div className="card p-5">
            <CreateJoinTabs
              initial={pending.length > 0 ? "join" : "create"}
              onCreated={(b) => {
                writeCookie(BUBBLE_COOKIE, b.id);
                hardNavigate("/home");
              }}
              onRequested={() => userId && load(userId)}
            />
          </div>
        </>
      )}
    </main>
  );
}
