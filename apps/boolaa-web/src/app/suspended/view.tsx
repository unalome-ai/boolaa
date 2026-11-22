"use client";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { LogOut } from "lucide-react";
import { BubbleLogo } from "@/components/orb";
import { PageLoader } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { unregisterPush } from "@/lib/push";
import { hardNavigate, signOutTarget } from "@/lib/utils";

type State =
  | { kind: "loading" }
  | { kind: "signedOut" }
  | { kind: "active" }
  | { kind: "suspended"; until: string | null; reason: string | null }
  | { kind: "banned"; reason: string | null };

const REASONS = ["spam", "harassment", "hate", "sexual", "violence", "self_harm", "other"] as const;
const APPEAL_EMAIL = "privacy@boolaa.ro";

/** Calm, still screen (no orbs or confetti): status, reason, end date, appeal address, sign out. */
export default function SuspendedPage() {
  const t = useTranslations("suspended");
  const tr = useTranslations("safety.reasons");
  const format = useFormatter();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user.id;
      if (!uid) return setState({ kind: "signedOut" });
      // A suspended user may still read their own row (RLS); a refused refresh means signed out.
      const { data: row } = await supabase.from("users").select("status, status_reason, status_until").eq("id", uid).maybeSingle();
      if (!row) return setState({ kind: "signedOut" });
      if (row.status === "banned") return setState({ kind: "banned", reason: row.status_reason });
      if (row.status === "suspended" && (!row.status_until || new Date(row.status_until).getTime() > Date.now()))
        return setState({ kind: "suspended", until: row.status_until, reason: row.status_reason });
      setState({ kind: "active" });
    });
  }, []);

  const signOut = async () => {
    signOutTarget.leaving = true;
    signOutTarget.path = "/login";
    await unregisterPush(getSupabase()); // works for suspended accounts too
    await getSupabase().auth.signOut({ scope: "local" });
    hardNavigate("/login");
  };

  if (state.kind === "loading")
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <PageLoader />
      </main>
    );

  const reason =
    "reason" in state && state.reason && (REASONS as readonly string[]).includes(state.reason) ? tr(state.reason as (typeof REASONS)[number]) : null;
  const title = state.kind === "banned" ? t("titleBanned") : state.kind === "active" ? t("activeAgain") : t("titleSuspended");

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-hero bg-card p-6 shadow-soft sm:p-7" data-testid="suspended" data-state={state.kind}>
        <BubbleLogo size={48} animated={false} />
        <h1 className="mt-4 text-[22px] font-black tracking-tight">{title}</h1>
        <div className="mt-3 space-y-2 text-[15px]">
          {state.kind === "suspended" && (
            <>
              {state.until && (
                <p data-testid="suspended-until">
                  {t("until", { date: format.dateTime(new Date(state.until), { dateStyle: "long", timeStyle: "short" }) })}
                </p>
              )}
              <p className="text-muted">{t("blocked")}</p>
            </>
          )}
          {state.kind === "banned" && <p>{t("banned")}</p>}
          {state.kind === "signedOut" && <p>{t("signInBlocked")}</p>}
          {reason && <p data-testid="suspended-reason">{t("reason", { reason })}</p>}
        </div>
        {state.kind !== "active" && (
          <p className="mt-4 rounded-field bg-field px-4 py-3 text-sm">
            {t.rich("appeal", {
              mail: (chunks) => (
                <a href={`mailto:${APPEAL_EMAIL}`} className="font-semibold text-brand-ink underline">
                  {chunks}
                </a>
              ),
            })}
          </p>
        )}
        <div className="mt-5 flex gap-2">
          {state.kind === "active" ? (
            <button type="button" className="btn-calm flex-1" onClick={() => hardNavigate("/home")}>
              {t("continue")}
            </button>
          ) : state.kind === "signedOut" ? (
            <button type="button" className="btn-calm-ghost flex-1" onClick={() => hardNavigate("/login")} data-testid="suspended-back">
              {t("backToSignIn")}
            </button>
          ) : (
            <button type="button" className="btn-calm-ghost flex-1" onClick={signOut} data-testid="suspended-sign-out">
              <LogOut size={18} aria-hidden /> {t("signOut")}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
