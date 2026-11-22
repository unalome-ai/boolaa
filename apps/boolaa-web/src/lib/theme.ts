/**
 * Light / dark / system theme (web only). The choice lives in the `boolaa_theme` cookie so the
 * server render already carries it (`data-theme` on <html>, read in app/layout.tsx): no flash of the
 * wrong theme. "system" = no cookie and no attribute, and CSS follows `prefers-color-scheme`.
 * localStorage mirrors it only so other open tabs switch at once (the `storage` event).
 */
export const THEME_COOKIE = "boolaa_theme";
export const THEME_STORAGE_KEY = "boolaa_theme";
const THEME_EVENT = "boolaa-theme";
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

/** Anything but "light" / "dark" (missing, tampered) means "system". */
export function parseTheme(value: string | null | undefined): Theme {
  return value === "light" || value === "dark" ? value : "system";
}

/** Browser-bar colour per theme; "system" uses one per scheme (viewport `themeColor`). */
export const THEME_COLOR = { light: "#fbf8ff", dark: "#15111f" } as const;

/** Applies a theme to the live document (attribute + browser-bar colour). */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  queueMicrotask(() => window.dispatchEvent(new Event(THEME_EVENT)));
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  metas.forEach((m) => {
    const scheme = m.media.includes("dark") ? "dark" : m.media.includes("light") ? "light" : null;
    if (theme === "system") {
      if (m.dataset.boolaaMedia) m.media = m.dataset.boolaaMedia;
      const s = scheme ?? (m.media.includes("dark") ? "dark" : m.media.includes("light") ? "light" : null);
      // A page rendered with a forced theme has a single meta without media: follow the OS now.
      m.content = THEME_COLOR[s ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")];
    } else {
      // Keep the original media query so "system" can restore it, then force this theme's colour.
      if (m.dataset.boolaaMedia === undefined) m.dataset.boolaaMedia = m.media;
      m.removeAttribute("media");
      m.content = THEME_COLOR[theme];
    }
  });
}

/** Stores and applies the choice: cookie (server render), localStorage (other tabs), <html>. */
export function setTheme(theme: Theme) {
  if (theme === "system") document.cookie = `${THEME_COOKIE}=; path=/; max-age=0; samesite=lax`;
  else document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${365 * 86400}; samesite=lax`;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode */
  }
  applyTheme(theme);
}

export function currentTheme(): Theme {
  return parseTheme(document.documentElement.getAttribute("data-theme"));
}

/** For useSyncExternalStore: fires whenever applyTheme runs (this tab, or another tab via ThemeSync). */
export function subscribeTheme(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}
