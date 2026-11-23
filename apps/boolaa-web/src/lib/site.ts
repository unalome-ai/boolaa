import type { Metadata } from "next";
import { locales as LOCALES } from "@/i18n/config";

/** Production origin. Canonical and Open Graph URLs always use it, also when served from www. */
export const PRODUCTION_ORIGIN = "https://boolaa.ro";

/**
 * Public base URL for absolute links (canonical, Open Graph, sitemap). NEXT_PUBLIC_SITE_URL can
 * point a staging build elsewhere; a leading "www." is dropped so www.boolaa.ro never becomes
 * canonical.
 */
export const SITE_URL = (() => {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (!env) return PRODUCTION_ORIGIN;
  const url = new URL(env);
  url.hostname = url.hostname.replace(/^www\./, "");
  return url.origin;
})();

/**
 * Where the landing's download buttons go. `null` means "not live yet": the button is shown as
 * plain text with a "Coming soon" badge instead of a link.
 *  - APP_STORE_URL: the App Store listing, once the iOS app is approved.
 *  - ANDROID_URL: the /android page (signed APK download, src/app/android).
 */
export const APP_STORE_URL: string | null = null;
export const ANDROID_URL: string | null = "/android";

/**
 * Canonical + og:url for a page path (resolved against `metadataBase` = SITE_URL). A page-level
 * `openGraph` replaces the inherited one, so the shared social image is listed again here.
 */
export function pageUrls(path: string): Pick<Metadata, "alternates" | "openGraph"> {
  return {
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: "Boolaa",
      url: path,
      images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Boolaa" }],
    },
  };
}

/**
 * Metadata for public pages that exist in every language: hreflang alternates for the 5 locales
 * (`?lang=xx`) plus x-default (the plain URL, negotiated from cookie / Accept-Language). A `?lang=`
 * request is canonical to itself; the plain URL is canonical otherwise.
 */
export function localizedUrls(
  path: string,
  { lang, locale, title, description }: { lang?: string | string[]; locale: string; title?: string; description?: string },
): Pick<Metadata, "alternates" | "openGraph" | "twitter"> {
  const explicit = typeof lang === "string" && (LOCALES as readonly string[]).includes(lang) ? lang : null;
  const withLang = (l: string) => `${path}?lang=${l}`;
  const canonical = explicit ? withLang(explicit) : path;
  const base = pageUrls(canonical);
  return {
    alternates: {
      canonical,
      languages: { ...Object.fromEntries(LOCALES.map((l) => [l, withLang(l)])), "x-default": path },
    },
    openGraph: {
      ...base.openGraph,
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      locale,
      alternateLocale: LOCALES.filter((l) => l !== locale),
    },
    twitter: { card: "summary_large_image", ...(title ? { title } : {}), ...(description ? { description } : {}) },
  };
}

/** Public source repository (Apache-2.0). */
export const REPO_URL = "https://github.com/unalome-ai/boolaa";

/** Date shown as "Last updated" on /privacy and /terms (ISO). */
export const LEGAL_UPDATED = "2026-11-22";
