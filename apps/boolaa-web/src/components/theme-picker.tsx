"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Monitor, Moon, Sun } from "lucide-react";
import { applyTheme, currentTheme, parseTheme, setTheme, subscribeTheme, THEME_STORAGE_KEY, THEMES, type Theme } from "@/lib/theme";
import { cx } from "@/lib/utils";

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;
const LABELS = { system: "themeSystem", light: "themeLight", dark: "themeDark" } as const;

/** Settings → Appearance: System / Light / Dark. Applies at once; stored in a cookie (src/lib/theme.ts). */
export function ThemePicker() {
  const t = useTranslations("appearance");
  // <html data-theme> is the source of truth (server-rendered from the cookie, changed by setTheme).
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => "system" as Theme);
  const choose = (next: Theme) => setTheme(next);

  return (
    <fieldset className="card rounded-[20px] p-4">
      <legend className="sr-only">{t("title")}</legend>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("title")} data-testid="theme-picker">
        {THEMES.map((value) => {
          const Icon = ICONS[value];
          const on = theme === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => !on && choose(value)}
              className={cx("chip justify-center", on ? "fill-hue" : "bg-field text-muted hover:text-fg")}
              data-theme-option={value}
            >
              <Icon size={16} strokeWidth={2.4} aria-hidden /> {t(LABELS[value])}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-sm text-muted">{t("hint")}</p>
    </fieldset>
  );
}

/** Keeps every open tab on the same theme: another tab's change arrives as a `storage` event. */
export function ThemeSync() {
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY) applyTheme(parseTheme(e.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return null;
}
