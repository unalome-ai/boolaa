"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { LogOut, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { AuthCard } from "@/components/auth-card";
import { CodeInput, ResendButton, useCooldown } from "@/components/code-input";
import { DeleteAccountPanel } from "@/components/delete-account";
import { ErrorText, Spinner } from "@/components/ui";
import { useErrorText } from "@/i18n/errors";
import { isLocale } from "@/i18n/config";
import { syncAccountLocale } from "@/i18n/locale-picker";
import { safeNext } from "@/lib/auth-next";
import { RESEND_COOLDOWN_S, TERMS_VERSION, gateState, lastSent, markSent, sendDeviceCode, verifyDeviceCode } from "@/lib/device";
import { getSupabase } from "@/lib/supabase/client";
import { cx, hardNavigate } from "@/lib/utils";

type Stage = "checking" | "code" | "age" | "error";

/**
 * The device gate (docs/auth-security.md §8): every sign-in (password, OAuth, reset) and every
 * proxy redirect of an unverified session lands here. It runs start_device_check, then shows
 * "Check your email" (device code) and/or the one-time 16+ & Terms screen, then continues to `next`.
 */
export default function VerifyPage() {
  const supabase = getSupabase();
  const t = useTranslations("auth");
  const locale = useLocale();
  const errorText = useErrorText();
  const [stage, setStage] = useState<Stage>("checking");
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const next = () => safeNext(new URLSearchParams(window.location.search).get("next"));
  const done = useCallback(() => hardNavigate(next()), []);

  /** Decides the next screen; also used after a code is accepted. */
  const evaluate = useCallback(async () => {
    const state = await gateState(supabase);
    if (state !== "ok") return setStage(state);
    // Google / Apple sign-ups never saw the sign-up checkbox: ask once even before the age flag
    // is switched on (with it on, needs_age_confirmation already says so).
    const { data } = await supabase.auth.getSession();
    const provider = data.session?.user.app_metadata?.provider;
    if (provider && provider !== "email") {
      const { data: me } = await supabase.from("users").select("age_confirmed_at").eq("id", data.session!.user.id).maybeSingle();
      if (me && !me.age_confirmed_at) return setStage("age");
    }
    done();
  }, [supabase, done]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user) return hardNavigate("/login");
      setEmail(user.email ?? "");
      setUserId(user.id);
      // First OAuth sign-in (or an account from before locales): store the UI language for emails.
      if (!user.user_metadata?.locale && isLocale(locale)) await syncAccountLocale(locale).catch(() => undefined);
      await evaluate();
    })().catch((e) => {
      setError(errorText(e));
      setStage("error");
    });
  }, [supabase, evaluate, errorText, locale]);

  async function useAnotherAccount() {
    await supabase.auth.signOut({ scope: "local" });
    hardNavigate("/login");
  }

  const switchAccount = (
    <p className="mt-5 text-center text-sm text-muted">
      <button type="button" onClick={useAnotherAccount} className="inline-flex items-center gap-1.5 font-semibold text-brand-ink hover:underline" data-testid="use-another-account">
        <LogOut size={15} /> {t("useAnotherAccount")}
      </button>
    </p>
  );

  if (stage === "code")
    return (
      <AuthCard title={t("deviceTitle")} subtitle={t("deviceSubtitle", { email })}>
        <DeviceCode onVerified={() => evaluate().catch((e) => setError(errorText(e)))} />
        <ErrorText>{error}</ErrorText>
        {switchAccount}
      </AuthCard>
    );

  if (stage === "age")
    return (
      <AuthCard title={t("ageTitle")} subtitle={t("ageSubtitle")}>
        <AgeConfirm onDone={done} supabase={supabase} userId={userId} />
        {switchAccount}
      </AuthCard>
    );

  if (stage === "error")
    return (
      <AuthCard title={t("deviceTitle")} subtitle={t("checkingFailed")}>
        <ErrorText>{error}</ErrorText>
        <button type="button" className="btn-primary mt-4 w-full" onClick={() => window.location.reload()}>
          {t("tryAgain")}
        </button>
        {switchAccount}
      </AuthCard>
    );

  return (
    <AuthCard title={t("checkingTitle")} subtitle={t("checkingSubtitle")}>
      <div className="flex justify-center py-4" data-testid="verify-checking">
        <Spinner />
      </div>
    </AuthCard>
  );
}

/** "Check your email": sends once on entry (not again within 60 s), 6-digit input, resend with cooldown. */
function DeviceCode({ onVerified }: { onVerified: () => void }) {
  const supabase = getSupabase();
  const t = useTranslations("auth");
  const locale = useLocale();
  const errorText = useErrorText();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const cooldown = useCooldown();
  const sentOnce = useRef(false);

  const send = useCallback(
    async (manual: boolean) => {
      setSending(true);
      setError(null);
      try {
        await sendDeviceCode(supabase, locale);
        markSent("device");
        cooldown.start(RESEND_COOLDOWN_S);
        if (manual) setNotice(t("codeResent"));
      } catch (e) {
        setError(errorText(e));
      } finally {
        setSending(false);
      }
    },
    // cooldown.start is stable enough (only sets state)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supabase, locale, errorText, t],
  );

  useEffect(() => {
    if (sentOnce.current) return;
    sentOnce.current = true;
    const at = lastSent("device");
    if (Date.now() - at < RESEND_COOLDOWN_S * 1000) cooldown.start(RESEND_COOLDOWN_S, at);
    // Sends once on entry; state updates happen after the request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    else void send(false);
  }, [send, cooldown]);

  async function verify(value: string, e?: FormEvent) {
    e?.preventDefault();
    if (value.length !== 6) {
      setError(errorText("codeFormat"));
      setShake((n) => n + 1);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await verifyDeviceCode(supabase, value);
      onVerified();
    } catch (err) {
      setError(errorText(err));
      setShake((n) => n + 1);
      setCode("");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => verify(code, e)} className="space-y-4" data-testid="device-code">
      <CodeInput value={code} onChange={setCode} onComplete={(c) => void verify(c)} disabled={busy} invalid={!!error} id="device-code-input" />
      {notice && !error && (
        <p role="status" className="text-sm font-medium text-mint-ink">
          {notice}
        </p>
      )}
      <ErrorText>{error}</ErrorText>
      <button key={shake} type="submit" className={cx("btn-primary min-h-[54px] w-full text-[17px]", shake > 0 && "anim-shake")} disabled={busy || code.length !== 6}>
        {busy ? t("verifying") : t("verify")}
      </button>
      <p className="text-center text-sm text-muted">
        {t("noCode")} <ResendButton left={cooldown.left} busy={sending} onClick={() => void send(true)} />
      </p>
    </form>
  );
}

/** One-time "I'm 16 or older" + "I accept the Terms" → confirm_age(TERMS_VERSION). Delete stays available. */
function AgeConfirm({ onDone, supabase, userId }: { onDone: () => void; supabase: ReturnType<typeof getSupabase>; userId: string }) {
  const t = useTranslations();
  const errorText = useErrorText();
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [deleting, setDeleting] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("confirm_age", { p_terms_version: TERMS_VERSION });
    if (error) {
      setBusy(false);
      setError(errorText(error));
      setShake((n) => n + 1);
      return;
    }
    onDone();
  }

  const link = (href: string) =>
    function TermsLink(chunks: ReactNode) {
      return (
        <Link href={href} target="_blank" className="font-medium text-brand-ink underline-offset-2 hover:underline">
          {chunks}
        </Link>
      );
    };

  if (deleting) return <DeleteAccountPanel supabase={supabase} userId={userId} onCancel={() => setDeleting(false)} />;

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="age-screen">
      <label className="flex cursor-pointer items-start gap-3 rounded-field bg-field/60 p-3.5 text-[15px]">
        <input
          id="age-16"
          type="checkbox"
          required
          checked={adult}
          onChange={(e) => setAdult(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-brand)]"
        />
        <span>{t("auth.ageConfirm")}</span>
      </label>
      <label className="flex cursor-pointer items-start gap-3 rounded-field bg-field/60 p-3.5 text-[15px]">
        <input
          id="age-terms"
          type="checkbox"
          required
          checked={terms}
          onChange={(e) => setTerms(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-brand)]"
        />
        <span>{t.rich("auth.acceptTerms", { terms: link("/terms"), privacy: link("/privacy") })}</span>
      </label>
      <ErrorText>{error}</ErrorText>
      <button
        key={shake}
        type="submit"
        className={cx("btn-primary min-h-[54px] w-full text-[17px]", shake > 0 && "anim-shake")}
        disabled={busy || !adult || !terms}
        data-testid="age-continue"
      >
        {busy ? t("common.saving") : t("auth.continue")}
      </button>
      <p className="text-center text-sm">
        <button type="button" onClick={() => setDeleting(true)} className="inline-flex items-center gap-1.5 font-medium text-danger-ink hover:underline" data-testid="age-delete">
          <Trash2 size={14} /> {t("profile.deleteAccount")}
        </button>
      </p>
    </form>
  );
}
