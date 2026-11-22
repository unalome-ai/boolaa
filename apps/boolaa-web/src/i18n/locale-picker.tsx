"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Globe } from "lucide-react";
import { LOCALE_COOKIE, localeNames, locales, type Locale } from "@/i18n/config";
import { cx, writeCookie } from "@/lib/utils";

/** Sets the locale cookie and re-renders server components; auth cookies are untouched. */
export function useChangeLocale() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const change = (next: Locale) => {
    writeCookie(LOCALE_COOKIE, next);
    startTransition(() => router.refresh());
  };
  return { change, pending };
}

/** Full list (profile sheet): every language in its own name. */
export function LocalePicker() {
  const t = useTranslations("common");
  const locale = useLocale();
  const { change, pending } = useChangeLocale();
  return (
    <fieldset disabled={pending}>
      <legend className="label">{t("language")}</legend>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("language")} data-testid="locale-picker">
        {locales.map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={locale === l}
            lang={l}
            onClick={() => locale !== l && change(l)}
            className={cx("chip", locale === l ? "fill-hue" : "bg-field text-muted hover:text-fg")}
          >
            {localeNames[l]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Compact select for the auth screens. */
export function CompactLocalePicker({ className }: { className?: string }) {
  const t = useTranslations("common");
  const locale = useLocale();
  const { change, pending } = useChangeLocale();
  return (
    <label className={cx("inline-flex items-center gap-1.5 rounded-full bg-card/80 px-3 py-1.5 font-display text-sm font-bold text-brand-ink shadow-soft backdrop-blur", className)}>
      <Globe size={15} aria-hidden />
      <span className="sr-only">{t("language")}</span>
      <select
        value={locale}
        disabled={pending}
        onChange={(e) => change(e.target.value as Locale)}
        className="cursor-pointer bg-transparent font-medium text-brand-ink outline-none"
        data-testid="locale-select"
      >
        {locales.map((l) => (
          <option key={l} value={l} lang={l}>
            {localeNames[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
