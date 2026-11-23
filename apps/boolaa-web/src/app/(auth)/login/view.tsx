"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { AuthCard } from "@/components/auth-card";
import { ErrorText } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { useTranslations } from "next-intl";
import { useErrorText } from "@/i18n/errors";
import { hardNavigate } from "@/lib/utils";
import { OAuthButtons, OrDivider } from "@/components/oauth-buttons";
import { safeNext } from "@/lib/auth-next";
import { withNext } from "@/lib/invite";
import { domValue, useAdoptTypedValues, useFieldRef } from "@/lib/form";

export default function LoginPage() {
  const t = useTranslations("auth");
  const errorText = useErrorText();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  // `?next=/join/CODE` (invite links): continue there after the device gate instead of /home.
  const [next, setNext] = useState<string | null>(null);
  const emailRef = useFieldRef();
  const passwordRef = useFieldRef();
  useAdoptTypedValues([[emailRef, setEmail], [passwordRef, setPassword]]);

  // Back from /auth/callback after a failed or cancelled Google / Apple sign-in, and `?next=`.
  // One-off read of the URL on mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (params.get("error") === "oauth") setError(errorText("oauthFailed"));
    if (params.get("next")) setNext(safeNext(params.get("next")));
  }, [errorText]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // The DOM value, not only state: text typed before hydration (lib/form.ts).
    const { error } = await getSupabase().auth.signInWithPassword({
      email: domValue(emailRef, email).trim(),
      password: domValue(passwordRef, password),
    });
    if (error) {
      // Suspended or banned (auth.users.banned_until, docs/moderation.md): explain instead of an error.
      if (error.code === "user_banned") return hardNavigate("/suspended");
      setBusy(false);
      setError(errorText(error));
      setShake((n) => n + 1);
      return;
    }
    // Full navigation so the proxy sees the fresh auth cookies. The device gate runs
    // start_device_check (and the code / 16+ screens if needed), then routes to /home or /onboarding.
    hardNavigate(`/verify?next=${encodeURIComponent(next ?? "/home")}`);
  }

  return (
    <AuthCard title={t("loginTitle")} subtitle={t("loginSubtitle")}>
      <OAuthButtons next={next} />
      <OrDivider />
      <form onSubmit={submit} className="space-y-4">
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
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label className="label" htmlFor="password">
              {t("password")}
            </label>
            <Link href="/forgot-password" className="mb-1.5 text-sm font-semibold text-brand-ink hover:underline" data-testid="forgot-password">
              {t("forgotPassword")}
            </Link>
          </div>
          <input
            id="password"
            ref={passwordRef}
            type="password"
            autoComplete="current-password"
            className="input"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <ErrorText>{error}</ErrorText>
        <button key={shake} type="submit" className={`btn-primary min-h-[54px] w-full text-[17px] ${shake ? "anim-shake" : ""}`} disabled={busy}>
          {busy ? t("signingIn") : t("signIn")}
        </button>
      </form>
      <p className="mt-5 text-center text-sm text-muted">
        {t("newHere")}{" "}
        <Link href={withNext("/register", next)} className="font-semibold text-brand-ink hover:underline">
          {t("createAccountLink")}
        </Link>
      </p>
    </AuthCard>
  );
}
