"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Check, ChevronDown, Globe } from "lucide-react";
import { LOCALE_COOKIE, localeNames, locales, type Locale } from "@/i18n/config";
import { getSupabase } from "@/lib/supabase/client";
import { cx, writeCookie } from "@/lib/utils";

/** Sets the locale cookie and re-renders server components; auth cookies are untouched. */
export function useChangeLocale() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const change = (next: Locale) => {
    writeCookie(LOCALE_COOKIE, next);
    startTransition(() => router.refresh());
    // Auth emails and codes are sent in user_metadata.locale (docs/auth-security.md §5).
    void syncAccountLocale(next);
  };
  return { change, pending };
}

/** Stores the language on the signed-in account (no-op when signed out or already set). */
export async function syncAccountLocale(locale: Locale) {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user || user.user_metadata?.locale === locale) return;
  await supabase.auth.updateUser({ data: { locale } });
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

/**
 * Compact language menu for public pages (landing, auth, legal, onboarding): a globe + the current
 * code; the menu lists every language in its own name. Picking one stores it in the locale cookie
 * and reloads (dropping any `?lang=`, which would otherwise win). Menu-button pattern: arrows,
 * Home/End, Escape and Tab work; no animation beyond a fade, which reduced motion keeps.
 */
export function CompactLocalePicker({ className, align = "end", up = false }: { className?: string; align?: "start" | "end"; up?: boolean }) {
  const t = useTranslations("common");
  const locale = useLocale() as Locale;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const focusItem = (i: number) => itemsRef.current[(i + locales.length) % locales.length]?.focus();
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    focusItem(Math.max(0, locales.indexOf(locale)));
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, locale]);

  const choose = (next: Locale) => {
    if (next === locale) return close();
    setBusy(true);
    writeCookie(LOCALE_COOKIE, next);
    const url = new URL(window.location.href);
    url.searchParams.delete("lang");
    if (url.href === window.location.href) window.location.reload();
    else window.location.assign(url.href);
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const i = itemsRef.current.findIndex((el) => el === document.activeElement);
    if (e.key === "ArrowDown") focusItem(i + 1);
    else if (e.key === "ArrowUp") focusItem(i - 1);
    else if (e.key === "Home") focusItem(0);
    else if (e.key === "End") focusItem(locales.length - 1);
    else if (e.key === "Escape") close();
    else if (e.key === "Tab") return setOpen(false);
    else return;
    e.preventDefault();
  };

  return (
    <div ref={rootRef} className={cx("relative inline-block", className)} data-testid="language-switcher">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${t("language")}: ${localeNames[locale]}`}
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-card/80 px-3 font-display text-sm font-bold text-brand-ink shadow-soft backdrop-blur"
        data-testid="language-button"
      >
        <Globe size={16} strokeWidth={2.4} aria-hidden />
        <span className="uppercase" aria-hidden>
          {locale}
        </span>
        <ChevronDown size={14} strokeWidth={2.6} aria-hidden className={cx("transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={t("language")}
          onKeyDown={onMenuKey}
          className={cx(
            "anim-fade absolute z-[400] min-w-44 overflow-hidden rounded-field bg-card p-1 shadow-float ring-1 ring-line",
            up ? "bottom-full mb-2" : "top-full mt-2",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {locales.map((l, i) => (
            <button
              key={l}
              ref={(el) => {
                itemsRef.current[i] = el;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={l === locale}
              lang={l}
              tabIndex={-1}
              onClick={() => choose(l)}
              className={cx(
                "flex w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left text-[15px] outline-none hover:bg-field focus-visible:bg-field",
                l === locale ? "font-bold text-brand-ink" : "text-fg",
              )}
            >
              <span className="w-6 font-display text-xs font-black uppercase text-muted">{l}</span>
              <span className="flex-1">{localeNames[l]}</span>
              {l === locale && <Check size={16} strokeWidth={3} aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
