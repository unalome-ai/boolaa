"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { AuthCard } from "@/components/auth-card";
import { CodeInput, ResendButton, useCooldown } from "@/components/code-input";
import { ErrorText } from "@/components/ui";
import { useErrorText } from "@/i18n/errors";
import { AUTH_NEXT_COOKIE } from "@/lib/auth-next";
import { RESEND_COOLDOWN_S } from "@/lib/device";
import { getSupabase } from "@/lib/supabase/client";
import { cx, hardNavigate, writeCookie } from "@/lib/utils";
import { domValue, useAdoptTypedValues, useFieldRef } from "@/lib/form";

type Step = "email" | "code" | "password";

/**
 * "Forgot password?" (docs/auth-security.md §2): email → 6-digit recovery code (verifyOtp type
 * "recovery") → new password → signed in (through the device gate). The emailed link is a fallback
 * that comes back through /auth/callback to the password step here.
 */
export default function ForgotPasswordPage() {
  const supabase = getSupabase();
  const t = useTranslations("auth");
  const errorText = useErrorText();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const emailRef = useFieldRef();
  const passwordRef = useFieldRef();
  useAdoptTypedValues([[emailRef, setEmail]]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const cooldown = useCooldown();

  // Back from the email link (/auth/callback → /verify → here) with a recovery session, or with an
  // expired link.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error")) {
      // One-off read of the URL on mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(errorText({ code: "otp_expired" }));
      return;
    }
    if (params.get("step") !== "password") return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setEmail(data.session.user.email ?? "");
        setStep("password");
      }
    });
  }, [supabase, errorText]);

  const fail = (e: unknown) => {
    setError(errorText(e));
    setShake((n) => n + 1);
    setBusy(false);
  };

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    // If the link in the email is used instead of the code, come back to the password step.
    writeCookie(AUTH_NEXT_COOKIE, "/forgot-password?step=password", 1);
    // The DOM value when the email form is on screen: text typed before hydration (lib/form.ts).
    const address = domValue(emailRef, email).trim();
    if (address !== email) setEmail(address);
    const { error } = await supabase.auth.resetPasswordForEmail(address, {
      redirectTo: `${window.location.origin}/auth/callback`,
    });
    if (error) return fail(error);
    cooldown.start(RESEND_COOLDOWN_S);
    setBusy(false);
    if (step === "code") setNotice(t("codeResent"));
    setCode("");
    setStep("code");
  }

  async function verify(value: string, e?: FormEvent) {
    e?.preventDefault();
    if (value.length !== 6) return fail("codeFormat");
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: value, type: "recovery" });
    if (error) {
      setCode("");
      return fail(error);
    }
    setBusy(false);
    setStep("password");
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // A fresh recovery session doesn't need a reauthentication nonce.
    const { error } = await supabase.auth.updateUser({ password: domValue(passwordRef, password) });
    if (error) return fail(error);
    hardNavigate("/verify?next=%2Fhome");
  }

  const submitClass = (extra = "") => cx("btn-primary min-h-[54px] w-full text-[17px]", shake > 0 && "anim-shake", extra);
  const back = (
    <p className="mt-5 text-center text-sm text-muted">
      <Link href="/login" className="font-semibold text-brand-ink hover:underline">
        {t("backToSignIn")}
      </Link>
    </p>
  );

  if (step === "code")
    return (
      <AuthCard title={t("resetCodeTitle")} subtitle={t("resetCodeSubtitle", { email: email.trim() })}>
        <form onSubmit={(e) => verify(code, e)} className="space-y-4" data-testid="reset-code">
          <CodeInput value={code} onChange={setCode} onComplete={(c) => void verify(c)} disabled={busy} invalid={!!error} id="reset-code-input" />
          {notice && !error && (
            <p role="status" className="text-sm font-medium text-mint-ink">
              {notice}
            </p>
          )}
          <ErrorText>{error}</ErrorText>
          <button key={shake} type="submit" className={submitClass()} disabled={busy || code.length !== 6}>
            {busy ? t("verifying") : t("verify")}
          </button>
          <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-muted">
            <ResendButton left={cooldown.left} busy={busy} onClick={() => void sendCode()} />
            <button
              type="button"
              className="font-semibold text-brand-ink hover:underline"
              onClick={() => {
                setError(null);
                setStep("email");
              }}
            >
              {t("useAnotherEmail")}
            </button>
          </p>
        </form>
        {back}
      </AuthCard>
    );

  if (step === "password")
    return (
      <AuthCard title={t("newPasswordTitle")} subtitle={t("newPasswordSubtitle")}>
        <form onSubmit={savePassword} className="space-y-4" data-testid="reset-password">
          <input type="email" autoComplete="username" value={email} readOnly hidden />
          <div>
            <label className="label" htmlFor="new-password">
              {t("newPassword")}
            </label>
            <input
              id="new-password"
            ref={passwordRef}
              type="password"
              autoComplete="new-password"
              className="input"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            <p className="mt-1.5 text-xs text-muted">{t("passwordHint")}</p>
          </div>
          <ErrorText>{error}</ErrorText>
          <button key={shake} type="submit" className={submitClass()} disabled={busy || password.length < 6}>
            {busy ? t("savingPassword") : t("savePassword")}
          </button>
        </form>
      </AuthCard>
    );

  return (
    <AuthCard title={t("forgotTitle")} subtitle={t("forgotSubtitle")}>
      <form onSubmit={sendCode} className="space-y-4" data-testid="reset-email">
        <div>
          <label className="label" htmlFor="email">
            {t("email")}
          </label>
          <input
            id="email"
            ref={emailRef}
            type="email"
            autoComplete="email"
            className="input"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("emailPlaceholder")}
          />
        </div>
        <ErrorText>{error}</ErrorText>
        <button key={shake} type="submit" className={submitClass()} disabled={busy}>
          {busy ? t("sendingCode") : t("sendCode")}
        </button>
      </form>
      {back}
    </AuthCard>
  );
}
