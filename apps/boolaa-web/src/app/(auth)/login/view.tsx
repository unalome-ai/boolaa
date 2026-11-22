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

export default function LoginPage() {
  const t = useTranslations("auth");
  const errorText = useErrorText();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);

  // Back from /auth/callback after a failed or cancelled Google / Apple sign-in.
  useEffect(() => {
    // One-off read of the URL on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (new URLSearchParams(window.location.search).get("error") === "oauth") setError(errorText("oauthFailed"));
  }, [errorText]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
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
    hardNavigate("/verify?next=%2Fhome");
  }

  return (
    <AuthCard title={t("loginTitle")} subtitle={t("loginSubtitle")}>
      <OAuthButtons />
      <OrDivider />
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">
            {t("email")}
          </label>
          <input
            id="email"
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
        <Link href="/register" className="font-semibold text-brand-ink hover:underline">
          {t("createAccountLink")}
        </Link>
      </p>
    </AuthCard>
  );
}
