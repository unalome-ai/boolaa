"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthCard } from "@/components/auth-card";
import { ErrorText } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { useTranslations } from "next-intl";
import { useErrorText } from "@/i18n/errors";
import { hardNavigate } from "@/lib/utils";
import { OAuthButtons, OrDivider } from "@/components/oauth-buttons";
import { TERMS_VERSION } from "@/lib/device";
import { useLocale } from "next-intl";

export default function RegisterPage() {
  const t = useTranslations("auth");
  const errorText = useErrorText();
  const locale = useLocale();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [checkEmail, setCheckEmail] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await getSupabase().auth.signUp({
      email: email.trim(),
      password,
      // The sign-up trigger stores age_confirmed_at and the terms version (docs/auth-security.md §6);
      // locale picks the language of every auth email.
      options: { data: { name: name.trim(), locale, age_confirmed: true, terms_version: TERMS_VERSION } },
    });
    if (error) {
      setBusy(false);
      setError(errorText(error));
      setShake((n) => n + 1);
      return;
    }
    if (!data.session) {
      // Email confirmation is enabled on this project.
      setBusy(false);
      setCheckEmail(true);
      return;
    }
    hardNavigate("/verify?next=%2Fonboarding");
  }

  if (checkEmail) {
    return (
      <AuthCard title={t("checkInboxTitle")} subtitle={t("checkInboxSubtitle", { email })}>
        <Link href="/login" className="btn-primary w-full">
          {t("backToSignIn")}
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("registerTitle")} subtitle={t("registerSubtitle")}>
      <OAuthButtons />
      <OrDivider />
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="name">
            {t("name")}
          </label>
          <input
            id="name"
            autoComplete="name"
            className="input"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
          />
        </div>
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
          <label className="label" htmlFor="password">
            {t("password")}
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            className="input"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <input
            id="age-confirm"
            type="checkbox"
            required
            checked={adult}
            onChange={(e) => setAdult(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-brand)]"
          />
          <span>{t("ageConfirm")}</span>
        </label>
        <ErrorText>{error}</ErrorText>
        <button key={shake} type="submit" className={`btn-primary min-h-[54px] w-full text-[17px] ${shake ? "anim-shake" : ""}`} disabled={busy || !adult}>
          {busy ? t("creatingAccount") : t("createAccount")}
        </button>
        <p className="text-center text-xs text-muted" data-testid="terms-consent">
          {t.rich("agreeTerms", {
            terms: (chunks) => (
              <Link href="/terms" target="_blank" className="font-medium text-brand-ink underline-offset-2 hover:underline">
                {chunks}
              </Link>
            ),
            privacy: (chunks) => (
              <Link href="/privacy" target="_blank" className="font-medium text-brand-ink underline-offset-2 hover:underline">
                {chunks}
              </Link>
            ),
          })}
        </p>
      </form>
      <p className="mt-5 text-center text-sm text-muted">
        {t("haveAccount")}{" "}
        <Link href="/login" className="font-semibold text-brand-ink hover:underline">
          {t("signInLink")}
        </Link>
      </p>
    </AuthCard>
  );
}
