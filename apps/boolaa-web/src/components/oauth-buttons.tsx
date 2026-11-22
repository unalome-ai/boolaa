"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { getSupabase } from "@/lib/supabase/client";
import { useErrorText } from "@/i18n/errors";
import { ErrorText } from "@/components/ui";
import { AUTH_NEXT_COOKIE } from "@/lib/auth-next";
import { writeCookie } from "@/lib/utils";

type Provider = "google" | "apple";

/** Google's four-colour "G" (unaltered, from the Google Identity branding kit). */
function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 48 48" width="20" height="20" className="shrink-0">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
  );
}

/** Apple logo in the button's text colour (Apple HIG: logo and title share one colour). */
function AppleMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" width="20" height="20" className="-mt-0.5 shrink-0" fill="currentColor">
      <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45z" />
    </svg>
  );
}

/**
 * "Continue with Google" / "Continue with Apple" (docs/auth-security.md §7). Branding:
 * Google: white fill, #747775 stroke, #1F1F1F text (dark: #131314 / #8E918F / #E3E3E3), Roboto
 * medium, the official "G". Apple: black button with white logo and title in light mode, white
 * with black in dark mode, same height and corner as Google's so neither dominates.
 */
export function OAuthButtons({ className, next }: { className?: string; next?: string | null }) {
  const t = useTranslations("auth");
  const errorText = useErrorText();
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go(provider: Provider) {
    setBusy(provider);
    setError(null);
    // Where /auth/callback continues after the device gate (e.g. an invite link, /join/CODE).
    if (next) writeCookie(AUTH_NEXT_COOKIE, next, 1);
    const { error } = await getSupabase().auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    // On success the browser is already leaving for the provider.
    if (error) {
      setBusy(null);
      setError(errorText(error));
    }
  }

  const base =
    "press flex min-h-[50px] w-full items-center justify-center gap-3 rounded-full px-5 text-[16px] font-medium tracking-[0.01em] transition-[filter] disabled:cursor-wait disabled:opacity-70";
  return (
    <div className={`space-y-3 ${className ?? ""}`}>
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => go("google")}
          disabled={busy !== null}
          data-testid="oauth-google"
          style={{ fontFamily: "Roboto, var(--font-sans)" }}
          className={`${base} border border-[#747775] bg-white text-[#1F1F1F] hover:brightness-[0.97] dark:border-[#8E918F] dark:bg-[#131314] dark:text-[#E3E3E3] dark:hover:brightness-125`}
        >
          <GoogleMark />
          <span>{t("continueWithGoogle")}</span>
        </button>
        <button
          type="button"
          onClick={() => go("apple")}
          disabled={busy !== null}
          data-testid="oauth-apple"
          style={{ fontFamily: "-apple-system, BlinkMacSystemFont, var(--font-sans)" }}
          className={`${base} border border-black bg-black text-white hover:brightness-125 dark:border-white dark:bg-white dark:text-black dark:hover:brightness-95`}
        >
          <AppleMark />
          <span>{t("continueWithApple")}</span>
        </button>
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** "or" rule between the provider buttons and the email form. */
export function OrDivider() {
  const t = useTranslations("auth");
  return (
    <div className="my-5 flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-muted" role="separator">
      <span className="h-px flex-1 bg-line" />
      {t("orDivider")}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
