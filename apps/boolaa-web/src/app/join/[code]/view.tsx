"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Hourglass, LogIn, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { AuthCard } from "@/components/auth-card";
import { StoreButton } from "@/components/store-button";
import { BubblePhoto, ErrorText, Spinner } from "@/components/ui";
import { useErrorText } from "@/i18n/errors";
import type { Database } from "@/lib/database.types";
import { PENDING_INVITE_COOKIE, invitePath, isPlausibleInviteCode, normalizeInviteCode, withNext } from "@/lib/invite";
import { ANDROID_URL, APP_STORE_URL } from "@/lib/site";
import { getSupabase } from "@/lib/supabase/client";
import { BUBBLE_COOKIE, hardNavigate, writeCookie } from "@/lib/utils";

type Preview = Database["public"]["Functions"]["get_invite_preview"]["Returns"][number];
type State =
  | { kind: "loading" }
  | { kind: "signedOut" }
  | { kind: "invalid" }
  | { kind: "error"; message: string }
  | { kind: "preview"; preview: Preview; sent: boolean };

/**
 * /join/CODE. Signed out: sign in / register, then back here (?next=, plus a cookie that survives
 * email confirmation). Signed in: get_invite_preview (name, cover, member count) and "Request to
 * join", which goes through request_to_join and the members' vote like a typed code.
 */
export default function JoinPage({ code: rawCode }: { code: string }) {
  const supabase = getSupabase();
  const t = useTranslations("invite");
  const tc = useTranslations("createJoin");
  const ts = useTranslations("settings");
  const ta = useTranslations("auth");
  const tl = useTranslations("landing");
  const te = useTranslations("errors");
  const errorText = useErrorText();
  const code = useMemo(() => normalizeInviteCode(decodeURIComponentSafe(rawCode)), [rawCode]);
  const here = invitePath(code);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isPlausibleInviteCode(code)) return setState({ kind: "invalid" });
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      writeCookie(PENDING_INVITE_COOKIE, code, 7);
      return setState({ kind: "signedOut" });
    }
    writeCookie(PENDING_INVITE_COOKIE, "", 0); // we're here now: the onboarding fallback isn't needed
    const { data: rows, error } = await supabase.rpc("get_invite_preview", { p_code: code });
    if (error) return setState({ kind: "error", message: errorText(error) });
    const preview = rows?.[0];
    setState(preview ? { kind: "preview", preview, sent: false } : { kind: "invalid" });
  }, [supabase, code, errorText]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function requestToJoin() {
    if (state.kind !== "preview") return;
    setBusy(true);
    setActionError(null);
    const { error } = await supabase.rpc("request_to_join", { p_invite_code: code });
    setBusy(false);
    if (error) return setActionError(errorText(error));
    setState({ kind: "preview", preview: { ...state.preview, status: "pending" }, sent: true });
  }

  function openBubble(id: string) {
    writeCookie(BUBBLE_COOKIE, id);
    hardNavigate("/home");
  }

  const getApp = (
    <div className="mt-6 border-t border-line pt-5" data-testid="get-app">
      <p className="mb-3 text-center font-display text-sm font-bold text-muted">{t("getApp")}</p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <StoreButton href={APP_STORE_URL} label={tl("downloadIos")} soon={tl("comingSoon")} testId="join-download-ios" />
        <StoreButton href={ANDROID_URL} label={tl("downloadAndroid")} soon={tl("comingSoon")} testId="join-download-android" />
      </div>
    </div>
  );

  if (state.kind === "loading")
    return (
      <AuthCard title={t("title")} subtitle="">
        <div className="flex justify-center py-4" data-testid="join-loading">
          <Spinner />
        </div>
      </AuthCard>
    );

  if (state.kind === "signedOut")
    return (
      <AuthCard title={t("title")} subtitle={t("signedOutBody")}>
        <div className="space-y-3" data-testid="join-signed-out">
          <Link href={withNext("/login", here)} className="btn-primary min-h-[50px] w-full" data-testid="join-sign-in">
            <LogIn size={18} strokeWidth={2.6} /> {ta("signIn")}
          </Link>
          <Link href={withNext("/register", here)} className="btn-ghost min-h-[50px] w-full" data-testid="join-register">
            <UserPlus size={18} strokeWidth={2.6} /> {ta("createAccount")}
          </Link>
        </div>
        {getApp}
      </AuthCard>
    );

  if (state.kind === "invalid")
    return (
      <AuthCard title={t("invalidTitle")} subtitle={t("invalidBody")}>
        <div data-testid="join-invalid">
          <Link href="/" className="btn-ghost w-full" data-testid="join-invalid-home">
            {t("goToBoolaa")}
          </Link>
        </div>
      </AuthCard>
    );

  if (state.kind === "error")
    return (
      <AuthCard title={t("title")} subtitle="">
        <ErrorText>{state.message}</ErrorText>
        <button type="button" className="btn-primary mt-4 w-full" onClick={() => void load()}>
          {ta("tryAgain")}
        </button>
      </AuthCard>
    );

  const { preview, sent } = state;
  return (
    <AuthCard title={t("title")} subtitle={t("approvalNote")}>
      <div className="card flex items-center gap-4 p-4" data-testid="join-preview" data-status={preview.status}>
        {/* Non-members don't get the bubble id: the initials' hue comes from the name instead. */}
        <BubblePhoto bubble={{ id: preview.bubble_id ?? preview.name, name: preview.name, logo: preview.logo }} size={64} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[19px] font-extrabold" data-testid="join-bubble-name">
            {preview.name}
          </p>
          <p className="text-sm text-muted">{ts("memberCount", { count: preview.member_count, max: preview.max_size })}</p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {preview.status === "open" && (
          <button type="button" onClick={requestToJoin} disabled={busy} className="btn-primary min-h-[50px] w-full" data-testid="join-request">
            {busy ? tc("sending") : tc("requestJoin")}
          </button>
        )}
        {preview.status === "pending" && (
          <>
            <p className="flex items-start gap-2 text-[15px]" data-testid="join-pending">
              {sent ? <Check size={18} className="mt-0.5 shrink-0 text-brand-ink" /> : <Hourglass size={18} className="mt-0.5 shrink-0 text-muted" />}
              <span className={sent ? "font-bold" : undefined}>{sent ? t("requestSent") : t("pending")}</span>
            </p>
            <Link href="/onboarding" className="btn-ghost w-full" data-testid="join-view-pending">
              {tc("viewPending")}
            </Link>
          </>
        )}
        {preview.status === "member" && (
          <>
            <p className="text-[15px]" data-testid="join-member">
              {t("member")}
            </p>
            {preview.bubble_id && (
              <button type="button" onClick={() => openBubble(preview.bubble_id!)} className="btn-primary w-full" data-testid="join-open">
                {t("openBubble")}
              </button>
            )}
          </>
        )}
        {preview.status === "full" && (
          <p className="text-[15px]" data-testid="join-full">
            {te("bubbleFull")}
          </p>
        )}
        <ErrorText>{actionError}</ErrorText>
      </div>
    </AuthCard>
  );
}

function decodeURIComponentSafe(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
