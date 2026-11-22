export const locales = ["en", "ro", "fr", "es", "it"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";
export const LOCALE_COOKIE = "boolaa_locale";

/** Language names in their own language (glossary): never translated. */
export const localeNames: Record<Locale, string> = {
  en: "English",
  ro: "Română",
  fr: "Français",
  es: "Español",
  it: "Italiano",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/** Best supported locale from an Accept-Language header ("ro-RO,ro;q=0.9,en;q=0.8"), by q-value. */
export function matchAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { base: tag!.trim().toLowerCase().split("-")[0]!, q: q ? Number(q.slice(2)) : 1, i };
    })
    .filter((x) => x.base && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  return ranked.map((x) => x.base).find(isLocale) ?? null;
}

/** Cookie first, then Accept-Language, then English. */
export function resolveLocale(cookieValue: string | undefined, acceptLanguage: string | null | undefined): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  return matchAcceptLanguage(acceptLanguage) ?? defaultLocale;
}
